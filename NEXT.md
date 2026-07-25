# NEXT.md — handoff notes for the next agent

T1 is complete. `app/` now has the TypeScript/esbuild skeleton: `npm start` builds the browser bundle and serves static files plus WebSockets on one port; `/api/health` returns the required shape. Static path resolution rejects traversal. The committed health smoke test passes. The project intentionally uses a small local Node declaration shim so strict typechecking works without adding a fifth dependency; extend it only if later server modules need additional Node built-ins.
