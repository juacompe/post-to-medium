import { chromium, Page } from 'playwright';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { extname } from 'path';
import { join } from 'path';

const CDP_URL = 'http://localhost:9222';

interface GhostPost {
  title: string;
  html: string;
  featureImage: string | null;
  tags: string[];
}

async function scrapeGhostPost(page: Page, url: string): Promise<GhostPost> {
  await page.goto(url, { waitUntil: 'networkidle' });
  return page.evaluate(() => ({
    title:
      document.querySelector('meta[property="og:title"]')?.getAttribute('content') ??
      document.querySelector('h1')?.textContent ??
      '',
    featureImage:
      document.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? null,
    tags: Array.from(document.querySelectorAll('meta[property="article:tag"]'))
      .map(el => el.getAttribute('content') ?? '')
      .filter(Boolean),
    html:
      (document.querySelector('.gh-content') ?? document.querySelector('article'))?.innerHTML ?? '',
  }));
}

async function downloadImage(url: string): Promise<string> {
  const response = await fetch(url);
  const buffer = Buffer.from(await response.arrayBuffer());
  const ext = extname(new URL(url).pathname) || '.jpg';
  const dest = join(tmpdir(), `medium-feature${ext}`);
  await writeFile(dest, buffer);
  return dest;
}

async function insertTitle(page: Page, title: string) {
  await page.waitForSelector('h3.graf--title', { timeout: 15000 });
  await page.evaluate(text => {
    const el = document.querySelector<HTMLElement>('h3.graf--title');
    if (!el) return;
    el.focus();
    document.execCommand('selectAll');
    document.execCommand('insertText', false, text);
  }, title);
  // Press Enter to move cursor from title into the body before pasting content
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  console.log(`✓ Title: "${title}"`);
}

async function pasteContent(page: Page, html: string) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(async html => {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob(
          [new DOMParser().parseFromString(html, 'text/html').body.textContent ?? ''],
          { type: 'text/plain' },
        ),
      }),
    ]);
  }, html);
  // Cursor is already in the body after Enter — paste directly without clicking
  await page.keyboard.press('Meta+V');
  console.log('✓ Content pasted, waiting for autosave...');
  await page.waitForTimeout(5000);
}

async function uploadFeatureImage(page: Page, imageUrl: string) {
  const imagePath = await downloadImage(imageUrl);
  try {
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b =>
        b.innerHTML.includes('moreFilled'),
      );
      btn?.click();
    });
    await page.waitForTimeout(300);

    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(
        b => b.textContent?.trim() === 'Change featured image',
      );
      btn?.click();
    });
    await page.waitForTimeout(300);

    const fileInput = await page.waitForSelector('input[type="file"]', { timeout: 5000 });
    await fileInput.setInputFiles(imagePath);
    await page.waitForTimeout(3000);
    console.log('✓ Feature image uploaded');
  } finally {
    await unlink(imagePath);
  }
}

async function addTags(page: Page, tags: string[]) {
  if (tags.length === 0) return;
  await page.getByRole('button', { name: 'Publish' }).first().click();
  await page.waitForTimeout(500);
  const tagsInput = page.locator('input[placeholder*="tag" i], input[placeholder*="topic" i]').first();
  for (const tag of tags.slice(0, 5)) {
    await tagsInput.fill(tag);
    await page.keyboard.press('Enter');
  }
  await page.keyboard.press('Escape');
  console.log(`✓ Tags added: ${tags.slice(0, 5).join(', ')}`);
}

async function main() {
  const ghostUrl = process.argv[2];
  if (!ghostUrl) {
    console.error('Usage: ts-node cross-post.ts <ghost-url>');
    process.exit(1);
  }

  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];

  const ghostPage = await context.newPage();
  console.log(`Fetching: ${ghostUrl}`);
  const post = await scrapeGhostPost(ghostPage, ghostUrl);
  await ghostPage.close();

  console.log(`Title:  ${post.title}`);
  console.log(`Tags:   ${post.tags.join(', ') || '(none)'}`);
  console.log(`Image:  ${post.featureImage ?? '(none)'}`);

  const page = await context.newPage();
  await page.goto('https://medium.com/new-story');

  await insertTitle(page, post.title);
  await pasteContent(page, post.html);

  if (post.featureImage) {
    await uploadFeatureImage(page, post.featureImage);
  }

  await addTags(page, post.tags);

  console.log(`\nDraft URL: ${page.url()}`);
  await browser.close();
}

main().catch(console.error);
