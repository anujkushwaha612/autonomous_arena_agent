'use strict';
/**
 * Ingest server — the out-of-band patch channel.
 *
 * The agent uploads raw (gzipped) patch bytes straight from its sandbox and
 * types only a 12-char receipt into chat. Nothing large ever travels through
 * the chat renderer, so there is no base64, no markdown corruption, and no
 * truncation risk.
 *
 * Exported as a module so worker.js can boot it in-process (`node worker.js`
 * is the only command you need). Also runnable standalone: `npm run ingest`.
 */

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MAX_BYTES = 25 * 1024 * 1024;

function startIngest({ port, token, dropDir, quiet = false }) {
  fs.mkdirSync(dropDir, { recursive: true });

  const log = (...a) => { if (!quiet) console.log(...a); };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/health') {
      return json(res, 200, { ok: true });
    }

    if (req.method !== 'POST' || url.pathname !== '/patch') {
      return json(res, 404, { error: 'not found' });
    }

    // Shared secret so a stray scanner can't inject commits into your repo.
    if (req.headers['x-agent-token'] !== token) {
      log('  ⚠️  rejected upload with bad token');
      return json(res, 401, { error: 'bad token' });
    }

    const chunks = [];
    let size = 0;
    let aborted = false;

    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BYTES) {
        aborted = true;
        json(res, 413, { error: 'too large' });
        req.destroy();
        return;
      }
      chunks.push(c);
    });

    req.on('end', () => {
      if (aborted) return;

      // Raw Buffer concat — never .toString() the body. Stringifying binary
      // payloads is exactly how text-logging receivers corrupt gzip bytes.
      const raw = Buffer.concat(chunks);
      if (!raw.length) return json(res, 400, { error: 'empty body' });

      let body = raw;
      if (raw[0] === 0x1f && raw[1] === 0x8b) {
        try {
          body = zlib.gunzipSync(raw);
        } catch (e) {
          return json(res, 400, { error: 'bad gzip: ' + e.message });
        }
      }

      const sha = crypto.createHash('sha256').update(body).digest('hex');
      const receipt = sha.slice(0, 12);
      const kind = url.searchParams.get('kind') === 'bundle' ? 'bundle' : 'patch';
      const round = url.searchParams.get('round') || '0';
      const file = path.join(dropDir, `${receipt}.${kind}`);

      fs.writeFileSync(file, body);
      fs.writeFileSync(
        path.join(dropDir, `${receipt}.meta.json`),
        JSON.stringify(
          {
            receipt,
            sha256: sha,
            kind,
            round,
            bytes: body.length,
            wireBytes: raw.length,
            receivedAt: new Date().toISOString(),
            file,
          },
          null,
          2
        )
      );

      log(`  📦 drop ${receipt}  kind=${kind}  ${raw.length}B wire → ${body.length}B patch`);
      json(res, 200, { receipt, sha256: sha, bytes: body.length });
    });
  });

  function json(res, code, obj) {
    const b = Buffer.from(JSON.stringify(obj));
    res.writeHead(code, { 'content-type': 'application/json', 'content-length': b.length });
    res.end(b);
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      log(`  ✅ ingest listening on :${port}  → ${dropDir}`);
      resolve(server);
    });
  });
}

module.exports = { startIngest };

// Standalone mode: npm run ingest
if (require.main === module) {
  const CONFIG = require('../config');
  startIngest({
    port: CONFIG.ingestPort,
    token: CONFIG.ingestToken,
    dropDir: CONFIG.dropDir,
  }).catch((e) => {
    console.error('ingest failed to start:', e.message);
    process.exit(1);
  });
}
