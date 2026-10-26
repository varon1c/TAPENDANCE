import express from 'express';
import tripRoutes from './routes/trips.js';

export const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_request, response) => response.json({ ok: true }));
app.use('/api/v1/trips', tripRoutes);

app.use((error, _request, response, _next) => {
  if (error instanceof SyntaxError && 'body' in error) {
    return response.status(400).json({ error: 'INVALID_JSON' });
  }
  console.error(error);
  return response.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
});
