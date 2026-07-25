import { Request, Response, NextFunction } from 'express';

function redact(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') return obj;
  const redactedKeys = ['authorization', 'cookie', 'password', 'token'];
  if (Array.isArray(obj)) {
    return obj.map(redact);
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const lower = key.toLowerCase();
    if (redactedKeys.includes(lower)) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = redact(value);
    }
  }
  return result;
}

export function logger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level: 'info',
      requestId: (req as any).requestId || '-',
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs,
    });
    console.log(line);
  });
  next();
}
