const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE_URL = process.env.BASE_URL || 'http://gdss_app:3000';

async function run() {
  console.log(`Connecting to ${BASE_URL}...`);
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || '/ms-playwright/chromium-1140/chrome-linux/chrome';
  console.log(`Using executable: ${executablePath}`);
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const outDir = path.join(__dirname, '../../public/screenshots');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  // 1. Mobile 375px: /join Step 1
  const mobileContext = await browser.newContext({
    viewport: { width: 375, height: 667 },
    deviceScaleFactor: 2,
  });
  const mobilePage = await mobileContext.newPage();
  await mobilePage.goto(`${BASE_URL}/join`, { waitUntil: 'networkidle' });
  await mobilePage.screenshot({ path: path.join(outDir, 'join-375px-step1.png'), fullPage: true });
  console.log('Saved join-375px-step1.png');

  // Fill Step 1 PIN -> Step 2
  await mobilePage.fill('#room-pin-input', '834192');
  await mobilePage.click('button[type="submit"]');
  await mobilePage.waitForTimeout(500);
  await mobilePage.screenshot({ path: path.join(outDir, 'join-375px-step2.png'), fullPage: true });
  console.log('Saved join-375px-step2.png');

  // Fill Step 2 Nickname -> Step 3
  await mobilePage.fill('#nickname-input', 'Carlos');
  await mobilePage.click('button[type="submit"]');
  await mobilePage.waitForTimeout(500);
  await mobilePage.screenshot({ path: path.join(outDir, 'join-375px-step3.png'), fullPage: true });
  console.log('Saved join-375px-step3.png');

  await mobileContext.close();

  // 2. Desktop 1280px: /join Step 1
  const desktopContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
  });
  const desktopPage = await desktopContext.newPage();
  await desktopPage.goto(`${BASE_URL}/join`, { waitUntil: 'networkidle' });
  await desktopPage.screenshot({ path: path.join(outDir, 'join-1280px-step1.png'), fullPage: true });
  console.log('Saved join-1280px-step1.png');

  // Fill Step 1 PIN -> Step 2 Desktop
  await desktopPage.fill('#room-pin-input', '834192');
  await desktopPage.click('button[type="submit"]');
  await desktopPage.waitForTimeout(500);
  await desktopPage.screenshot({ path: path.join(outDir, 'join-1280px-step2.png'), fullPage: true });
  console.log('Saved join-1280px-step2.png');

  // Fill Step 2 Nickname -> Step 3 Desktop
  await desktopPage.fill('#nickname-input', 'Carlos');
  await desktopPage.click('button[type="submit"]');
  await desktopPage.waitForTimeout(500);
  await desktopPage.screenshot({ path: path.join(outDir, 'join-1280px-step3.png'), fullPage: true });
  console.log('Saved join-1280px-step3.png');

  await desktopContext.close();

  // 3. Direct Route /sala/834192 at 375px
  const directMobileContext = await browser.newContext({
    viewport: { width: 375, height: 667 },
    deviceScaleFactor: 2,
  });
  const directMobilePage = await directMobileContext.newPage();
  await directMobilePage.goto(`${BASE_URL}/sala/834192`, { waitUntil: 'networkidle' });
  await directMobilePage.screenshot({ path: path.join(outDir, 'sala-834192-375px.png'), fullPage: true });
  console.log('Saved sala-834192-375px.png');
  await directMobileContext.close();

  // 4. Direct Route /sala/834192 at 1280px
  const directDesktopContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
  });
  const directDesktopPage = await directDesktopContext.newPage();
  await directDesktopPage.goto(`${BASE_URL}/sala/834192`, { waitUntil: 'networkidle' });
  await directDesktopPage.screenshot({ path: path.join(outDir, 'sala-834192-1280px.png'), fullPage: true });
  console.log('Saved sala-834192-1280px.png');
  await directDesktopContext.close();

  await browser.close();
  console.log('All screenshots captured successfully!');
}

run().catch((err) => {
  console.error('Screenshot error:', err);
  process.exit(1);
});
