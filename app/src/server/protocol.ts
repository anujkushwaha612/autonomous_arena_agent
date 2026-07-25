export function parse(raw: unknown): any {
  if (!raw || typeof raw !== 'object') return null;
  const msg = raw as Record<string, unknown>;
  if (typeof msg.t !== 'string') return null;
  if (msg.t === 'join' && typeof msg.code === 'string' && typeof msg.name === 'string') return msg;
  return null;
}
