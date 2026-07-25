import { MAX_NAME_LENGTH, MAX_PROTOCOL_BYTES } from '../shared/constants.js';
import type { AbilityKind, ClientMsg, ConsoleKind, SabotageKind, Settings } from '../shared/types.js';

const printableName = /^[\x20-\x7E]{1,16}$/;
const code = /^[A-HJ-KM-NP-Z]{4}$/;
const sabotage = new Set<SabotageKind>(['reactor', 'oxygen', 'lights', 'comms', 'doors']);
const consoles = new Set<ConsoleKind>(['admin', 'cameras', 'vitals', 'doorlog']);
const abilities = new Set<AbilityKind>(['shield', 'shift', 'revert', 'scan']);
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const string = (value: unknown, max = 256): value is string => typeof value === 'string' && value.length <= max;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const id = (value: unknown): value is string => string(value, 128) && value.length > 0;
const validName = (value: unknown): value is string => string(value, MAX_NAME_LENGTH) && printableName.test(value.trim());
function settingsPatch(value: unknown): value is Partial<Settings> {
  if (!object(value)) return false;
  const keys = ['mapId', 'impostors', 'confirmEjects', 'discussionSeconds', 'votingSeconds'];
  if (Object.keys(value).some((key) => !keys.includes(key))) return false;
  const impostors = value.impostors, discussion = value.discussionSeconds, voting = value.votingSeconds;
  return (value.mapId === undefined || string(value.mapId, 32))
    && (impostors === undefined || finite(impostors) && Number.isInteger(impostors) && impostors >= 1 && impostors <= 3)
    && (value.confirmEjects === undefined || typeof value.confirmEjects === 'boolean')
    && (discussion === undefined || finite(discussion) && Number.isInteger(discussion) && discussion >= 0 && discussion <= 120)
    && (voting === undefined || finite(voting) && Number.isInteger(voting) && voting >= 15 && voting <= 300);
}
/** Parses exactly one JSON client frame. Invalid input is intentionally silent. */
export function parse(raw: unknown): ClientMsg | null {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > MAX_PROTOCOL_BYTES) return null;
  let msg: unknown; try { msg = JSON.parse(raw); } catch { return null; }
  if (!object(msg) || !string(msg.t, 24)) return null;
  switch (msg.t) {
    case 'create': return validName(msg.name) && Object.keys(msg).length === 2 ? { t: 'create', name: msg.name.trim() } : null;
    case 'join': return validName(msg.name) && string(msg.code, 4) && code.test(msg.code.toUpperCase()) && Object.keys(msg).length === 3 ? { t: 'join', code: msg.code.toUpperCase(), name: msg.name.trim() } : null;
    case 'move': return finite(msg.dx) && finite(msg.dy) && Object.keys(msg).length === 3 ? { t: 'move', dx: msg.dx, dy: msg.dy } : null;
    case 'use': case 'meeting': return Object.keys(msg).length === 1 ? msg as ClientMsg : null;
    case 'kill': case 'report': return id(msg.targetId ?? msg.bodyId) && Object.keys(msg).length === 2 ? msg as ClientMsg : null;
    case 'vote': return (msg.targetId === null || id(msg.targetId)) && Object.keys(msg).length === 2 ? { t: 'vote', targetId: msg.targetId as string | null } : null;
    case 'chat': return string(msg.text, 300) && Object.keys(msg).length === 2 ? { t: 'chat', text: msg.text } : null;
    case 'vent': return finite(msg.to) && Number.isInteger(msg.to) && msg.to >= 0 && msg.to <= 99 && Object.keys(msg).length === 2 ? { t: 'vent', to: msg.to } : null;
    case 'sabotage': return typeof msg.kind === 'string' && sabotage.has(msg.kind as SabotageKind) && Object.keys(msg).length === 2 ? { t: 'sabotage', kind: msg.kind as SabotageKind } : null;
    case 'taskStep': return id(msg.taskId) && finite(msg.step) && Number.isInteger(msg.step) && msg.step >= 0 && msg.step <= 99 && Object.keys(msg).length === 3 ? { t: 'taskStep', taskId: msg.taskId, step: msg.step } : null;
    case 'ready': return typeof msg.value === 'boolean' && Object.keys(msg).length === 2 ? { t: 'ready', value: msg.value } : null;
    case 'settings': return settingsPatch(msg.patch) && Object.keys(msg).length === 2 ? { t: 'settings', patch: msg.patch } : null;
    case 'console': return typeof msg.kind === 'string' && consoles.has(msg.kind as ConsoleKind) && typeof msg.open === 'boolean' && Object.keys(msg).length === 3 ? { t: 'console', kind: msg.kind as ConsoleKind, open: msg.open } : null;
    case 'ability': return typeof msg.kind === 'string' && abilities.has(msg.kind as AbilityKind) && (msg.targetId === undefined || id(msg.targetId)) && Object.keys(msg).every((key) => key === 't' || key === 'kind' || key === 'targetId') ? { t: 'ability', kind: msg.kind as AbilityKind, ...(msg.targetId ? { targetId: msg.targetId as string } : {}) } : null;
    case 'quickchat': return finite(msg.phraseId) && Number.isInteger(msg.phraseId) && msg.phraseId >= 0 && msg.phraseId <= 99 && Object.keys(msg).length === 2 ? { t: 'quickchat', phraseId: msg.phraseId } : null;
    case 'cosmetic': return ['colour', 'hat', 'skin', 'visor', 'pet'].every((key) => msg[key] === undefined || finite(msg[key]) && Number.isInteger(msg[key]) && (msg[key] as number) >= 0 && (msg[key] as number) < 100) && Object.keys(msg).every((key) => key === 't' || ['colour', 'hat', 'skin', 'visor', 'pet'].includes(key)) ? msg as ClientMsg : null;
    case 'quickjoin': return validName(msg.name) && Object.keys(msg).length === 2 ? { t: 'quickjoin', name: msg.name.trim() } : null;
    case 'mod': return (msg.action === 'kick' || msg.action === 'ban' || msg.action === 'votekick') && id(msg.targetId) && Object.keys(msg).length === 3 ? { t: 'mod', action: msg.action, targetId: msg.targetId } : null;
    case 'pong': return finite(msg.at) && Object.keys(msg).length === 2 ? { t: 'pong', at: msg.at } : null;
    default: return null;
  }
}
