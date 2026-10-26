import { z } from 'zod';

const gpsSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracy: z.number().finite().nonnegative().optional(),
  capturedAt: z.string().datetime({ offset: true }).optional(),
}).strict();

const isoDate = z.string().datetime({ offset: true });

export const attendanceLogSchema = z.object({
  id: z.string().uuid(),
  cardUid: z.string().regex(/^[0-9A-F]{4,128}$/),
  status: z.enum(['BOARDED', 'COMPLETED', 'INCOMPLETE']),
  tapInTime: isoDate,
  tapInGps: gpsSchema.nullable().optional(),
  tapOutTime: isoDate.nullable().optional(),
  tapOutGps: gpsSchema.nullable().optional(),
  clientUpdatedAt: isoDate,
}).strict().superRefine((log, context) => {
  if (log.status === 'COMPLETED' && !log.tapOutTime) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['tapOutTime'], message: 'COMPLETED records need tapOutTime' });
  }
  if (log.status !== 'COMPLETED' && log.tapOutTime) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['tapOutTime'], message: 'Only COMPLETED records may have tapOutTime' });
  }
  if (log.tapOutTime && new Date(log.tapOutTime) < new Date(log.tapInTime)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['tapOutTime'], message: 'tapOutTime must be on or after tapInTime' });
  }
});

export const syncPayloadSchema = z.object({
  tripId: z.string().uuid(),
  deviceId: z.string().trim().min(1).max(128),
  logs: z.array(attendanceLogSchema).min(1).max(250),
}).strict().superRefine((payload, context) => {
  const seenCards = new Set();
  payload.logs.forEach((log, index) => {
    if (seenCards.has(log.cardUid)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['logs', index, 'cardUid'], message: 'Duplicate card UID in one batch' });
    }
    seenCards.add(log.cardUid);
  });
});
