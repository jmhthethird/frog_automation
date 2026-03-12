const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  
  await page.goto('http://localhost:3099/');
  await page.waitForLoadState('networkidle');
  
  // Get the button bounding box
  const btn = page.locator('#profile-list-area button').first();
  const box = await btn.boundingBox();
  console.log('Button bounding box:', box);
  
  if (box) {
    const cx = box.x + box.width/2;
    const cy = box.y + box.height/2;
    console.log('Clicking at:', cx, cy);
    
    // Get all elements at the coordinates
    const allElements = await page.evaluate(({x, y}) => {
      return document.elementsFromPoint(x, y).map(e => ({
        tagName: e.tagName,
        id: e.id || '',
        className: (e.className || '').substring(0, 80),
        text: (e.textContent || '').trim().substring(0, 50),
        rect: { 
          top: e.getBoundingClientRect().top,
          left: e.getBoundingClientRect().left,
          width: e.getBoundingClientRect().width,
          height: e.getBoundingClientRect().height
        }
      }));
    }, { x: cx, y: cy });
    
    console.log('\nElements at button coords (top to bottom stack):');
    for (const el of allElements) {
      console.log(`  ${el.tagName}#${el.id}.${el.className} [${Math.round(el.rect.left)},${Math.round(el.rect.top)} ${Math.round(el.rect.width)}x${Math.round(el.rect.height)}] "${el.text}"`);
    }
  }
  
  await browser.close();
}

main().catch(console.error);
