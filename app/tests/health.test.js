// tests/health.test.js — committed per T1's requirement. Verifies the server
// boots, serves the health endpoint, serves the landing page, and refuses
// path traversal outside public/.
export default async (t) => {
  const health = await t.get('/api/health');
  t.assert.equal(health.status, 200, 'GET /api/health should return 200');
  t.assert.truthy(health.json, 'health response should be JSON');
  t.assert.equal(health.json.status, 'ok', 'health status should be "ok"');
  t.assert.truthy(
    typeof health.json.rooms === 'number',
    'health.rooms should be a number'
  );

  const root = await t.get('/');
  t.assert.equal(root.status, 200, 'GET / should return 200');
  t.assert.truthy(
    root.text.includes('<html'),
    'GET / should return HTML'
  );

  const traversal = await t.get('/../package.json');
  t.assert.truthy(
    !traversal.text.includes('"name": "impostor"') &&
      !(traversal.json && traversal.json.name === 'impostor'),
    'GET /../package.json must not leak repository source'
  );
};
