const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const url = process.argv[2] || 'http://localhost:3101/';
  const outFile = process.argv[3] || '/tmp/screenshot.png';
  
  await page.goto(url);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  
  const etSection = page.locator('#et-all-grid');
  await etSection.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  
  const box = await etSection.boundingBox();
  
  await page.screenshot({
    path: outFile,
    clip: {
      x: Math.max(0, (box.x || 0) - 20),
      y: Math.max(0, (box.y || 0) - 60),
      width: Math.min(1260, (box.width || 800) + 40),
      height: (box.height || 200) + 220
    }
  });
  console.log('Screenshot saved to', outFile);
  await browser.close();
})();
