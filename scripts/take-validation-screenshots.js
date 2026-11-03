const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

async function main() {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  const outDir = path.join(__dirname, '../screenshots');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
  });

  const page = await context.newPage();

  console.log('1. Capturing campo con error en vivo...');
  await page.goto(`${baseUrl}/auth/register`, { waitUntil: 'networkidle' });

  // Type invalid short name 'Jo' and blur
  await page.fill('#register-name', 'Jo');
  await page.dispatchEvent('#register-name', 'blur');
  await page.waitForTimeout(300);

  // Type invalid short password '123' and blur
  await page.fill('#register-password', '123');
  await page.dispatchEvent('#register-password', 'blur');
  await page.waitForTimeout(300);

  await page.screenshot({
    path: path.join(outDir, 'campo-con-error-en-vivo-375px.png'),
    fullPage: false,
  });
  console.log('Saved campo-con-error-en-vivo-375px.png');

  console.log('2. Capturing campo corregido...');
  // Correct the password to valid 8+ chars live
  await page.fill('#register-password', 'MiClaveSegura2026');
  await page.waitForTimeout(300);

  await page.screenshot({
    path: path.join(outDir, 'campo-corregido-375px.png'),
    fullPage: false,
  });
  console.log('Saved campo-corregido-375px.png');

  console.log('3. Capturing contador al límite...');
  // Fill name with exactly 30 characters
  const exact30 = 'Carlos Alberto Martínez Román.'; // 30 chars
  await page.fill('#register-name', exact30.substring(0, 30));
  await page.waitForTimeout(300);

  await page.screenshot({
    path: path.join(outDir, 'contador-al-limite-375px.png'),
    fullPage: false,
  });
  console.log('Saved contador-al-limite-375px.png');

  console.log('4. Capturing botón deshabilitado con su motivo...');
  // Navigate to /join (participant join) where button has explicit reason
  await page.goto(`${baseUrl}/join`, { waitUntil: 'networkidle' });
  await page.fill('#room-pin-input', '83');
  await page.dispatchEvent('#room-pin-input', 'blur');
  await page.waitForTimeout(300);

  await page.screenshot({
    path: path.join(outDir, 'boton-deshabilitado-con-motivo-375px.png'),
    fullPage: false,
  });
  console.log('Saved boton-deshabilitado-con-motivo-375px.png');

  await browser.close();
  console.log('All screenshots captured successfully.');
}

main().catch((err) => {
  console.error('Error taking screenshots:', err);
  process.exit(1);
});
