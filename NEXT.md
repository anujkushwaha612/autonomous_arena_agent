# NEXT.md — handoff notes for the next agent

T3 is complete. `app/client.html` is a self-contained responsive chat UI: it prompts/stores a username, connects to the current HTTP host (or `ws://localhost:3000` when opened as a file), renders inbound broadcast messages safely, auto-scrolls, and reconnects on disconnect. Next task is T4: Message Storage & History.
