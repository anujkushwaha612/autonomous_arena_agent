module.exports = async (t) => {
  // Health endpoint
  const health = await t.get('/api/v1/health');
  t.assert.equal(health.status, 200, 'health should return 200');
  t.assert.equal(health.json.status, 'ok', 'health status should be ok');
  t.assert.truthy(typeof health.json.uptime === 'number', 'health uptime should be numeric');

  // Unknown route
  const nope = await t.get('/api/v1/nope');
  t.assert.equal(nope.status, 404, 'unknown route should return 404');
  t.assert.truthy(nope.json.error, '404 response should have error');
  t.assert.truthy(nope.json.error.code, '404 error should have a code');
};
