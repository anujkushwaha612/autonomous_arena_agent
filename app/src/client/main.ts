const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
const socket = new WebSocket(`${protocol}//${location.host}`);
socket.addEventListener('open', () => console.log('WebSocket connected'));
socket.addEventListener('error', () => console.warn('WebSocket connection unavailable'));
