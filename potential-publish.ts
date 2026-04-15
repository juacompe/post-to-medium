import { chromium, Page } from 'playwright';

const CDP_URL     = 'http://localhost:9222';
const STORIES_URL = 'https://medium.com/me/stories/public';

interface Story {
  title: string;
  url: string;
  publication: string | null;
}

async function scrapeMyStories(page: Page): Promise<Story[]> {
  await page.goto(STORIES_URL, { waitUntil: 'networkidle' });
  return page.evaluate(() => {
    const results: { title: string; url: string; publication: string | null }[] = [];
    const seen = new Set<string>();

    // Each story row has a title link and optionally a "Published in <pub>" label
    document.querySelectorAll('a[href]').forEach(a => {
      const href = (a as HTMLAnchorElement).href;
      // Story links contain a hex-like hash at the end
      if (!/-[a-f0-9]{8,}(?:[/?#]|$)/.test(href)) return;
      if (seen.has(href)) return;
      seen.add(href);

      const headingEl = a.querySelector('h2, h3') ?? (
        a.closest('article, [data-testid]')?.querySelector('h2, h3')
      );
      const title = headingEl?.textContent?.trim();
      if (!title) return;

      // Look for a "Published in <name>" label near this story
      const card = a.closest('article') ?? a.closest('[data-testid]') ?? a.parentElement;
      const pubText = card?.textContent ?? '';
      const pubMatch = pubText.match(/Published in ([^\n•]+)/);
      const publication = pubMatch ? pubMatch[1].trim() : null;

      results.push({ title, url: href, publication });
    });

    return results;
  });
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  const page = await context.newPage();

  console.log('Fetching your published stories…');
  const stories = await scrapeMyStories(page);

  await page.close();
  await browser.close();

  const candidates = stories.filter(s => {
    if (!s.publication) return true;                          // no publication → candidate
    return !s.publication.toLowerCase().includes('odds');     // not odds.team → candidate
  });

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
