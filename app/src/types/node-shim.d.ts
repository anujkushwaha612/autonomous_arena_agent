declare module 'node:http' { const http: any; export default http; }
declare module 'node:fs' { const fs: any; export default fs; }
declare module 'node:path' { const path: any; export default path; }
declare module 'node:url' { export const fileURLToPath: any; }
declare module 'ws' { export const WebSocketServer: any; }
declare const process: { env: Record<string, string | undefined>; uptime(): number; };
