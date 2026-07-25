export default async (t) => {
  const health = await t.get('/api/health');
  t.assert.equal(health.status, 200);
  t.assert.equal(health.json?.status, 'ok');
  t.assert.equal(health.json?.rooms, 0);

  const home = await t.get('/');
  t.assert.equal(home.status, 200);
  t.assert.truthy(home.text.includes('<canvas'));

  const traversal = await t.get('/../package.json');
  t.assert(!traversal.text.includes('"name": "impostor"'), 'static hosting must not expose source');
};
