# Service Fleet Attendance MVP

This starter separates the mobile device's offline queue from the central API.

## Layout

- `database/` — MySQL production schema and equivalent SQLite device schema.
- `backend/` — Express sync API using Zod validation and MySQL transactions.
- `mobile/` — Expo SQLite setup and the NFC two-tap state-machine hook.

## Sync contract

The device posts up to 250 local records to `POST /api/v1/trips/sync`:

```json
{
  "tripId": "6a1fe434-1c42-47dc-8c7e-590947032fb1",
  "deviceId": "vehicle-12-tablet",
  "logs": [
    {
      "id": "812ee45b-b818-4166-b66e-21e4e55208c1",
      "cardUid": "04A1B2C3D4",
      "status": "COMPLETED",
      "tapInTime": "2026-10-26T08:00:00.000Z",
      "tapInGps": { "latitude": 15.145, "longitude": 120.588, "accuracy": 12 },
      "tapOutTime": "2026-10-26T08:32:00.000Z",
      "tapOutGps": { "latitude": 15.154, "longitude": 120.601, "accuracy": 10 },
      "clientUpdatedAt": "2026-10-26T08:32:00.000Z"
    }
  ]
}
```

Both `POST /api/v1/trips/sync` and `POST /api/v1/trips/:tripId/sync` are available. The latter requires its path ID to equal `tripId` in the payload. Replaying the same batch is safe: the server never removes a captured check-in or check-out, and completed logs remain completed.

## Local setup

Backend dependencies: `express`, `mysql2`, `zod`, and `dotenv`.

Mobile dependencies: `react-native-nfc-manager`, `expo-location`, `expo-sqlite`, `expo-haptics`, and `expo-crypto`. `react-native-nfc-manager` requires an Expo development build, not Expo Go.

Use `closeTripAndMarkIncomplete` to finish a trip locally. Call `syncPendingAttendance` after a scan, on app foreground, and from your chosen platform background task; it accepts an injected connectivity check so the app may use either `expo-network` or NetInfo without coupling the attendance domain code to either package.

Set `DATABASE_URL` (for example, `mysql://user:password@localhost:3306/fleet_attendance`) before starting the backend.
