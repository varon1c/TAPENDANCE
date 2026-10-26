import { useCallback, useEffect, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import type { SQLiteDatabase } from 'expo-sqlite';
import NfcManager, { NfcTech } from 'react-native-nfc-manager';

const THREE_MINUTES_MS = 3 * 60 * 1000;

export type PointMode = 'POINT_A' | 'POINT_B';
export type ScannerOutcome =
  | 'CHECKED_IN'
  | 'CHECKED_OUT'
  | 'ALREADY_CHECKED_IN'
  | 'ALREADY_COMPLETED'
  | 'NO_CHECK_IN'
  | 'TRIP_CLOSED'
  | 'ERROR';

type AttendanceRow = {
  id: string;
  status: 'BOARDED' | 'COMPLETED' | 'INCOMPLETE';
  tap_in_time: string;
};

export type ScanFeedback = {
  outcome: ScannerOutcome;
  cardUid?: string;
  message: string;
};

type Options = {
  db: SQLiteDatabase;
  activeTripId: string | null;
  pointMode: PointMode;
  /** Use this to play application-owned check-in/check-out sounds. */
  onFeedback?: (feedback: ScanFeedback) => void;
};

function normalizeUid(rawUid: string): string {
  return rawUid.replace(/[^a-fA-F0-9]/g, '').toUpperCase();
}

async function captureGps(): Promise<string | null> {
  try {
    const permission = await Location.getForegroundPermissionsAsync();
    const granted = permission.granted || (await Location.requestForegroundPermissionsAsync()).granted;
    if (!granted) return null;
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return JSON.stringify({
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy ?? undefined,
      capturedAt: new Date(position.timestamp).toISOString(),
    });
  } catch {
    // A tap must still be saved if the GPS radio has no immediate fix.
    return null;
  }
}

export function useFleetNfcScanner({ db, activeTripId, pointMode, onFeedback }: Options) {
  const [isScanning, setIsScanning] = useState(false);
  const [lastFeedback, setLastFeedback] = useState<ScanFeedback | null>(null);
  const processingRef = useRef(false);
  const configRef = useRef({ activeTripId, pointMode, onFeedback });

  useEffect(() => {
    configRef.current = { activeTripId, pointMode, onFeedback };
  }, [activeTripId, pointMode, onFeedback]);

  const publish = useCallback((feedback: ScanFeedback) => {
    setLastFeedback(feedback);
    configRef.current.onFeedback?.(feedback);
  }, []);

  const processUid = useCallback(async (cardUid: string): Promise<ScanFeedback> => {
    const { activeTripId: tripId, pointMode: mode } = configRef.current;
    if (!tripId) return { outcome: 'ERROR', cardUid, message: 'Select an active trip before scanning.' };
    if (processingRef.current) return { outcome: 'ERROR', cardUid, message: 'A card scan is already being processed.' };

    processingRef.current = true;
    try {
      const trip = await db.getFirstAsync<{ status: string }>('SELECT status FROM trips WHERE id = ?', [tripId]);
      if (!trip || trip.status !== 'ACTIVE') {
        return { outcome: 'TRIP_CLOSED', cardUid, message: 'This trip is no longer active.' };
      }

      const existing = await db.getFirstAsync<AttendanceRow>(
        'SELECT id, status, tap_in_time FROM attendance_logs WHERE trip_id = ? AND card_uid = ?',
        [tripId, cardUid],
      );
      const now = new Date();
      const nowIso = now.toISOString();

      if (!existing) {
        if (mode === 'POINT_B') {
          return { outcome: 'NO_CHECK_IN', cardUid, message: 'No Point A check-in exists for this card.' };
        }
        const gps = await captureGps();
        await db.runAsync(
          `INSERT INTO attendance_logs
            (id, trip_id, card_uid, status, tap_in_time, tap_in_gps, sync_status,
             client_updated_at, created_at, updated_at)
           VALUES (?, ?, ?, 'BOARDED', ?, ?, 'PENDING', ?, ?, ?)`,
          [Crypto.randomUUID(), tripId, cardUid, nowIso, gps, nowIso, nowIso, nowIso],
        );
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        return { outcome: 'CHECKED_IN', cardUid, message: 'Check-in recorded at Point A.' };
      }

      if (existing.status === 'COMPLETED') {
        return { outcome: 'ALREADY_COMPLETED', cardUid, message: 'This card has already checked out.' };
      }
      if (existing.status === 'INCOMPLETE') {
        return { outcome: 'TRIP_CLOSED', cardUid, message: 'This record was closed as incomplete.' };
      }

      const elapsed = now.getTime() - new Date(existing.tap_in_time).getTime();
      if (mode === 'POINT_A' && elapsed < THREE_MINUTES_MS) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return { outcome: 'ALREADY_CHECKED_IN', cardUid, message: 'Already checked in. Please wait before checking out.' };
      }

      const gps = await captureGps();
      await db.runAsync(
        `UPDATE attendance_logs
            SET status = 'COMPLETED', tap_out_time = ?, tap_out_gps = ?,
                sync_status = 'PENDING', last_sync_error = NULL,
                client_updated_at = ?, updated_at = ?
          WHERE id = ?`,
        [nowIso, gps, nowIso, nowIso, existing.id],
      );
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return { outcome: 'CHECKED_OUT', cardUid, message: 'Check-out recorded at Point B.' };
    } catch {
      return { outcome: 'ERROR', cardUid, message: 'Unable to save this scan. Please try again.' };
    } finally {
      processingRef.current = false;
    }
  }, [db]);

  const scanOnce = useCallback(async () => {
    if (isScanning) return;
    setIsScanning(true);
    try {
      if (!(await NfcManager.isSupported())) {
        publish({ outcome: 'ERROR', message: 'NFC is not supported on this device.' });
        return;
      }
      await NfcManager.start();
      await NfcManager.requestTechnology(NfcTech.NfcA);
      const tag = await NfcManager.getTag();
      const cardUid = tag?.id ? normalizeUid(tag.id) : '';
      if (!cardUid) {
        publish({ outcome: 'ERROR', message: 'The NFC card UID could not be read.' });
        return;
      }
      publish(await processUid(cardUid));
    } catch (error) {
      // Cancellation is normal when a user closes Android's NFC prompt.
      if (!(error instanceof Error && /cancel/i.test(error.message))) {
        publish({ outcome: 'ERROR', message: 'NFC scan did not complete. Try again.' });
      }
    } finally {
      await NfcManager.cancelTechnologyRequest().catch(() => undefined);
      setIsScanning(false);
    }
  }, [isScanning, processUid, publish]);

  useEffect(() => () => { void NfcManager.cancelTechnologyRequest(); }, []);

  return { scanOnce, isScanning, lastFeedback };
}
