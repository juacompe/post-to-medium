import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const AUTH_STATE_PATH = path.join(__dirname, 'auth-state.json');

async function main() {
  const title = process.argv[2];
  if (!title) {
    console.error('Usage: ts-node post-title.ts "<title>"');
    process.exit(1);
  }

  if (!fs.existsSync(AUTH_STATE_PATH)) {
    console.error('No auth state found. Run "npm run auth" first.');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ storageState: AUTH_STATE_PATH });
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

  await browser.close();
}

main().catch(console.error);
