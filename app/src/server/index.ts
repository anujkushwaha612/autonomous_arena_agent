import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { connect, isConnected } from './db.js';
import healthRouter from './routes/health.js';
import { requestIdMiddleware } from './middleware/requestId.js';
import { logger } from './middleware/logger.js';
import { errorMiddleware } from './middleware/errors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp(): express.Application {
  const app = express();

  // Request ID
  app.use(requestIdMiddleware);

  // Structured logging
  app.use(logger);

  // JSON body parsing with 1 MB limit
  app.use(express.json({ limit: '1mb' }));

  // Health endpoint
  app.use('/api/v1', healthRouter);

  // Production/static serving: serve built React app on same port
  const distPath = path.resolve(__dirname, '../../dist/client');
  try {
    const fs = require('fs');
    if (fs.existsSync(distPath)) {
      // Static assets first
      app.use(express.static(distPath));
      // Fall through to index.html for client-side routes (not /api/*)
      app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api/')) return next();
        const indexPath = path.join(distPath, 'index.html');
        if (fs.existsSync(indexPath)) {
          res.sendFile(indexPath);
        } else {
          next();
        }
      });
    }
  } catch {
    // No built client available yet — skip static serving
  }

  // 404 handler for anything that didn't match (including missing API routes)
  app.use((req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: `Route ${req.method} ${req.path} not found`,
      },
    });
  });

  // Central error middleware must come last
  app.use(errorMiddleware);

  return app;
}

async function main() {
  await connect();

  const app = createApp();

  const PORT = Number(process.env.PORT) || 3000;
  const server = app.listen(PORT, () => {
    console.log(`RepLog server listening on port ${PORT}`);
    console.log(`DB status: ${isConnected() ? 'connected' : 'unavailable'}`);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('SIGTERM received — graceful shutdown');
    server.close(async () => {
      await import('./db.js').then((db) => db.disconnect());
      process.exit(0);
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.includes('index')) {
  main().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
