import { MAX_MESSAGE_BYTES, MAX_NAME_LENGTH, MIN_NAME_LENGTH } from '../shared/constants.js';
import type { ClientMsg } from '../shared/types.js';
const printableName = /^[\x20-\x7e]{1,16}$/;
const string = (v: unknown) => typeof v === 'string'; const number = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const kinds = ['reactor','oxygen','lights','comms','doors']; const consoles = ['admin','cameras','vitals','doorlog']; const abilities = ['shield','shift','revert','scan'];
export function parse(raw: unknown): ClientMsg | null {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > MAX_MESSAGE_BYTES) return null;
  let value: unknown; try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const m = value as Record<string, unknown>; const validName = (v: unknown) => string(v) && v.length >= MIN_NAME_LENGTH && v.length <= MAX_NAME_LENGTH && printableName.test(v);
  switch (m.t) {
    case 'join': return string(m.code) && /^[A-Za-z0-9]{4}$/.test(m.code) && validName(m.name) ? m as ClientMsg : null;
    case 'create': case 'quickjoin': return validName(m.name) ? m as ClientMsg : null;
    case 'move': return number(m.dx) && number(m.dy) ? m as ClientMsg : null;
    case 'use': case 'meeting': return m as ClientMsg;
    case 'kill': case 'report': return string(m.targetId ?? m.bodyId) ? m as ClientMsg : null;
    case 'vote': return m.targetId === null || string(m.targetId) ? m as ClientMsg : null;
    case 'chat': return string(m.text) ? m as ClientMsg : null;
    case 'vent': case 'quickchat': case 'pong': return number(m.to ?? m.phraseId ?? m.at) ? m as ClientMsg : null;
    case 'sabotage': return string(m.kind) && kinds.includes(m.kind) ? m as ClientMsg : null;
    case 'taskStep': return string(m.taskId) && number(m.step) ? m as ClientMsg : null;
    case 'ready': return typeof m.value === 'boolean' ? m as ClientMsg : null;
    case 'settings': return m.patch && typeof m.patch === 'object' && !Array.isArray(m.patch) ? m as ClientMsg : null;
    case 'console': return string(m.kind) && consoles.includes(m.kind) && typeof m.open === 'boolean' ? m as ClientMsg : null;
    case 'ability': return string(m.kind) && abilities.includes(m.kind) && (m.targetId === undefined || string(m.targetId)) ? m as ClientMsg : null;
    case 'cosmetic': return ['colour','hat','skin','visor','pet'].every((key) => m[key] === undefined || number(m[key])) ? m as ClientMsg : null;
    case 'mod': return string(m.targetId) && ['kick','ban','votekick'].includes(String(m.action)) ? m as ClientMsg : null;
    default: return null;
  }
}
