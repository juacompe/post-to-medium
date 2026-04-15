import { chromium, Page } from 'playwright';

const CDP_URL     = 'http://localhost:9222';
const STORIES_URL = 'https://medium.com/me/stories?tab=posts-published';

interface Story {
  title: string;
  url: string;
  inOddsTeam: boolean;
}

async function scrapeMyStories(page: Page): Promise<Story[]> {
  await page.goto(STORIES_URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('h2, h3', { timeout: 15000 }).catch(() => {});

  return page.evaluate(() => {
    const storyPattern = /-([a-f0-9]{8,})(?:[/?#]|$)/;
    const seenIds = new Set<string>();
    const results: { title: string; url: string; inOddsTeam: boolean }[] = [];

    document.querySelectorAll('a[href]').forEach(el => {
      const a = el as HTMLAnchorElement;
      const m = a.href.match(storyPattern);
      if (!m) return;
      const id = m[1];
      if (seenIds.has(id)) return;

      // Only the title link wraps a heading — skip thumbnail/logo links.
      // Don't mark seenId yet so we pick up the title link on the next pass.
      const heading = a.querySelector('h2, h3');
      const title = heading?.textContent?.trim();
      if (!title) return;

      seenIds.add(id); // mark only when title is found

      // Stories in odds-team use medium.com/odds-team/… as canonical URL;
      // personal stories (not submitted) use medium.com/@juacompe/…
      const inOddsTeam = a.href.includes('/odds-team/');

      results.push({ title, url: a.href, inOddsTeam });
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

  const candidates = stories.filter(s => !s.inOddsTeam);

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
