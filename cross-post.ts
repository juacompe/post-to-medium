import { chromium, Page } from 'playwright';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { extname, join } from 'path';


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
  const titleEl = await page.waitForSelector('h3.graf--title', { timeout: 15000 });
  await titleEl.click();

  // Medium only creates the draft (and sets up autosave) after the first keystroke.
  // Type a placeholder character to trigger draft creation and wait for the redirect
  // to /p/{id}/edit before replacing with the real title.
  await page.keyboard.type('_');
  await page.waitForURL(/medium\.com\/p\/.+\/edit/, { timeout: 30000 });

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

async function extractParagraphs(page: Page, rawHtml: string, limit?: number): Promise<{ tag: string; text: string }[]> {
  return page.evaluate(({ raw, limit }: { raw: string; limit?: number }) => {
    const doc = new DOMParser().parseFromString(raw, 'text/html');
    const blocks = doc.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre');
    const all = limit ? Array.from(blocks).slice(0, limit) : Array.from(blocks);
    return all
      .map(el => ({ tag: el.tagName.toLowerCase(), text: (el.textContent ?? '').trim() }))
      .filter(b => b.text);
  }, { raw: rawHtml, limit });
}

async function typeContent(page: Page, rawHtml: string, limit?: number) {
  const blocks = await extractParagraphs(page, rawHtml, limit);

  // Type each paragraph via keyboard events so Medium's editor state updates
  // and autosave triggers — execCommand('insertHTML') inserts into the DOM but
  // bypasses Medium's internal state tracker, so the draft never saves.
  for (const { tag, text } of blocks) {
    // Use Medium's markdown shortcuts to preserve basic structure
    let prefix = '';
    if (tag === 'h1' || tag === 'h2') prefix = '# ';
    else if (tag === 'h3') prefix = '## ';
    else if (tag === 'h4') prefix = '### ';
    else if (tag === 'blockquote') prefix = '> ';
    else if (tag === 'li') prefix = '- ';

    if (prefix) {
      await page.keyboard.type(prefix);
      await page.waitForTimeout(100); // give Medium time to apply the markdown shortcut
    }
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
  }

  console.log(`✓ ${blocks.length} paragraphs typed, waiting for autosave...`);
  await page.waitForTimeout(3000);
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
    console.error('Usage: ts-node cross-post.ts <ghost-url> [paragraph-limit]');
    process.exit(1);
  }
  const limit = process.argv[3] ? parseInt(process.argv[3]) : undefined;

  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];

  // Close any Medium editor tabs left open from previous runs.
  // Medium shows a "Saving Changes" conflict dialog when multiple editor
  // sessions are open simultaneously, which blocks autosave.
  const stale = context.pages().filter(p => /medium\.com\/(new-story|p\/.+\/edit)/.test(p.url()));
  for (const p of stale) await p.close();
  if (stale.length) console.log(`Closed ${stale.length} stale Medium editor tab(s).`);

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
  await typeContent(page, post.html, limit);

  if (post.featureImage) {
    await uploadFeatureImage(page, post.featureImage);
  }

  await addTags(page, post.tags);

  console.log(`\nDraft URL: ${page.url()}`);
  await browser.close();
}

main().catch(console.error);
