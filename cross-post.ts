import { chromium, Page } from 'playwright';
import { writeFile, unlink } from 'fs/promises';
import { execSync } from 'child_process';
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

  // Type the full title via keyboard so every character goes through Medium's
  // normal input pipeline and gets saved. execCommand('insertText') after the
  // fact shows in the DOM but bypasses the editor state tracker, so it never saves.
  // The first keystroke triggers draft creation; waitForURL waits for the redirect.
  await page.keyboard.type(title);
  await page.waitForURL(/medium\.com\/p\/.+\/edit/, { timeout: 30000 });
  await page.waitForTimeout(500); // let Medium finish setting up autosave

  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  console.log(`✓ Title: "${title}"`);
}

async function sanitizeHtml(page: Page, rawHtml: string, limit?: number): Promise<string> {
  return page.evaluate(({ raw, limit }: { raw: string; limit?: number }) => {
    const ALLOWED = new Set([
      'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
      'strong', 'em', 'b', 'i', 'u', 's', 'br', 'a',
    ]);
    const doc = new DOMParser().parseFromString(raw, 'text/html');
    function clean(node: Node): Node | null {
      if (node.nodeType === 3) return node.cloneNode();
      if (node.nodeType !== 1) return null;
      const el = node as Element;
      const tag = el.tagName.toLowerCase();
      if (!ALLOWED.has(tag)) {
        const frag = doc.createDocumentFragment();
        el.childNodes.forEach(c => { const n = clean(c); if (n) frag.appendChild(n); });
        return frag;
      }
      const newEl = doc.createElement(tag);
      if (tag === 'a' && el.hasAttribute('href')) newEl.setAttribute('href', el.getAttribute('href')!);
      el.childNodes.forEach(c => { const n = clean(c); if (n) newEl.appendChild(n); });
      return newEl;
    }
    const out = doc.createElement('div');
    doc.body.childNodes.forEach(c => { const n = clean(c); if (n) out.appendChild(n); });
    if (limit) {
      const blocks = out.querySelectorAll('p, h1, h2, h3, h4, h5, h6, ul, ol, blockquote, pre');
      Array.from(blocks).slice(limit).forEach(el => el.remove());
    }
    return out.innerHTML;
  }, { raw: rawHtml, limit });
}

async function copyToClipboard(page: Page, rawHtml: string, limit?: number): Promise<void> {
  const html = await sanitizeHtml(page, rawHtml, limit);
  const tmp = join(tmpdir(), 'medium-content.html');
  await writeFile(tmp, html);
  try {
    execSync(`osascript -e 'set the clipboard to (read POSIX file "${tmp}" as «class HTML»)'`);
  } finally {
    await unlink(tmp);
  }
  console.log('✓ Content copied to clipboard');
}

async function waitForUser(message: string): Promise<void> {
  process.stdout.write(`\n${message}\nPress Enter to continue...`);
  await new Promise<void>(resolve => process.stdin.once('data', resolve));
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
  await page.waitForTimeout(1000); // wait for publish dialog to fully load

  const tagsInput = page.locator('input[placeholder*="topic" i], input[placeholder*="tag" i]').first();
  const added: string[] = [];

  for (const tag of tags.slice(0, 5)) {
    await tagsInput.fill(tag);
    await page.waitForTimeout(1000); // wait for autocomplete dropdown

    // Medium topics are from a predefined list — click the first dropdown suggestion.
    // If nothing matches, clear and skip.
    try {
      await page.getByRole('option').first().click({ timeout: 2000 });
      added.push(tag);
    } catch {
      await tagsInput.clear();
    }
  }

  // Leave the publish dialog open so the user can decide to publish or save as draft.
  console.log(`✓ Tags added: ${added.join(', ') || '(none matched Medium topics)'}`);
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
  await copyToClipboard(page, post.html, limit);
  await waitForUser('👉 Click inside the Medium editor body, then press Cmd+V to paste.');

  if (post.featureImage) {
    await uploadFeatureImage(page, post.featureImage);
  }

  await addTags(page, post.tags);

  console.log(`\nDraft URL: ${page.url()}`);
  await browser.close();
}

main().catch(console.error);
