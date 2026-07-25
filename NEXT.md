# T2 handoff — rooms, protocol & lobby

Implemented the complete T2 lobby layer:

- `src/server/rooms.ts` owns ephemeral 4-letter room allocation, player naming/colours, room TTL cleanup, host transfer to the longest-present member, player limits, and public room views.
- `src/server/protocol.ts` strictly parses every currently specified protocol variant: JSON frames are capped at 4 KB; unknown keys, malformed nested values, invalid names/codes, and unknown message types are rejected.
- `src/server/index.ts` attaches sockets to rooms, broadcasts authoritative lobby snapshots on membership and ready changes, sends `joined` only to the member, preserves error connections, and removes a player on disconnect. Health room count is now live.
- The landing menu now has an Among Us-styled create/join form, animated validation feedback, copyable large room code, colour bean roster, host marker, and ready state.
- Added `tests/lobby.test.js`, which connects actual WebSocket clients and checks shared membership plus a non-disconnecting invalid-code error.

Verification: `npm run typecheck`, `npm run build`, and `node fastcapture/smoke.js` all pass (health + lobby tests).

One implementation detail for later work: `Room` intentionally carries only lobby-ready state; gameplay should extend it rather than place game state in the socket session map. T3 is next: create data-driven map geometry/collision and begin rendering it from shared map data.
