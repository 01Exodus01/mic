/**
 * scripts/capture-all-screenshots.js
 * Captures comprehensive screenshots of GDSS r-FAST-CR at 375px and 1280px viewports.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const outputDir = path.join(__dirname, '..', 'docs', 'screenshots');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

async function captureScreen(page, name) {
  // Mobile 375px
  await page.setViewportSize({ width: 375, height: 667 });
  await page.waitForTimeout(500);
  const mobileFile = path.join(outputDir, `${name}-375px.png`);
  await page.screenshot({ path: mobileFile, fullPage: true });
  console.log(`Saved: ${name}-375px.png`);

  // Desktop 1280px
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(500);
  const desktopFile = path.join(outputDir, `${name}-1280px.png`);
  await page.screenshot({ path: desktopFile, fullPage: true });
  console.log(`Saved: ${name}-1280px.png`);
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ deviceScaleFactor: 1.5 });
  const page = await context.newPage();

  try {
    // 1. Inicio
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle', timeout: 15000 });
    await captureScreen(page, '01-inicio');

    // 2. Ingreso participante (/join)
    await page.goto(`${BASE_URL}/join`, { waitUntil: 'networkidle', timeout: 15000 });
    await captureScreen(page, '02-join-paso1');

    // 3. Login
    await page.goto(`${BASE_URL}/auth/login`, { waitUntil: 'networkidle', timeout: 15000 });
    await captureScreen(page, '03-auth-login');

    // 4. Registro
    await page.goto(`${BASE_URL}/auth/register`, { waitUntil: 'networkidle', timeout: 15000 });
    await captureScreen(page, '04-auth-register');

    // 5. Auth Error
    await page.goto(`${BASE_URL}/auth/error`, { waitUntil: 'networkidle', timeout: 15000 });
    await captureScreen(page, '05-auth-error');

    // 6. Registro y Login de anfitrión para ver panel
    const uniqueEmail = `host_${Date.now()}@example.com`;
    const password = 'HostPassword1234!';
    await page.goto(`${BASE_URL}/auth/register`, { waitUntil: 'networkidle', timeout: 15000 });

    const nameInputs = await page.locator('input[type="text"]').all();
    if (nameInputs.length > 0) {
      await nameInputs[0].fill('Anfitrión Demo');
    }
    await page.locator('input[type="email"]').fill(uniqueEmail);
    await page.locator('input[type="password"]').fill(password);
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(2000);

    // Iniciar sesión
    await page.goto(`${BASE_URL}/auth/login`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.locator('input[type="email"]').fill(uniqueEmail);
    await page.locator('input[type="password"]').fill(password);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL('**/dashboard**', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);

    // 7. Panel de control (/dashboard)
    await captureScreen(page, '06-dashboard');

    // 8. Nueva sala (/dashboard/rooms/new)
    await page.goto(`${BASE_URL}/dashboard/rooms/new`, { waitUntil: 'networkidle', timeout: 15000 });
    await captureScreen(page, '07-dashboard-rooms-new');

    // 9. Crear sala y ver detalle
    const textInputs = await page.locator('input[type="text"]').all();
    if (textInputs.length >= 4) {
      // Title
      await textInputs[0].fill('Priorización de Proyectos');
      // Options
      await textInputs[1].fill('Opción Alfa: Infraestructura');
      await textInputs[2].fill('Opción Beta: Plataforma Web');
      await textInputs[3].fill('Opción Gamma: Seguridad');
    }

    const textareas = await page.locator('textarea').all();
    if (textareas.length >= 3) {
      await textareas[0].fill('Descripción detallada de la opción alfa.');
      await textareas[1].fill('Descripción detallada de la opción beta.');
      await textareas[2].fill('Descripción detallada de la opción gamma.');
    }

    const submitBtn = page.locator('button[type="submit"]');
    if (await submitBtn.isEnabled()) {
      await submitBtn.click();
      await page.waitForURL('**/dashboard/rooms/**', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(2000);
      await captureScreen(page, '08-dashboard-room-detail');
    }

  } catch (err) {
    console.error('Error during capture:', err);
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error('Run failed:', err);
  process.exit(1);
});
