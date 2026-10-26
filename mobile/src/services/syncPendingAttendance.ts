import type { SQLiteDatabase } from 'expo-sqlite';

type LocalLog = {
  id: string;
  trip_id: string;
  card_uid: string;
  status: 'BOARDED' | 'COMPLETED' | 'INCOMPLETE';
  tap_in_time: string;
  tap_in_gps: string | null;
  tap_out_time: string | null;
  tap_out_gps: string | null;
  client_updated_at: string;
};

type SyncResponse = { results: Array<{ clientLogId: string }> };

type SyncOptions = {
  db: SQLiteDatabase;
  apiBaseUrl: string;
  deviceId: string;
  /** Inject a network check (for example, from expo-network or NetInfo). */
  isOnline: () => Promise<boolean>;
};

let activeSync: Promise<{ synced: number }> | null = null;

/**
 * Run on app foreground, after each tap, and from your platform background task.
 * Each request contains one trip because the API deliberately makes `tripId` a
 * top-level batching key.
 */
async function performSync(options: SyncOptions): Promise<{ synced: number }> {
  const { db, apiBaseUrl, deviceId, isOnline } = options;
  if (!(await isOnline())) return { synced: 0 };

  // Recover records left marked SYNCING by an interrupted app process.
  await db.runAsync(
    `UPDATE attendance_logs SET sync_status = 'PENDING'
      WHERE sync_status = 'SYNCING'`,
  );
  const pending = await db.getAllAsync<LocalLog>(
    `SELECT id, trip_id, card_uid, status, tap_in_time, tap_in_gps, tap_out_time,
            tap_out_gps, client_updated_at
       FROM attendance_logs
      WHERE sync_status IN ('PENDING', 'FAILED')
      ORDER BY client_updated_at ASC
      LIMIT 250`,
  );
  const byTrip = new Map<string, LocalLog[]>();
  for (const log of pending) {
    byTrip.set(log.trip_id, [...(byTrip.get(log.trip_id) ?? []), log]);
  }

  let synced = 0;
  for (const [tripId, logs] of byTrip) {
    const ids = logs.map(({ id }) => id);
    const placeholders = ids.map(() => '?').join(', ');
    await db.runAsync(`UPDATE attendance_logs SET sync_status = 'SYNCING' WHERE id IN (${placeholders})`, ids);
    try {
      const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/api/v1/trips/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tripId,
          deviceId,
          logs: logs.map((log) => ({
            id: log.id,
            cardUid: log.card_uid,
            status: log.status,
            tapInTime: log.tap_in_time,
            tapInGps: log.tap_in_gps ? JSON.parse(log.tap_in_gps) : null,
            tapOutTime: log.tap_out_time,
            tapOutGps: log.tap_out_gps ? JSON.parse(log.tap_out_gps) : null,
            clientUpdatedAt: log.client_updated_at,
          })),
        }),
      });
      if (!response.ok) throw new Error(`Sync request failed (${response.status})`);
      const payload = (await response.json()) as SyncResponse;
      const acknowledged = payload.results.map(({ clientLogId }) => clientLogId);
      if (acknowledged.length > 0) {
        const syncedMarks = acknowledged.map(() => '?').join(', ');
        await db.runAsync(
          `UPDATE attendance_logs
              SET sync_status = 'SYNCED', last_sync_error = NULL
            WHERE id IN (${syncedMarks})`,
          acknowledged,
        );
        synced += acknowledged.length;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : 'Unknown sync failure';
      await db.runAsync(
        `UPDATE attendance_logs
            SET sync_status = 'FAILED', sync_attempts = sync_attempts + 1, last_sync_error = ?
          WHERE id IN (${placeholders})`,
        [message, ...ids],
      );
    }
  }
  return { synced };
}

export function syncPendingAttendance(options: SyncOptions): Promise<{ synced: number }> {
  // A foreground resume and a background task may fire together. Share one run
  // so neither changes a row back from SYNCING while the other posts it.
  if (activeSync) return activeSync;
  activeSync = performSync(options).finally(() => {
    activeSync = null;
  });
  return activeSync;
}
