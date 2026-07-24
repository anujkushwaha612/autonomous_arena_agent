// login-helper.js
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const profileDir = path.join(process.cwd(), '.arena-profile');
  console.log('Opening persistent browser context at:', profileDir);

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: { width: 1366, height: 900 },
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-infobars'
    ],
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
  });

  const page = context.pages()[0] || (await context.newPage());
  
  // Go directly to google sign-in/accounts page
  await page.goto('https://accounts.google.com', { waitUntil: 'domcontentloaded' });

  console.log('\n=============================================================');
  console.log('👉 PLEASE SIGN IN TO YOUR GOOGLE ACCOUNT IN THE BROWSER WINDOW.');
  console.log('Once signed in successfully, navigate to: https://arena.ai/agent');
  console.log('After logging in, you can close the browser window.');
  console.log('=============================================================\n');

  // Keep it open until closed by user
  page.on('close', () => {
    console.log('Browser window closed. Persistent session saved successfully.');
    process.exit(0);
  });
})();
