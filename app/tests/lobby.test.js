export default async (t) => {
  const WebSocket = t.appRequire('ws');
  const connect = () => new Promise((resolve, reject) => {
    const ws = new WebSocket(t.wsUrl);
    const messages = [];
    ws.on('message', (raw) => { messages.push(JSON.parse(raw)); });
    ws.on('open', () => resolve({ ws, messages }));
    ws.on('error', reject);
  });
  const waitFor = (client, predicate) => new Promise((resolve, reject) => {
    const found = client.messages.find(predicate); if (found) return resolve(found);
    const timer = setTimeout(() => reject(new Error('timed out waiting for websocket frame')), 2000);
    client.ws.on('message', (raw) => { const message = JSON.parse(raw); if (predicate(message)) { clearTimeout(timer); resolve(message); } });
  });
  const host = await connect(); host.ws.send(JSON.stringify({ t: 'create', name: 'Host' }));
  const joined = await waitFor(host, (m) => m.t === 'joined');
  const guest = await connect(); guest.ws.send(JSON.stringify({ t: 'join', code: joined.room.code, name: 'Guest' }));
  const guestJoined = await waitFor(guest, (m) => m.t === 'joined');
  t.assert.equal(guestJoined.room.players.length, 2);
  const hostSnapshot = await waitFor(host, (m) => m.t === 'snapshot' && m.players.length === 2);
  t.assert.equal(hostSnapshot.players.length, 2);
  const invalid = await connect(); invalid.ws.send(JSON.stringify({ t: 'join', code: 'ZZZZ', name: 'Lost' }));
  const error = await waitFor(invalid, (m) => m.t === 'error');
  t.assert.equal(error.code, 'ROOM_NOT_FOUND');
  host.ws.close(); guest.ws.close(); invalid.ws.close();
};
