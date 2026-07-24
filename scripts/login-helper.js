#!/usr/bin/env node
'use strict';
/**
 * One-time login helper. Opens a persistent browser profile so the worker can
 * reuse your Arena session on every subsequent round.
 *
 *   npm run login
 *
 * Sign in, then close the window.
 */

const { chromium } = require('playwright');
const CONFIG = require('../config');

(async () => {
  console.log('Opening persistent browser profile at:', CONFIG.browserProfileDir);

  const context = await chromium.launchPersistentContext(CONFIG.browserProfileDir, {
    headless: false,
    viewport: { width: 1366, height: 900 },
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-infobars',
    ],
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  });

  const page = context.pages()[0] || (await context.newPage());
  await page.goto(CONFIG.newChatUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});

  console.log('\n═══════════════════════════════════════════════════');
  console.log('👉 Sign in to Arena in the browser window.');
  console.log('   When the chat composer is visible, close the window.');
  console.log('   Your session is saved — run `node worker.js` next.');
  console.log('═══════════════════════════════════════════════════\n');

  context.on('close', () => {
    console.log('Session saved.');
    process.exit(0);
  });
})();
