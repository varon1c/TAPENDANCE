import type { SQLiteDatabase } from 'expo-sqlite';

/** Run once immediately after opening the device database. */
export async function migrateFleetDatabase(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY NOT NULL, email TEXT NOT NULL, display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('ADMIN', 'OPERATOR', 'COORDINATOR')),
      is_active INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS vehicles (
      id TEXT PRIMARY KEY NOT NULL, fleet_number TEXT NOT NULL UNIQUE,
      registration_number TEXT NOT NULL UNIQUE, description TEXT,
      is_active INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS trips (
      id TEXT PRIMARY KEY NOT NULL, vehicle_id TEXT NOT NULL, operator_id TEXT NOT NULL,
      route_name TEXT NOT NULL, point_a_name TEXT NOT NULL, point_b_name TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'CLOSED', 'CANCELLED')),
      started_at TEXT NOT NULL, closed_at TEXT, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS attendance_logs (
      id TEXT PRIMARY KEY NOT NULL, trip_id TEXT NOT NULL, card_uid TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('BOARDED', 'COMPLETED', 'INCOMPLETE')),
      tap_in_time TEXT NOT NULL, tap_in_gps TEXT, tap_out_time TEXT, tap_out_gps TEXT,
      sync_status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (sync_status IN ('PENDING', 'SYNCING', 'SYNCED', 'FAILED')),
      sync_attempts INTEGER NOT NULL DEFAULT 0, last_sync_error TEXT,
      client_updated_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE (trip_id, card_uid),
      CHECK (tap_out_time IS NULL OR tap_out_time >= tap_in_time)
    );
    CREATE INDEX IF NOT EXISTS ix_attendance_pending_sync
      ON attendance_logs (sync_status, client_updated_at);
  `);
}

/**
 * Call when the operator ends a trip. Incomplete local records are queued for
 * the same sync endpoint, so reconciliation also works when the handset is offline.
 */
export async function closeTripAndMarkIncomplete(db: SQLiteDatabase, tripId: string): Promise<void> {
  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE attendance_logs
          SET status = 'INCOMPLETE', sync_status = 'PENDING', last_sync_error = NULL,
              client_updated_at = ?, updated_at = ?
        WHERE trip_id = ? AND status = 'BOARDED' AND tap_out_time IS NULL`,
      [now, now, tripId],
    );
    await db.runAsync(
      `UPDATE trips
          SET status = 'CLOSED', closed_at = ?, updated_at = ?
        WHERE id = ? AND status = 'ACTIVE'`,
      [now, now, tripId],
    );
  });
}
