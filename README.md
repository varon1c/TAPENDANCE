# TAPENDANCE

TAPENDANCE is an offline-first NFC attendance system for service fleets. It includes a browser dashboard for coordinators, a Node/Express sync API, and an Expo Android scanner app that can be built as an APK.

## Deployable applications

| Application | Folder | Deployment target |
| --- | --- | --- |
| Coordinator dashboard | `web/` | Vercel |
| Sync API | `backend/` | Render |
| Vehicle NFC scanner | `mobile/` | Android APK with Expo EAS |

The web dashboard reads synced trip and attendance data. The Android application scans NFC cards, stores scans in SQLite if offline, and posts queued records to the API when it can reconnect.

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

## Deploy the API on Render

1. Create a managed MySQL database and run [`database/mysql-schema.sql`](database/mysql-schema.sql).
2. In Render, create a **Blueprint** from this repository. It uses [`render.yaml`](render.yaml) and deploys `backend/`.
3. Set `DATABASE_URL` to the production database connection string.
4. After deploying the dashboard, set `CORS_ORIGIN` to its Vercel URL—for example, `https://tapendance.vercel.app`.
5. Open `https://your-api.onrender.com/health`; it should return `{ "ok": true }`.

## Deploy the dashboard on Vercel

1. Import this GitHub repository into Vercel.
2. Set **Root Directory** to `web`.
3. Add `VITE_API_BASE_URL=https://your-api.onrender.com` as an environment variable.
4. Deploy, then copy the resulting Vercel URL into the API's `CORS_ORIGIN` setting and redeploy the API.

The dashboard calls `GET /api/v1/trips` and `GET /api/v1/trips/:tripId/attendance`. It intentionally exposes no write controls; create operators, vehicles, and trips through your protected back-office workflow or database admin tool until authentication and role-based management are added.

## Build an Android APK

NFC support requires a native Android build. It will not work in Expo Go.

```powershell
cd mobile
Copy-Item .env.example .env
# Set EXPO_PUBLIC_API_BASE_URL and EXPO_PUBLIC_DEVICE_ID in .env
npm install
npx eas login
npx eas build --platform android --profile preview
```

The `preview` profile in [`mobile/eas.json`](mobile/eas.json) produces a downloadable APK. Before the first build, use an Expo account whose Android package name can own `com.varon1c.tapendance`, or change that identifier in [`mobile/app.json`](mobile/app.json). Install the resulting APK on an NFC-capable Android device, not an emulator.

For local native testing, run `npx expo run:android`; Expo will create the required native project and install a development build.
