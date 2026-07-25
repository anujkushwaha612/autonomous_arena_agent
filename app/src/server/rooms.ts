import { randomUUID } from 'node:crypto';
import { MAX_PLAYERS, PLAYER_COLOURS, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, ROOM_CLEAN_INTERVAL_MS, ROOM_TTL_MS } from '../shared/constants.js';
import type { GamePhase, PlayerView, RoomView, Settings } from '../shared/types.js';

export interface Player extends PlayerView { joinedAt: number; }
export interface Room { code: string; createdAt: number; lastActiveAt: number; phase: GamePhase; hostId: string; players: Map<string, Player>; settings: Settings; }
export type RoomResult = { room: Room; player: Player } | { error: 'ROOM_NOT_FOUND' | 'ROOM_FULL' };

const rooms = new Map<string, Room>();
const CODE_LETTERS = [...ROOM_CODE_ALPHABET].filter((letter) => !'IOL'.includes(letter));
// Common, non-ambiguous consonants appear twice. This yields pronounceable-ish
// codes without creating a curated word list (and avoids accidental profanity).
const WEIGHTED_CODE_LETTERS = CODE_LETTERS.flatMap((letter) => 'AEU'.includes(letter) ? [letter] : [letter, letter]);
const DEFAULT_SETTINGS: Settings = { mapId: 'skeld', impostors: 1, confirmEjects: false, discussionSeconds: 15, votingSeconds: 90 };

function allocateCode(): string {
  for (let attempt = 0; attempt < 256; attempt += 1) {
    let code = '';
    for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) code += WEIGHTED_CODE_LETTERS[Math.floor(Math.random() * WEIGHTED_CODE_LETTERS.length)];
    if (!rooms.has(code)) return code;
  }
  throw new Error('Unable to allocate room code');
}
function uniqueName(room: Room, requested: string): string {
  const used = new Set([...room.players.values()].map((player) => player.name.toLocaleLowerCase()));
  if (!used.has(requested.toLocaleLowerCase())) return requested;
  for (let suffix = 2; suffix <= MAX_PLAYERS; suffix += 1) {
    const candidate = `${requested.slice(0, Math.max(1, 16 - String(suffix).length - 1))} ${suffix}`;
    if (!used.has(candidate.toLocaleLowerCase())) return candidate;
  }
  return requested;
}
function makePlayer(room: Room, name: string): Player {
  const joinedAt = Date.now();
  return { id: randomUUID(), name: uniqueName(room, name), colour: room.players.size % PLAYER_COLOURS.length, hat: 0, ready: false, host: room.players.size === 0, alive: true, x: 0, y: 0, joinedAt };
}
export function createRoom(hostName: string): { room: Room; player: Player } {
  const now = Date.now(); const code = allocateCode();
  const room: Room = { code, createdAt: now, lastActiveAt: now, phase: 'lobby', hostId: '', players: new Map(), settings: { ...DEFAULT_SETTINGS } };
  const player = makePlayer(room, hostName); room.hostId = player.id; room.players.set(player.id, player); rooms.set(code, room);
  return { room, player };
}
export function joinRoom(code: string, name: string): RoomResult {
  const room = rooms.get(code.toUpperCase());
  if (!room) return { error: 'ROOM_NOT_FOUND' };
  if (room.players.size >= MAX_PLAYERS) return { error: 'ROOM_FULL' };
  const player = makePlayer(room, name); room.players.set(player.id, player); room.lastActiveAt = Date.now(); return { room, player };
}
export function leaveRoom(code: string, playerId: string): { room?: Room; promoted?: Player } {
  const room = rooms.get(code); if (!room || !room.players.delete(playerId)) return {};
  room.lastActiveAt = Date.now();
  if (room.players.size === 0) { rooms.delete(code); return {}; }
  let promoted: Player | undefined;
  if (room.hostId === playerId) { promoted = [...room.players.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0]; promoted.host = true; room.hostId = promoted.id; }
  return { room, promoted };
}
export function getRoom(code: string): Room | undefined { return rooms.get(code.toUpperCase()); }
export function listPlayers(room: Room): PlayerView[] { return [...room.players.values()].map(({ joinedAt: _joinedAt, ...player }) => ({ ...player })); }
export function roomView(room: Room): RoomView { return { code: room.code, phase: room.phase, hostId: room.hostId, players: listPlayers(room), settings: { ...room.settings }, createdAt: room.createdAt }; }
export function destroyRoom(code: string): boolean { return rooms.delete(code.toUpperCase()); }
export function getRoomCount(): number { return rooms.size; }
export function cleanExpiredRooms(now = Date.now()): void { for (const room of rooms.values()) if (now - room.lastActiveAt > ROOM_TTL_MS) rooms.delete(room.code); }
const cleaner = setInterval(cleanExpiredRooms, ROOM_CLEAN_INTERVAL_MS); cleaner.unref();
