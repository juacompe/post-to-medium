import { chromium } from 'playwright';

const CDP_URL = 'http://localhost:9222';

async function main() {
  const title = process.argv[2];
  if (!title) {
    console.error('Usage: ts-node post-title.ts "<title>"');
    process.exit(1);
  }

  // Connect to existing Chrome (must be launched with --remote-debugging-port=9222)
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  const page = await context.newPage();

  console.log('Opening Medium new story...');
  await page.goto('https://medium.com/new-story');

  const titleSelector = 'h3.graf--title';
  await page.waitForSelector(titleSelector, { timeout: 15000 });

  await page.click(titleSelector);
  await page.keyboard.press('Control+A');
  await page.keyboard.type(title);

  console.log(`Title inserted: "${title}"`);
  console.log('Waiting for autosave...');
  await page.waitForTimeout(3000);

  const url = page.url();
  console.log(`Draft URL: ${url}`);

  // Disconnect only — do not close the user's Chrome
  await browser.close();
}

main().catch(console.error);
