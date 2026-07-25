const res = await fetch('http://localhost:3000/api/health');
const j = await res.json();
console.assert(j.status === 'ok');
console.assert(typeof j.rooms === 'number');
console.log('health ok', j);
