import { chromium } from 'playwright';
import path from 'path';

const AUTH_STATE_PATH = path.join(__dirname, 'auth-state.json');

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://medium.com/m/signin');
  console.log('Please log in to Medium in the browser window...');
  console.log('Press Enter here after you have logged in.');

  await new Promise<void>((resolve) => {
    process.stdin.once('data', () => resolve());
  });

  await context.storageState({ path: AUTH_STATE_PATH });
  console.log(`Auth state saved to ${AUTH_STATE_PATH}`);

  await browser.close();
}

main().catch(console.error);
