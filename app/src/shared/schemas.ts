import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  uptime: z.number(),
  db: z.enum(['connected', 'unavailable', 'memory']),
});
