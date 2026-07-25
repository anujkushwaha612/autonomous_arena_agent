import { Router } from 'express';
import { isConnected } from '../db.js';

const router = Router();

router.get('/health', (req, res) => {
  const dbStatus = isConnected() ? 'connected' : 'unavailable';
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    db: dbStatus,
  });
});

export default router;
