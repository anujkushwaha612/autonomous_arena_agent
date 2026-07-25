'use strict';
// T1: GET /api/health returns 200 + status ok; unknown paths 404 with an error field.
module.exports = async (t) => {
  const res = await t.get('/api/health');
  t.assert.equal(res.status, 200, 'health endpoint should return 200');
  t.assert.equal(res.json.status, 'ok', 'health status should be "ok"');
  t.assert.equal(typeof res.json.uptime, 'number', 'uptime should be a number of seconds');

  const missing = await t.get(`/api/no-such-route-${Date.now()}`);
  t.assert.equal(missing.status, 404, 'unknown path should return 404');
  t.assert.truthy(missing.json && missing.json.error, '404 body should include an error field');
};
