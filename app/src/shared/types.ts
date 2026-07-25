// Shared, wire-safe state and protocol types. Server messages are deliberately
// split into public RoomView/PlayerView and private SelfView for future roles.
export type Role = 'crewmate' | 'impostor' | 'engineer' | 'scientist' | 'guardian' | 'shapeshifter';
export type SabotageKind = 'reactor' | 'oxygen' | 'lights' | 'comms' | 'doors';
export type ConsoleKind = 'admin' | 'cameras' | 'vitals' | 'doorlog';
export type AbilityKind = 'shield' | 'shift' | 'revert' | 'scan';
export type GamePhase = 'lobby' | 'playing' | 'meeting' | 'ended';

export interface HealthResponse { status: 'ok'; rooms: number; uptime: number; }
export interface HelloMsg { t: 'hello'; serverTime: number; }
export interface Settings { mapId: string; impostors: number; confirmEjects: boolean; discussionSeconds: number; votingSeconds: number; }
export interface PlayerView { id: string; name: string; colour: number; hat: number; ready: boolean; host: boolean; alive: boolean; x: number; y: number; }
export interface SelfView extends PlayerView { role: Role; tasks: TaskView[]; killCooldownEndsAt?: number; }
export interface TaskView { id: string; kind: string; complete: boolean; step: number; steps: number; }
export interface RoomView { code: string; phase: GamePhase; hostId: string; players: PlayerView[]; settings: Settings; createdAt: number; }

export type ClientMsg =
  | { t: 'join'; code: string; name: string } | { t: 'create'; name: string }
  | { t: 'move'; dx: number; dy: number } | { t: 'use' } | { t: 'kill'; targetId: string }
  | { t: 'report'; bodyId: string } | { t: 'meeting' } | { t: 'vote'; targetId: string | null }
  | { t: 'chat'; text: string } | { t: 'vent'; to: number } | { t: 'sabotage'; kind: SabotageKind }
  | { t: 'taskStep'; taskId: string; step: number } | { t: 'ready'; value: boolean }
  | { t: 'settings'; patch: Partial<Settings> } | { t: 'console'; kind: ConsoleKind; open: boolean }
  | { t: 'ability'; kind: AbilityKind; targetId?: string } | { t: 'quickchat'; phraseId: number }
  | { t: 'cosmetic'; colour?: number; hat?: number; skin?: number; visor?: number; pet?: number }
  | { t: 'quickjoin'; name: string } | { t: 'mod'; action: 'kick' | 'ban' | 'votekick'; targetId: string }
  | { t: 'pong'; at: number };

export type ServerMsg = HelloMsg
  | { t: 'joined'; you: string; room: RoomView } | { t: 'snapshot'; tick: number; players: PlayerView[]; you: SelfView }
  | { t: 'phase'; phase: GamePhase; endsAt?: number } | { t: 'meeting'; reason: 'report' | 'emergency'; bodyId?: string; by: string }
  | { t: 'votes'; tally: Record<string, number>; revealed: boolean } | { t: 'ejected'; playerId: string | null; wasImpostor: boolean | null }
  | { t: 'tasks'; list: TaskView[]; progress: number } | { t: 'sabotage'; kind: SabotageKind | null; endsAt?: number }
  | { t: 'chat'; from: string; text: string; at: number } | { t: 'ended'; winner: 'crew' | 'impostor'; reason: string; reveal: Role[] }
  | { t: 'error'; code: string; message: string } | { t: 'console'; kind: ConsoleKind; data: unknown }
  | { t: 'visual'; kind: string; playerId: string; at: number } | { t: 'ability'; kind: AbilityKind; by: string; ok: boolean }
  | { t: 'ping'; at: number } | { t: 'kicked'; reason: string };
