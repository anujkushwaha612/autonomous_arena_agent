import { Request, Response, NextFunction } from 'express';

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  (req as any).requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}
