/**
 * HUMAN-OWNED CROSS-LANE CONTRACT FREEZE.
 *
 * Lane tasks may consume these signatures but may never modify this file. Any
 * API migration is a human-approved control-plane change, not a repair by an
 * implementation agent.
 */
export type Risk = 'low' | 'med' | 'high';
export type ActionKind = 'read' | 'write' | 'exec' | 'net';

export interface Action { kind: ActionKind; path: string }
export interface Decision { allow: boolean; reason: string; risk: Risk }
export interface Event { at: string; action: Action; decision: Decision }
export interface Filter { risk?: Risk; pathPrefix?: string; limit?: number }
export interface Policy { evaluate(action: Action): Decision }
export interface Ledger { append(event: Event): void; query(filter: Filter): Event[] }
