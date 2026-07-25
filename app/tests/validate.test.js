'use strict';
// T4: invalid URLs are rejected; valid custom aliases become the code and collide with 409.
module.exports = async (t) => {
  const badText = await t.post('/api/links', { url: 'not-a-url' });
  t.assert.equal(badText.status, 400, 'plain text should not be accepted as a URL');
  t.assert.equal(badText.json.error, 'Invalid URL', 'plain text should return Invalid URL');

  const badScheme = await t.post('/api/links', { url: 'javascript:alert(1)' });
  t.assert.equal(badScheme.status, 400, 'javascript: URLs must be rejected');
  t.assert.equal(badScheme.json.error, 'Invalid URL', 'bad schemes should return Invalid URL');

  const badAlias = await t.post('/api/links', { url: 'https://example.com', alias: 'api' });
  t.assert.equal(badAlias.status, 400, 'reserved aliases must be rejected');
  t.assert.equal(badAlias.json.error, 'Invalid alias', 'reserved aliases return Invalid alias');

  const token = Date.now();
  const alias = `va_${token}`;
  const rawUrl = `  Example.COM/validate-${token}/  `;
  const created = await t.post('/api/links', { url: rawUrl, alias });
  t.assert.equal(created.status, 201, 'valid alias should create a link');
  t.assert.equal(created.json.code, alias, 'custom alias must become the code');
  t.assert.equal(
    created.json.url,
    `https://example.com/validate-${token}/`,
    'stored URL should be normalized'
  );

  const duplicate = await t.post('/api/links', {
    url: `https://example.com/duplicate-${Date.now()}`,
    alias,
  });
  t.assert.equal(duplicate.status, 409, 'duplicate alias should return 409');
  t.assert.equal(duplicate.json.error, 'Alias already in use', 'duplicate alias message should match');
};
