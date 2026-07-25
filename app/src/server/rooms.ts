import { randomUUID } from 'crypto';
import { MAX_PLAYERS, ROOM_CODE_LENGTH } from '../shared/constants.js';
import type { Phase, PlayerView, RoomView, Settings } from '../shared/types.js';

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export interface Player extends PlayerView { joinedAt: number }
export interface Room { code: string; hostId: string; players: Map<string, Player>; phase: Phase; settings: Settings }
const rooms = new Map<string, Room>();

function roomCode(): string {
  let code = '';
  do { code = Array.from({ length: ROOM_CODE_LENGTH }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join(''); } while (rooms.has(code));
  return code;
}
function uniqueName(room: Room, requested: string): string {
  const used = new Set([...room.players.values()].map((player) => player.name.toLowerCase()));
  if (!used.has(requested.toLowerCase())) return requested;
  let suffix = 2;
  while (used.has(`${requested} ${suffix}`.toLowerCase())) suffix++;
  return `${requested} ${suffix}`;
}
function newPlayer(room: Room, name: string): Player {
  const id = randomUUID();
  return { id, name: uniqueName(room, name), x: 0, y: 0, alive: true, host: false, joinedAt: Date.now() };
}
export function createRoom(hostName: string): { room: Room; player: Player } {
  const room: Room = { code: roomCode(), hostId: '', players: new Map(), phase: 'lobby', settings: {} };
  const player = newPlayer(room, hostName); player.host = true; room.hostId = player.id; room.players.set(player.id, player); rooms.set(room.code, room);
  return { room, player };
}
export function joinRoom(code: string, name: string): { room: Room; player: Player; error?: never } | { room?: never; player?: never; error: 'NOT_FOUND'|'ROOM_FULL'|'GAME_STARTED' } {
  const room = rooms.get(code.toUpperCase());
  if (!room) return { error: 'NOT_FOUND' };
  if (room.phase !== 'lobby') return { error: 'GAME_STARTED' };
  if (room.players.size >= MAX_PLAYERS) return { error: 'ROOM_FULL' };
  const player = newPlayer(room, name); room.players.set(player.id, player); return { room, player };
}
export function leaveRoom(code: string, playerId: string): Room | undefined {
  const room = rooms.get(code); if (!room) return undefined;
  const wasHost = room.hostId === playerId; room.players.delete(playerId);
  if (!room.players.size) { destroyRoom(code); return undefined; }
  if (wasHost) { const next = [...room.players.values()].sort((a,b) => a.joinedAt - b.joinedAt)[0]; next.host = true; room.hostId = next.id; }
  return room;
}
export function getRoom(code: string): Room | undefined { return rooms.get(code.toUpperCase()); }
export function listPlayers(room: Room): Player[] { return [...room.players.values()]; }
export function destroyRoom(code: string): boolean { return rooms.delete(code.toUpperCase()); }
export function roomView(room: Room): RoomView { return { code: room.code, phase: room.phase, hostId: room.hostId, players: listPlayers(room).map(({ joinedAt, ...player }) => player), settings: room.settings }; }
export function roomCount(): number { return rooms.size; }
