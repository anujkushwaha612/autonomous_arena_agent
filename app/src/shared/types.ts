// shared/types.ts — message & entity types shared by client and server.
//
// T1 only needs the health payload and a minimal socket handshake; later
// tasks (T2+) extend the ClientMsg/ServerMsg discriminated unions here.
// Rule: once a field ships it is frozen — only add, never rename or remove.

export interface HealthResponse {
  status: 'ok';
  rooms: number;
  uptime: number;
}

/** Sent by the server the instant a websocket connection is accepted, purely
 * so the client can confirm the transport is alive before any room exists. */
export interface HelloMsg {
  t: 'hello';
  serverTime: number;
}
