'use strict';
// T3: create a link, fetch it, follow the redirect, delete it, confirm it 404s.
module.exports = async (t) => {
  const url = `https://example.com/t3-${Date.now()}`;
  const created = await t.post('/api/links', { url });
  t.assert.equal(created.status, 201, 'POST /api/links should return 201');
  t.assert.truthy(created.json.code, 'response must include a code');
  t.assert.equal(created.json.url, url, 'response url must echo the target');
  t.assert.truthy(created.json.shortUrl, 'response must include a shortUrl');
  t.assert.truthy(created.json.createdAt, 'response must include createdAt');

  const code = created.json.code;

  // Fetch the stored link by code.
  const fetched = await t.get(`/api/links/${code}`);
  t.assert.equal(fetched.status, 200, 'GET /api/links/:code should return 200');
  t.assert.equal(fetched.json.code, code, 'fetched link should match the code');
  t.assert.equal(fetched.json.url, url, 'fetched url should match');
  t.assert.equal(fetched.json.clicks, 0, 'a fresh link has zero clicks');

  // It shows up in the list.
  const list = await t.get('/api/links');
  t.assert.equal(list.status, 200, 'GET /api/links should return 200');
  t.assert.equal(typeof list.json.total, 'number', 'list response has a total');
  t.assert.truthy(
    list.json.links.some((l) => l.code === code),
    'new link should appear in the list'
  );

  // The redirect: 302 with the correct Location (smoke client does not follow).
  const redir = await t.get(`/${code}`);
  t.assert.equal(redir.status, 302, 'GET /:code should return 302');
  t.assert.equal(
    redir.headers.location,
    url,
    'Location header should point at the target URL'
  );

  // Unknown code redirects nowhere.
  const missing = await t.get(`/no-such-${Date.now()}`);
  t.assert.equal(missing.status, 404, 'unknown code should return 404');
  t.assert.truthy(missing.json && missing.json.error, '404 body must have an error');

  // Delete it.
  const removed = await t.del(`/api/links/${code}`);
  t.assert.equal(removed.status, 204, 'DELETE should return 204');
  const after = await t.get(`/api/links/${code}`);
  t.assert.equal(after.status, 404, 'deleted link should now 404');
  const redirAfter = await t.get(`/${code}`);
  t.assert.equal(redirAfter.status, 404, 'redirect for a deleted link should 404');

  // Deleting again is a 404.
  const again = await t.del(`/api/links/${code}`);
  t.assert.equal(again.status, 404, 'deleting a missing link should return 404');
};
