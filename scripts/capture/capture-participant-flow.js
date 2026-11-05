const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE_URL = process.env.BASE_URL || 'http://gdss_app:3000';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || '/ms-playwright/chromium-1140/chrome-linux/chrome';

const outDir = path.join(__dirname, '../../screenshots');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

async function run() {
  console.log(`Launching Playwright to connect to ${BASE_URL}...`);
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const viewports = [
    { name: '375px', width: 375, height: 750 },
    { name: '1280px', width: 1280, height: 900 },
  ];

  for (const vp of viewports) {
    console.log(`\n========================================`);
    console.log(`Capturing viewport: ${vp.name} (${vp.width}x${vp.height})`);
    console.log(`========================================`);

    // ----------------------------------------------------
    // 1. Votación vacía, 2. Incompleta, 3. Lista para enviar
    // ----------------------------------------------------
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();

    console.log('Logging in to room 834192 as Ana...');
    await page.goto(`${BASE_URL}/sala/834192`, { waitUntil: 'networkidle' });
    await page.fill('#nickname-input', 'Ana');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(500);

    await page.fill('#pin4-input', '1234');
    await page.click('button[type="submit"]');
    
    // Log any console error or page state
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
    page.on('requestfailed', req => console.log('REQ FAILED:', req.url(), req.failure()?.errorText));
    page.on('response', res => {
      if (res.status() >= 400) console.log('RES ERROR:', res.url(), res.status());
    });

    console.log('Waiting for URL /student/vote...');
    await page.waitForURL('**/student/vote', { timeout: 15000 });
    console.log('Reached URL:', page.url());

    // Allow Next.js client router to transition and load
    await page.waitForTimeout(2000);
    const bodyText = await page.evaluate(() => document.body.innerText);
    console.log('BODY TEXT PRE-WAIT:', bodyText);

    // Wait until textareas are rendered (skeleton loader gone)
    console.log('Waiting for textarea...');
    try {
      await page.waitForSelector('textarea', { state: 'visible', timeout: 15000 });
    } catch (e) {
      console.log('Timeout waiting for textarea! Current body text:');
      const bodyTextErr = await page.evaluate(() => document.body.innerText);
      console.log(bodyTextErr);
      await page.screenshot({ path: path.join(outDir, `debug-error-${vp.name}.png`) });
      throw e;
    }
    await page.waitForTimeout(500);

    // 1. Votación vacía
    const file1 = path.join(outDir, `1-votacion-vacia-${vp.name}.png`);
    await page.screenshot({ path: file1, fullPage: true });
    console.log(`Saved: 1-votacion-vacia-${vp.name}.png`);

    // 2. Votación con una razón incompleta (24 caracteres < 25)
    const textareas = await page.$$('textarea');
    if (textareas.length > 0) {
      await textareas[0].fill('Me parece una buena opci'); // exactly 24 chars
      await page.waitForTimeout(400);
      const file2 = path.join(outDir, `2-votacion-incompleta-${vp.name}.png`);
      await page.screenshot({ path: file2, fullPage: true });
      console.log(`Saved: 2-votacion-incompleta-${vp.name}.png`);
    }

    // 3. Votación lista para enviar (todas las razones >= 25 caracteres)
    const reasons = [
      'Tiene un impacto fundamental y directo en el desarrollo de capacidades.',
      'Permite una adecuada articulación entre todos los participantes del grupo.',
      'Requiere mayor presupuesto y planificación detallada previa a su inicio.',
      'Es una alternativa secundaria que puede postergarse para una etapa futura.',
    ];
    for (let i = 0; i < textareas.length; i++) {
      await textareas[i].fill(reasons[i] || 'Razón con más de veinticinco caracteres para prueba de interfaz.');
    }
    // Wait for submit button to be enabled
    await page.waitForSelector('button:has-text("Enviar mi selección")', { state: 'visible', timeout: 5000 });
    await page.waitForTimeout(400);

    const file3 = path.join(outDir, `3-votacion-lista-${vp.name}.png`);
    await page.screenshot({ path: file3, fullPage: true });
    console.log(`Saved: 3-votacion-lista-${vp.name}.png`);

    await context.close();

    // ----------------------------------------------------
    // 4. Votación cerrada (Sala 777777 con deadline vencido)
    // ----------------------------------------------------
    const contextClosed = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
    });
    const pageClosed = await contextClosed.newPage();

    console.log('Logging in to room 777777 as Elena...');
    await pageClosed.goto(`${BASE_URL}/sala/777777`, { waitUntil: 'networkidle' });
    await pageClosed.fill('#nickname-input', 'Elena');
    await pageClosed.click('button[type="submit"]');
    await pageClosed.waitForTimeout(400);

    await pageClosed.fill('#pin4-input', '1234');
    await pageClosed.click('button[type="submit"]');
    await pageClosed.waitForURL('**/student/vote', { timeout: 10000 });
    await pageClosed.waitForSelector('text=Votación cerrada', { state: 'visible', timeout: 10000 });
    await pageClosed.waitForTimeout(500);

    const file4 = path.join(outDir, `4-votacion-cerrada-${vp.name}.png`);
    await pageClosed.screenshot({ path: file4, fullPage: true });
    console.log(`Saved: 4-votacion-cerrada-${vp.name}.png`);

    await contextClosed.close();

    // ----------------------------------------------------
    // 5. Revisión de argumentos (Sala 999999 en ROUND_FEEDBACK)
    // ----------------------------------------------------
    const contextFeedback = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
    });
    const pageFeedback = await contextFeedback.newPage();

    console.log('Logging in to room 999999 as Mateo...');
    await pageFeedback.goto(`${BASE_URL}/sala/999999`, { waitUntil: 'networkidle' });
    await pageFeedback.fill('#nickname-input', 'Mateo');
    await pageFeedback.click('button[type="submit"]');
    await pageFeedback.waitForTimeout(400);

    await pageFeedback.fill('#pin4-input', '1234');
    await pageFeedback.click('button[type="submit"]');
    await pageFeedback.waitForURL('**/student/feedback', { timeout: 10000 });
    await pageFeedback.waitForSelector('table', { state: 'visible', timeout: 10000 });
    await pageFeedback.waitForTimeout(500);

    const file5 = path.join(outDir, `5-revision-argumentos-${vp.name}.png`);
    await pageFeedback.screenshot({ path: file5, fullPage: true });
    console.log(`Saved: 5-revision-argumentos-${vp.name}.png`);

    await contextFeedback.close();
  }

  await browser.close();
  console.log('\nAll screenshots captured successfully!');
}

run().catch((err) => {
  console.error('Capture error:', err);
  process.exit(1);
});
