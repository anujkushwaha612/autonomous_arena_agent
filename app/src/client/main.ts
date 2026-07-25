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
