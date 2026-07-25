import { Request, Response, NextFunction } from 'express';

export class AppError extends Error {
  code: string;
  status: number;
  details?: Record<string, unknown>;

  constructor(
    message: string,
    status: number,
    code: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export function errorMiddleware(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  let status = 500;
  let code = 'INTERNAL';
  let message = 'Internal server error';
  let details: Record<string, unknown> | undefined = undefined;

  if (err instanceof AppError) {
    status = err.status;
    code = err.code;
    message = err.message;
    details = err.details;
  }

  // Never return stack traces to clients
  console.error(`[${(req as any).requestId || '-'}] ${err.message || err}`);

  res.status(status).json({
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  });
}
