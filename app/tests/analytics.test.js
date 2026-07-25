'use strict';
// T5: Click analytics tests
module.exports = async (t) => {
  const url = `https://example.com/analytics-${Date.now()}`;
  const created = await t.post('/api/links', { url });
  t.assert.equal(created.status, 201, 'should create link for analytics test');
  const code = created.json.code;

  // Initial stats should show zero clicks
  const initialStats = await t.get(`/api/links/${code}/stats`);
  t.assert.equal(initialStats.status, 200, 'GET stats should return 200');
  t.assert.equal(initialStats.json.total, 0, 'total clicks should be 0');
  t.assert.equal(typeof initialStats.json.byDay, 'object', 'byDay should be an object');
  t.assert.equal(Array.isArray(initialStats.json.topReferrers), true, 'topReferrers should be an array');
  t.assert.equal(Array.isArray(initialStats.json.recent), true, 'recent should be an array');

  // Hit GET /:code with custom referer and user-agent
  const longUserAgent = 'A'.repeat(300);
  const redir = await t.get(`/${code}`, {
    'Referer': 'https://search.example.com',
    'User-Agent': longUserAgent,
    'X-Forwarded-For': '203.0.113.195, 10.0.0.1',
  });
  t.assert.equal(redir.status, 302, 'redirect should be 302');
  t.assert.equal(redir.headers.location, url, 'location should match');

  // Fetch stats again
  const stats = await t.get(`/api/links/${code}/stats`);
  t.assert.equal(stats.status, 200);
  t.assert.equal(stats.json.total, 1, 'total clicks should now be 1');
  t.assert.equal(stats.json.topReferrers.length, 1, 'should have 1 top referrer');
  t.assert.equal(stats.json.topReferrers[0].referrer, 'https://search.example.com', 'referrer matches');
  t.assert.equal(stats.json.topReferrers[0].count, 1, 'referrer count is 1');

  t.assert.equal(stats.json.recent.length, 1, 'recent clicks has 1 entry');
  const click = stats.json.recent[0];
  t.assert.equal(click.referrer, 'https://search.example.com');
  t.assert.equal(click.userAgent.length, 200, 'user-agent should be truncated to 200 chars');
  t.assert.equal(click.ip, '203.0.x.x', 'ip should be masked to first two octets');

  // Test top links stats endpoint
  const topRes = await t.get('/api/stats/top?limit=5');
  t.assert.equal(topRes.status, 200, 'GET /api/stats/top should return 200');
  t.assert.equal(Array.isArray(topRes.json.links), true, 'links array present');
  t.assert.truthy(
    topRes.json.links.some((l) => l.code === code),
    'created link should appear in top links'
  );

  // Stats for unknown link should return 404
  const unknownStats = await t.get(`/api/links/nonexistent-${Date.now()}/stats`);
  t.assert.equal(unknownStats.status, 404, 'unknown link stats should return 404');
};
