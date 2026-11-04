/**
 * scripts/capture/capture-screenshots.js
 * Captures Playwright screenshots of key views at 375px and 1280px viewports.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const outputDir = path.join(__dirname, '..', '..', 'docs', 'screenshots');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

async function capture() {
  const browser = await chromium.launch({
    headless: true,
  });

  const screens = [
    { name: '01-inicio', path: '/' },
    { name: '02-join', path: '/join' },
    { name: '03-auth-login', path: '/auth/login' },
    { name: '04-auth-register', path: '/auth/register' },
    { name: '05-auth-error', path: '/auth/error' },
  ];

  try {
    for (const screen of screens) {
      const url = `${BASE_URL}${screen.path}`;

      // 1. Mobile 375px
      const contextMobile = await browser.newContext({
        viewport: { width: 375, height: 667 },
        deviceScaleFactor: 2,
      });
      const pageMobile = await contextMobile.newPage();
      try {
        await pageMobile.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
        const mobilePath = path.join(outputDir, `${screen.name}-375px.png`);
        await pageMobile.screenshot({ path: mobilePath, fullPage: true });
        console.log(`Saved: ${screen.name}-375px.png`);
      } catch (err) {
        console.error(`Error capturing ${screen.name} 375px:`, err.message);
      } finally {
        await contextMobile.close();
      }

      // 2. Desktop 1280px
      const contextDesktop = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
      });
      const pageDesktop = await contextDesktop.newPage();
      try {
        await pageDesktop.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
        const desktopPath = path.join(outputDir, `${screen.name}-1280px.png`);
        await pageDesktop.screenshot({ path: desktopPath, fullPage: true });
        console.log(`Saved: ${screen.name}-1280px.png`);
      } catch (err) {
        console.error(`Error capturing ${screen.name} 1280px:`, err.message);
      } finally {
        await contextDesktop.close();
      }
    }
  } finally {
    await browser.close();
  }
}

capture().catch((err) => {
  console.error('Capture failed:', err);
  process.exit(1);
});
