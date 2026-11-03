const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE_URL = process.env.BASE_URL || 'http://gdss_app:3000';
const outDir = path.join(__dirname, '..', 'screenshots');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const viewports = [
  { name: '1280px', width: 1280, height: 900 },
  { name: '375px', width: 375, height: 750 },
];

async function loginAsHost(page) {
  console.log('Logging in as host...');
  await page.goto(`${BASE_URL}/auth/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', 'docente@universidad.edu');
  await page.fill('input[type="password"]', 'DocentePass123!');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard', { timeout: 15000 });
  await page.waitForSelector('table', { state: 'visible', timeout: 10000 });
}

async function preparePageForFullScreenshot(page) {
  await page.evaluate(() => {
    const header = document.querySelector('header');
    if (header) header.style.position = 'relative';
    const aside = document.querySelector('aside');
    if (aside) {
      aside.style.position = 'absolute';
      aside.style.height = '100%';
    }
  });
}

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

      // 1. Dashboard con lista de salas en cada estado
      await loginAsHost(page);
      await page.waitForTimeout(500);
      await preparePageForFullScreenshot(page);
      const file1 = path.join(outDir, `dashboard-salas-${vp.name}.png`);
      await page.screenshot({ path: file1, fullPage: true });
      console.log(`Saved: dashboard-salas-${vp.name}.png`);

      // 2. Formulario vacío de nueva sala
      console.log('Navigating to /dashboard/rooms/new (empty)...');
      await page.goto(`${BASE_URL}/dashboard/rooms/new`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#titulo-input', { state: 'visible', timeout: 10000 });
      await page.waitForTimeout(400);
      await preparePageForFullScreenshot(page);
      const file2 = path.join(outDir, `sala-nueva-vacia-${vp.name}.png`);
      await page.screenshot({ path: file2, fullPage: true });
      console.log(`Saved: sala-nueva-vacia-${vp.name}.png`);

      // 3. Formulario con error de validación
      console.log('Submitting empty form to trigger validation error...');
      await page.click('button[type="submit"]');
      await page.waitForSelector('#error-banner', { state: 'visible', timeout: 10000 });
      await page.waitForTimeout(400);
      await preparePageForFullScreenshot(page);
      const file3 = path.join(outDir, `sala-nueva-error-${vp.name}.png`);
      await page.screenshot({ path: file3, fullPage: true });
      console.log(`Saved: sala-nueva-error-${vp.name}.png`);

      await context.close();
    }

    console.log('\nAll host Part A screenshots captured successfully!');
  } catch (err) {
    console.error('Capture error:', err);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

run();
