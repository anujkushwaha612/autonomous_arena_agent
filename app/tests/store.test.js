'use strict';
// T2: store.js round-trips values atomically and never throws on unknown names.
module.exports = async (t) => {
  const store = t.appRequire('./store');

  t.assert.equal(typeof store.init, 'function', 'store must export init()');
  t.assert.equal(typeof store.read, 'function', 'store must export read()');
  t.assert.equal(typeof store.write, 'function', 'store must export write()');

  store.init();

  // Unknown name → default ({}), not a throw.
  const unknown = store.read(`no-such-store-${Date.now()}`);
  t.assert.truthy(unknown && typeof unknown === 'object', 'unknown store should return an object');
  t.assert.equal(Object.keys(unknown).length, 0, 'unknown store default should be empty');

  // Known defaults exist after init().
  for (const name of ['links', 'clicks', 'keys']) {
    const value = store.read(name);
    t.assert.truthy(value && typeof value === 'object', `${name} should read as an object`);
  }

  // Round-trip: write then read back the exact value.
  const token = `t2-${Date.now()}`;
  const links = store.read('links');
  links[token] = { url: 'https://example.com/store-test', n: 42 };
  store.write('links', links);

  const reread = store.read('links');
  t.assert.truthy(reread[token], 'written record should survive a read');
  t.assert.equal(reread[token].n, 42, 'written value should round-trip unchanged');
  t.assert.equal(reread[token].url, 'https://example.com/store-test', 'url should round-trip');

  // The write landed on disk atomically — no .tmp leftovers.
  const fs = require('fs');
  const file = store.filePath('links');
  t.assert.truthy(fs.existsSync(file), 'links.json should exist on disk');
  t.assert.equal(fs.existsSync(`${file}.tmp`), false, 'no .tmp file should be left behind');
  t.assert.truthy(JSON.parse(fs.readFileSync(file, 'utf8'))[token], 'record should be on disk');

  // Clean up so the store stays tidy for later tasks.
  delete reread[token];
  store.write('links', reread);
  t.assert.equal(store.read('links')[token], undefined, 'cleanup should remove the record');
};
