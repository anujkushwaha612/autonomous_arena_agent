import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import test, { after } from 'node:test';
import { WebSocket } from 'ws';

const port = 3192;
const child = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], { env: { ...process.env, PORT: String(port) } });
await new Promise((resolve) => child.stdout.once('data', resolve));
await new Promise((resolve) => setTimeout(resolve, 100));
const connect = async () => { const socket = new WebSocket(`ws://127.0.0.1:${port}`); await once(socket, 'open'); return socket; };
const next = async (socket) => JSON.parse(String((await once(socket, 'message'))[0]));
after(() => child.kill());

test('two clients observe a lobby with two players', async () => {
  const first = await connect(); first.send(JSON.stringify({ t:'create', name:'Host' }));
  const joined = await next(first); const snapshot = await next(first); assert.equal(joined.t, 'joined'); assert.equal(snapshot.t, 'snapshot');
  const second = await connect();
  const firstUpdate = Promise.all([next(first), next(first)]);
  const secondUpdate = Promise.all([next(second), next(second)]);
  second.send(JSON.stringify({ t:'join', code:joined.room.code, name:'Host' }));
  const firstMessages = await firstUpdate; const secondMessages = await secondUpdate;
  assert.ok(firstMessages.some((message) => message.t === 'joined' && message.room.players.length === 2));
  assert.ok(secondMessages.some((message) => message.t === 'joined' && message.room.players.length === 2));
  first.close(); second.close();
});
test('joining a missing room returns an error', async () => { const socket = await connect(); socket.send(JSON.stringify({ t:'join', code:'ABCD', name:'Guest' })); assert.equal((await next(socket)).t, 'error'); socket.close(); });
