// client/main.ts — bootstrap & scene switching. T1 only needs the socket
// connection with reconnect UI wired to the landing page; T2+ will add real
// scenes (lobby, hud, meeting...).
import type { HelloMsg } from '../shared/types.js';

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 8000;

type ConnectionState = 'connecting' | 'open' | 'reconnecting' | 'closed';

class SocketManager {
  private socket: WebSocket | null = null;
  private attempt = 0;
  private manuallyClosed = false;

  constructor(private readonly onStateChange: (state: ConnectionState) => void) {}

  connect(): void {
    this.manuallyClosed = false;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}`;
    this.onStateChange(this.attempt === 0 ? 'connecting' : 'reconnecting');

    const socket = new WebSocket(url);
    this.socket = socket;

    socket.addEventListener('open', () => {
      console.log('open');
      this.attempt = 0;
      this.onStateChange('open');
    });

    socket.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data as string) as HelloMsg;
        if (msg.t === 'hello') {
          console.log('[net] hello from server, serverTime=', msg.serverTime);
        }
      } catch (err) {
        console.warn('[net] dropped malformed message', err);
      }
    });

    socket.addEventListener('close', () => {
      if (this.manuallyClosed) {
        this.onStateChange('closed');
        return;
      }
      this.scheduleReconnect();
    });

    socket.addEventListener('error', () => {
      socket.close();
    });
  }

  private scheduleReconnect(): void {
    this.onStateChange('reconnecting');
    const delay = Math.min(
      RECONNECT_MAX_DELAY_MS,
      RECONNECT_BASE_DELAY_MS * 2 ** this.attempt
    );
    this.attempt += 1;
    setTimeout(() => this.connect(), delay);
  }

  close(): void {
    this.manuallyClosed = true;
    this.socket?.close();
  }
}

function setStatusUi(state: ConnectionState): void {
  const el = document.getElementById('conn-status');
  if (!el) return;
  el.dataset.state = state;
  const labels: Record<ConnectionState, string> = {
    connecting: 'Connecting…',
    open: 'Connected',
    reconnecting: 'Reconnecting…',
    closed: 'Disconnected',
  };
  el.textContent = labels[state];
}

function drawStarfield(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  interface Star {
    x: number;
    y: number;
    z: number; // parallax depth layer, 0 = far, 1 = near
    r: number;
    twinklePhase: number;
  }

  let stars: Star[] = [];

  function resize(): void {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const count = Math.floor((canvas.width * canvas.height) / 4000);
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      z: Math.random(),
      r: Math.random() * 1.6 + 0.4,
      twinklePhase: Math.random() * Math.PI * 2,
    }));
  }

  window.addEventListener('resize', resize);
  resize();

  let last = performance.now();
  function frame(now: number): void {
    const dt = (now - last) / 1000;
    last = now;
    if (!ctx) return;

    ctx.fillStyle = '#05070f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (const star of stars) {
      // Parallax drift: nearer stars (higher z) drift faster, giving depth.
      star.x -= (0.5 + star.z * 2.2) * dt * 8;
      if (star.x < -2) star.x = canvas.width + 2;

      star.twinklePhase += dt * (1 + star.z);
      const twinkle = 0.55 + 0.45 * Math.sin(star.twinklePhase);

      ctx.beginPath();
      ctx.fillStyle = `rgba(255,255,255,${(0.35 + star.z * 0.65) * twinkle})`;
      ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
      ctx.fill();
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function boot(): void {
  const canvas = document.getElementById('starfield') as HTMLCanvasElement | null;
  if (canvas) drawStarfield(canvas);

  const manager = new SocketManager(setStatusUi);
  manager.connect();

  window.addEventListener('beforeunload', () => manager.close());
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

type LobbyMessage = { t: 'joined'; you: string; room: { code: string; players: Array<{ id: string; name: string; colour: number; ready: boolean; host: boolean }> } } | { t: 'snapshot'; players: Array<{ id: string; name: string; colour: number; ready: boolean; host: boolean }> } | { t: 'error'; message: string };
const palette = ['#C51111','#132ED1','#117F2D','#ED54BA','#EF7D0D','#F5F557','#3F474E','#D6E0F0','#6B2FBB','#71491E','#38FEDC','#50EF39'];
function setupLobby(): void {
  const create = document.getElementById('create-room') as HTMLButtonElement | null;
  const join = document.getElementById('show-join') as HTMLButtonElement | null;
  const menu = document.getElementById('menu-actions'); const form = document.getElementById('lobby-form') as HTMLFormElement | null;
  const codeField = document.getElementById('code-field'); const code = document.getElementById('room-code') as HTMLInputElement | null;
  const name = document.getElementById('player-name') as HTMLInputElement | null; const error = document.getElementById('lobby-error');
  const view = document.getElementById('lobby-view'); const roster = document.getElementById('player-roster'); const copy = document.getElementById('copy-code') as HTMLButtonElement | null;
  const ready = document.getElementById('ready-toggle') as HTMLButtonElement | null; let mode: 'create' | 'join' = 'create'; let socket: WebSocket | null = null; let isReady = false;
  const showForm = (next: 'create' | 'join') => { mode = next; if (menu) menu.hidden = true; if (form) form.hidden = false; if (codeField) codeField.hidden = mode === 'create'; if (code) code.required = mode === 'join'; const submit = document.getElementById('lobby-submit'); if (submit) submit.textContent = mode === 'join' ? 'Join lobby' : 'Create lobby'; name?.focus(); };
  const showError = (text: string) => { if (!error) return; error.textContent = text; error.classList.remove('shake'); void error.offsetWidth; error.classList.add('shake'); };
  const render = (players: Array<{ id: string; name: string; colour: number; ready: boolean; host: boolean }>) => { if (!roster) return; roster.replaceChildren(...players.map((player) => { const row = document.createElement('div'); row.className = 'roster-player'; row.innerHTML = `<span class="bean-swatch" style="background:${palette[player.colour] ?? palette[0]}"></span><span>${player.name}</span>${player.host ? '<span class="host-crown">★ HOST</span>' : ''}${player.ready ? '<span class="ready-mark">READY</span>' : ''}`; return row; })); };
  const connect = () => { const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'; socket = new WebSocket(`${protocol}//${location.host}`); socket.addEventListener('message', (event) => { let message: LobbyMessage; try { message = JSON.parse(event.data as string) as LobbyMessage; } catch { return; } if (message.t === 'error') showError(message.message); if (message.t === 'joined') { form!.hidden = true; view!.hidden = false; copy!.textContent = message.room.code; render(message.room.players); } if (message.t === 'snapshot') render(message.players); }); socket.addEventListener('open', () => { const playerName = name?.value.trim() ?? ''; socket?.send(JSON.stringify(mode === 'create' ? { t: 'create', name: playerName } : { t: 'join', name: playerName, code: code?.value.trim().toUpperCase() })); }); socket.addEventListener('error', () => showError('Unable to reach the game server.')); };
  create?.addEventListener('click', () => showForm('create')); join?.addEventListener('click', () => showForm('join'));
  document.getElementById('cancel-lobby')?.addEventListener('click', () => { form!.hidden = true; if (menu) menu.hidden = false; });
  form?.addEventListener('submit', (event) => { event.preventDefault(); if (!name?.value.trim()) return showError('Pick a crew name first.'); if (mode === 'join' && !/^[A-Z]{4}$/i.test(code?.value.trim() ?? '')) return showError('Enter the four-letter room code.'); connect(); });
  ready?.addEventListener('click', () => { isReady = !isReady; ready.textContent = isReady ? 'Ready ✓' : 'Ready'; socket?.send(JSON.stringify({ t: 'ready', value: isReady })); });
  copy?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(copy.textContent ?? ''); copy.textContent = 'COPIED!'; setTimeout(() => { if (copy.textContent === 'COPIED!') copy.textContent = copy.dataset.code ?? '----'; }, 900); } catch { showError('Copy the room code manually.'); } });
  copy?.addEventListener('click', () => { if (copy && copy.textContent !== 'COPIED!') copy.dataset.code = copy.textContent; });
}
document.addEventListener('DOMContentLoaded', setupLobby, { once: true });
