const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE_URL = process.env.BASE_URL || 'http://gdss_app:3000';
const outDir = path.join(__dirname, '..', '..', 'screenshots');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const viewports = [
  { name: '1280px', width: 1280, height: 900 },
  { name: '375px', width: 375, height: 750 },
];

async function run() {
  console.log(`Connecting to ${BASE_URL}...`);
  const browser = await chromium.launch({
    executablePath: '/ms-playwright/chromium-1140/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    for (const vp of viewports) {
      console.log(`\n========================================`);
      console.log(`Capturing viewport: ${vp.name} (${vp.width}x${vp.height})`);
      console.log(`========================================`);

      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 2,
      });
      const page = await context.newPage();

      // 1. Landing page
      console.log('Navigating to landing page...');
      await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
      await page.waitForSelector('h1', { state: 'visible', timeout: 10000 });
      await page.waitForTimeout(400);
      const landingFile = path.join(outDir, `landing-${vp.name}.png`);
      await page.screenshot({ path: landingFile, fullPage: true });
      console.log(`Saved: landing-${vp.name}.png`);

      // 2. Login page (clean)
      console.log('Navigating to login page...');
      await page.goto(`${BASE_URL}/auth/login`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#login-email', { state: 'visible', timeout: 10000 });
      await page.waitForTimeout(300);
      const loginFile = path.join(outDir, `login-${vp.name}.png`);
      await page.screenshot({ path: loginFile, fullPage: true });
      console.log(`Saved: login-${vp.name}.png`);

      // 3. Login page with error
      console.log('Submitting invalid credentials to trigger error message...');
      await page.fill('#login-email', 'usuario_inexistente@ejemplo.com');
      await page.fill('#login-password', 'ClaveInvalida999!');
      await page.click('button[type="submit"]');
      await page.waitForSelector('#auth-error-message', { state: 'visible', timeout: 10000 });
      await page.waitForTimeout(300);
      const loginErrorFile = path.join(outDir, `login-error-${vp.name}.png`);
      await page.screenshot({ path: loginErrorFile, fullPage: true });
      console.log(`Saved: login-error-${vp.name}.png`);

      // 4. Register page (clean)
      console.log('Navigating to register page...');
      await page.goto(`${BASE_URL}/auth/register`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#register-name', { state: 'visible', timeout: 10000 });
      await page.waitForTimeout(300);
      const registerFile = path.join(outDir, `registro-${vp.name}.png`);
      await page.screenshot({ path: registerFile, fullPage: true });
      console.log(`Saved: registro-${vp.name}.png`);

      await context.close();
    }

    console.log('\nAll landing and auth screenshots captured successfully!');
  } catch (err) {
    console.error('Capture error:', err);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

run();
