import { chromium, Page } from 'playwright';

const CDP_URL     = 'http://localhost:9222';
const STORIES_URL = 'https://medium.com/me/stories/public';

interface Story {
  title: string;
  url: string;
  inOddsTeam: boolean;
}

async function scrapeMyStories(page: Page): Promise<Story[]> {
  await page.goto(STORIES_URL, { waitUntil: 'networkidle' });
  return page.evaluate(() => {
    const storyPattern = /-([a-f0-9]{8,})(?:[/?#]|$)/;
    const results: { title: string; url: string; inOddsTeam: boolean }[] = [];
    const seen = new Set<string>();

    document.querySelectorAll('a[href]').forEach(el => {
      const a = el as HTMLAnchorElement;
      if (!storyPattern.test(a.href)) return;

      const m = a.href.match(storyPattern);
      if (!m || seen.has(m[1])) return;
      seen.add(m[1]);

      // Grab title from heading inside or near the link
      const heading =
        a.querySelector('h2, h3') ??
        a.closest('article, [data-testid]')?.querySelector('h2, h3');
      const title = heading?.textContent?.trim();
      if (!title) return;

      // Walk up the DOM to find the row-level container, then check for an
      // odds-team link in the same row (the Publication column).
      // Stop as soon as we find a container that also has a heading of its own
      // (meaning we've gone too far and reached a multi-story container).
      let container: Element | null = a.parentElement;
      let inOddsTeam = false;
      let levels = 0;
      while (container && container !== document.body && levels < 12) {
        // If we've gone past the story's own heading, we're too far up
        const headings = container.querySelectorAll('h2, h3');
        if (headings.length > 1) break; // multiple stories — stop

        const pubLink = container.querySelector(
          'a[href*="odds-team"], a[href*="odds.team"]',
        );
        if (pubLink) { inOddsTeam = true; break; }

        container = container.parentElement;
        levels++;
      }

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
