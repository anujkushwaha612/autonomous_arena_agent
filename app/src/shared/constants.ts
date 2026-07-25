// shared/constants.ts — every tuning constant lives here. No magic numbers
// scattered through game logic. Both client and server import from this file.

/** Server tick rate for the authoritative game loop (T5+). */
export const TICK_RATE_HZ = 20;
export const TICK_MS = 1000 / TICK_RATE_HZ;

/** Room codes are 4 uppercase letters, e.g. "ABCD". */
export const ROOM_CODE_LENGTH = 4;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O, avoid confusion

/** Lobby / room sizing. */
export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 12;
export const MAX_NAME_LENGTH = 16;

/** Networking. */
export const HEARTBEAT_INTERVAL_MS = 15000;
export const RECONNECT_GRACE_MS = 30000;

/** Colour-blind-safe crewmate palette (hex) paired with a body pattern id.
 * Real Among Us ships ~18 colours; we ship a representative safe subset with
 * distinct patterns so colour is never the only signal. */
export const PLAYER_COLOURS: ReadonlyArray<{
  id: string;
  hex: string;
  pattern: 'solid' | 'stripe' | 'dot' | 'chevron' | 'diamond' | 'grid';
}> = [
  { id: 'red', hex: '#C51111', pattern: 'solid' },
  { id: 'blue', hex: '#132ED1', pattern: 'stripe' },
  { id: 'green', hex: '#117F2D', pattern: 'dot' },
  { id: 'pink', hex: '#ED54BA', pattern: 'chevron' },
  { id: 'orange', hex: '#EF7D0D', pattern: 'diamond' },
  { id: 'yellow', hex: '#F5F557', pattern: 'grid' },
  { id: 'black', hex: '#3F474E', pattern: 'stripe' },
  { id: 'white', hex: '#D6E0F0', pattern: 'dot' },
  { id: 'purple', hex: '#6B2FBB', pattern: 'chevron' },
  { id: 'brown', hex: '#71491E', pattern: 'diamond' },
  { id: 'cyan', hex: '#38FEDC', pattern: 'grid' },
  { id: 'lime', hex: '#50EF39', pattern: 'solid' },
];

/** Movement (introduced fully in T4, defined now so nothing is a magic number
 * later). Units are world-space pixels per tick at TICK_RATE_HZ. */
export const PLAYER_RADIUS = 18;
export const PLAYER_SPEED_PX_S = 110;

/** Health endpoint. */
export const SERVER_VERSION = '0.1.0';

/** Authoritative game tuning, in map units / seconds. */
export const CREW_SPEED = 2.0;
export const IMPOSTOR_SPEED = 2.2;
export const KILL_RADIUS = 1.5;
export const CREW_VISION = 3.5;
export const IMPOSTOR_VISION = 4.5;
export const GHOST_VISION = 99;
export const KILL_COOLDOWN_SECONDS = 25;
export const ROOM_TTL_MS = 30 * 60 * 1000;
export const ROOM_CLEAN_INTERVAL_MS = 60 * 1000;
export const MAX_PROTOCOL_BYTES = 4 * 1024;
