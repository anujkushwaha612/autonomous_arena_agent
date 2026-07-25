export type Phase = 'lobby' | 'playing' | 'meeting' | 'ended';
export type SabotageKind = 'reactor' | 'oxygen' | 'lights' | 'comms' | 'doors';
export type ConsoleKind = 'admin' | 'cameras' | 'vitals' | 'doorlog';
export type AbilityKind = 'shield' | 'shift' | 'revert' | 'scan';
export type Role = 'crewmate' | 'impostor';

export interface Settings { public?: boolean; maxPlayers?: number; mapId?: string; impostors?: number; [key: string]: unknown }
export interface PlayerView { id: string; name: string; x: number; y: number; alive: boolean; host: boolean }
export interface SelfView extends PlayerView { role?: Role }
export interface RoomView { code: string; phase: Phase; hostId: string; players: PlayerView[]; settings: Settings }

export type ClientMsg =
 | { t:'join'; code:string; name:string } | { t:'create'; name:string }
 | { t:'move'; dx:number; dy:number } | { t:'use' } | { t:'kill'; targetId:string }
 | { t:'report'; bodyId:string } | { t:'meeting' } | { t:'vote'; targetId:string | null }
 | { t:'chat'; text:string } | { t:'vent'; to:number } | { t:'sabotage'; kind:SabotageKind }
 | { t:'taskStep'; taskId:string; step:number } | { t:'ready'; value:boolean }
 | { t:'settings'; patch:Partial<Settings> } | { t:'console'; kind:ConsoleKind; open:boolean }
 | { t:'ability'; kind:AbilityKind; targetId?:string } | { t:'quickchat'; phraseId:number }
 | { t:'cosmetic'; colour?:number; hat?:number; skin?:number; visor?:number; pet?:number }
 | { t:'quickjoin'; name:string } | { t:'mod'; action:'kick'|'ban'|'votekick'; targetId:string }
 | { t:'pong'; at:number };

export type ServerMsg =
 | { t:'joined'; you:string; room:RoomView } | { t:'snapshot'; tick:number; players:PlayerView[]; you:SelfView }
 | { t:'phase'; phase:Phase; endsAt?:number } | { t:'error'; code:string; message:string }
 | { t:'ping'; at:number } | { t:'kicked'; reason:string };
