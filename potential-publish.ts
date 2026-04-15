import { chromium, Page } from 'playwright';

const CDP_URL     = 'http://localhost:9222';
const MY_PROFILE  = 'https://medium.com/@juacompe';
const PUBLICATION = 'https://medium.com/odds-team';

function extractStoryId(url: string): string | null {
  // Medium story URLs end with a hex hash, e.g. "story-slug-a1b2c3d4e5f6"
  const m = url.match(/-([a-f0-9]{8,})(?:[/?#]|$)/);
  return m ? m[1] : null;
}

async function scrapeStories(page: Page, url: string): Promise<{ title: string; url: string }[]> {
  await page.goto(url, { waitUntil: 'networkidle' });
  return page.evaluate(() => {
    const storyIdPattern = /-([a-f0-9]{8,})(?:[/?#]|$)/;
    const seenIds = new Set<string>();
    const results: { title: string; url: string }[] = [];

    document.querySelectorAll('a[href]').forEach(a => {
      const href = (a as HTMLAnchorElement).href;
      const m = href.match(storyIdPattern);
      if (!m) return;
      const id = m[1];
      if (seenIds.has(id)) return;
      seenIds.add(id);

      // Prefer a link that directly wraps a heading (common Medium pattern)
      const headingInLink = a.querySelector('h2, h3');
      if (headingInLink?.textContent?.trim()) {
        results.push({ title: headingInLink.textContent.trim(), url: href });
        return;
      }

      // Fall back: look for a heading in the nearest article/card ancestor
      const card = a.closest('article') ?? a.closest('[data-testid]');
      const heading = card?.querySelector('h2, h3');
      if (heading?.textContent?.trim()) {
        results.push({ title: heading.textContent.trim(), url: href });
      }
    });

    return results;
  });
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  const page = await context.newPage();

  console.log('Fetching your stories…');
  const myStories = await scrapeStories(page, MY_PROFILE);

  console.log('Fetching odds-team publication stories…');
  const pubStories = await scrapeStories(page, PUBLICATION);

  await page.close();
  await browser.close();

  const pubIds = new Set(pubStories.map(s => extractStoryId(s.url)).filter(Boolean));
  const candidates = myStories.filter(s => !pubIds.has(extractStoryId(s.url)));

  if (candidates.length === 0) {
    console.log('\n✅ All your recent stories are already in odds-team publication.');
    return;
  }

  console.log('\n📋 Stories not yet in odds-team publication:\n');
  candidates.slice(0, 5).forEach((s, i) =>
    console.log(`${i + 1}. ${s.title}\n   ${s.url}\n`),
  );
}

main().catch(console.error);
