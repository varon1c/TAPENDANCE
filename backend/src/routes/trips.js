import { Router } from 'express';
import { pool } from '../db.js';
import { syncPayloadSchema } from '../validation/sync.js';

const router = Router();

function serializeTrip(row) {
  return {
    id: row.id,
    vehicleId: row.vehicleId,
    vehicleLabel: row.vehicleLabel,
    routeName: row.routeName,
    pointAName: row.pointAName,
    pointBName: row.pointBName,
    status: row.status,
    startedAt: row.startedAt,
    closedAt: row.closedAt,
    boardedCount: Number(row.boardedCount),
    completedCount: Number(row.completedCount),
    incompleteCount: Number(row.incompleteCount),
  };
}

router.get('/', async (_request, response, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT t.id, t.vehicle_id AS vehicleId,
              CONCAT(v.fleet_number, ' · ', v.registration_number) AS vehicleLabel,
              t.route_name AS routeName, t.point_a_name AS pointAName,
              t.point_b_name AS pointBName, t.status, t.started_at AS startedAt,
              t.closed_at AS closedAt,
              COALESCE(SUM(a.status = 'BOARDED'), 0) AS boardedCount,
              COALESCE(SUM(a.status = 'COMPLETED'), 0) AS completedCount,
              COALESCE(SUM(a.status = 'INCOMPLETE'), 0) AS incompleteCount
         FROM trips t
         JOIN vehicles v ON v.id = t.vehicle_id
         LEFT JOIN attendance_logs a ON a.trip_id = t.id
        GROUP BY t.id
        ORDER BY t.started_at DESC
        LIMIT 100`,
    );
    return response.json({ trips: rows.map(serializeTrip) });
  } catch (error) {
    return next(error);
  }
});

router.get('/:tripId/attendance', async (request, response, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT id, card_uid AS cardUid, status, tap_in_time AS tapInTime,
              tap_out_time AS tapOutTime, source_device_id AS sourceDeviceId
         FROM attendance_logs
        WHERE trip_id = ?
        ORDER BY tap_in_time DESC`,
      [request.params.tripId],
    );
    return response.json({ logs: rows });
  } catch (error) {
    return next(error);
  }
});

function asMysqlUtc(isoString) {
  // mysql2 serializes Date as UTC because the pool is configured with timezone: 'Z'.
  return new Date(isoString);
}

/**
 * Merge a locally queued event without allowing an older retry to erase data
 * captured by a later scan. The unique (trip_id, card_uid) key is the final
 * duplicate guard even when a device reinstalls and creates a new local UUID.
 */
async function mergeLog(connection, tripId, deviceId, log) {
  const [existingRows] = await connection.execute(
    `SELECT id, status, tap_in_time AS tapInTime, tap_in_gps AS tapInGps,
            tap_out_time AS tapOutTime, tap_out_gps AS tapOutGps
       FROM attendance_logs
      WHERE trip_id = ? AND card_uid = ?
      FOR UPDATE`,
    [tripId, log.cardUid],
  );

  if (existingRows.length === 0) {
    await connection.execute(
      `INSERT INTO attendance_logs
        (id, trip_id, card_uid, status, tap_in_time, tap_in_gps, tap_out_time,
         tap_out_gps, source_device_id, client_updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        log.id, tripId, log.cardUid, log.status, asMysqlUtc(log.tapInTime),
        log.tapInGps ? JSON.stringify(log.tapInGps) : null,
        log.tapOutTime ? asMysqlUtc(log.tapOutTime) : null,
        log.tapOutGps ? JSON.stringify(log.tapOutGps) : null,
        deviceId, asMysqlUtc(log.clientUpdatedAt),
      ],
    );
    return { clientLogId: log.id, serverLogId: log.id, action: 'created' };
  }

  const existing = existingRows[0];
  const tapOutTime = existing.tapOutTime ?? (log.tapOutTime ? asMysqlUtc(log.tapOutTime) : null);
  const tapOutGps = existing.tapOutGps ?? (log.tapOutGps ? JSON.stringify(log.tapOutGps) : null);
  // A check-out is authoritative. Otherwise retain a reconciliation INCOMPLETE state.
  const status = tapOutTime
    ? 'COMPLETED'
    : existing.status === 'INCOMPLETE' || log.status === 'INCOMPLETE'
      ? 'INCOMPLETE'
      : 'BOARDED';

  await connection.execute(
    `UPDATE attendance_logs
        SET status = ?,
            tap_in_time = COALESCE(tap_in_time, ?),
            tap_in_gps = COALESCE(tap_in_gps, ?),
            tap_out_time = ?,
            tap_out_gps = ?,
            source_device_id = ?,
            client_updated_at = GREATEST(client_updated_at, ?)
      WHERE id = ?`,
    [
      status, asMysqlUtc(log.tapInTime), log.tapInGps ? JSON.stringify(log.tapInGps) : null,
      tapOutTime, tapOutGps, deviceId, asMysqlUtc(log.clientUpdatedAt), existing.id,
    ],
  );
  return { clientLogId: log.id, serverLogId: existing.id, action: 'merged' };
}

async function syncHandler(request, response, next) {
  const parsed = syncPayloadSchema.safeParse(request.body);
  if (!parsed.success) {
    return response.status(422).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
  }
  if (request.params.tripId && request.params.tripId !== parsed.data.tripId) {
    return response.status(400).json({ error: 'TRIP_ID_MISMATCH' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [tripRows] = await connection.execute('SELECT id FROM trips WHERE id = ? FOR UPDATE', [parsed.data.tripId]);
    if (tripRows.length === 0) {
      await connection.rollback();
      return response.status(404).json({ error: 'TRIP_NOT_FOUND' });
    }

    const results = [];
    for (const log of parsed.data.logs) {
      results.push(await mergeLog(connection, parsed.data.tripId, parsed.data.deviceId, log));
    }
    await connection.commit();
    return response.status(200).json({ tripId: parsed.data.tripId, results });
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally {
    connection.release();
  }
}

router.post('/sync', syncHandler);
router.post('/:tripId/sync', syncHandler);

export default router;
