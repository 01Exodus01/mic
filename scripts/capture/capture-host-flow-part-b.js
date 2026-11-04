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

const rooms = [
  {
    stateName: 'borrador',
    pin: '101010',
    id: 'cmvrm6c5b000114c7epdk79g6',
  },
  {
    stateName: 'votacion-abierta',
    pin: '834192',
    id: 'f7316a3e-8e5c-493d-b3e0-6a011ab62ad4',
  },
  {
    stateName: 'faltan-votos',
    pin: '777777',
    id: 'cmvrlm5060001vv3n7hnsmcmo',
  },
  {
    stateName: 'revision-argumentos',
    pin: '999999',
    id: 'cmvrlm50e0009vv3nnhvh40m9',
  },
  {
    stateName: 'finalizada',
    pin: '303030',
    id: 'cmvrm6c5v000e14c771yw85ov',
  },
];

async function loginAsHost(page) {
  console.log('Logging in as host...');
  await page.goto(`${BASE_URL}/auth/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', 'docente@universidad.edu');
  await page.fill('input[type="password"]', 'DocentePass123!');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard', { timeout: 15000 });
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

      await loginAsHost(page);

      for (const r of rooms) {
        console.log(`\nNavigating to room ${r.pin} (${r.stateName}) -> ID ${r.id}...`);
        await page.goto(`${BASE_URL}/dashboard/rooms/${r.id}`, { waitUntil: 'networkidle' });
        
        // Wait for page title or room data to load
        await page.waitForSelector('h1', { state: 'visible', timeout: 10000 });
        await page.waitForTimeout(500);

        // If it's revision-argumentos or finalizada, let's open the "Detalle técnico" <details> so it's visible in one of them or verify it renders properly
        if (r.stateName === 'revision-argumentos') {
          await page.evaluate(() => {
            const details = document.querySelector('details');
            if (details) details.open = true;
          });
          await page.waitForTimeout(200);
        }

        await preparePageForFullScreenshot(page);

        const filename = `sala-detalle-${r.stateName}-${vp.name}.png`;
        const filepath = path.join(outDir, filename);
        await page.screenshot({ path: filepath, fullPage: true });
        console.log(`Saved: ${filename}`);
      }

      await context.close();
    }

    console.log('\nAll Host Part B screenshots captured successfully!');
  } catch (err) {
    console.error('Capture error:', err);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

run();
