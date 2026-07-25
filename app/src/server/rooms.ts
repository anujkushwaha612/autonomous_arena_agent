import { MAX_PLAYERS } from '../shared/constants.js';

export interface Room {
  code: string;
  hostName: string;
  players: Map<string, { name: string; socket: any }>; // simplified
}

const rooms = new Map<string, Room>();

export function createRoom(hostName: string): Room {
  const code = generateCode();
  const room: Room = { code, hostName, players: new Map() };
  rooms.set(code, room);
  return room;
}
export function getRoom(code: string): Room | undefined {
  return rooms.get(code);
}
export function listPlayers(code: string): string[] {
  return Array.from(rooms.get(code)?.players.keys() ?? []);
}
export function destroyRoom(code: string) {
  rooms.delete(code);
}
export function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}
