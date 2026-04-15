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

      const heading = a.querySelector('h2, h3');
      const title = heading?.textContent?.trim();
      if (!title) return;

      seenIds.add(id);
      results.push({ title, url: a.href, inOddsTeam: a.href.includes('/odds-team/') });
    });

    return results;
  });
}

async function clickMoreButton(page: Page, storyTitle: string) {
  // Find the ··· button by walking up from the story heading to its row.
  // The row contains multiple buttons; the ··· button is the last one.
  await page.evaluate((title) => {
    const heading = Array.from(document.querySelectorAll('h2, h3'))
      .find(h => h.textContent?.trim().includes(title));
    if (!heading) throw new Error(`Heading not found for: ${title}`);

    let container: Element | null = heading.parentElement;
    for (let depth = 0; depth < 12 && container && container !== document.body; depth++) {
      const buttons = Array.from(container.querySelectorAll('button'));
      if (buttons.length >= 2) {
        // The ··· button is the rightmost (last) button in the row
        (buttons[buttons.length - 1] as HTMLElement).click();
        return;
      }
      container = container.parentElement;
    }
    throw new Error('Could not find ··· button for story');
  }, storyTitle);

  await page.waitForTimeout(500);
}

async function submitToOddsTeam(page: Page, story: Story) {
  console.log(`Submitting: "${story.title}"…`);

  await clickMoreButton(page, story.title);

  // Click "Submit to publication" from the dropdown (Medium uses plain elements, not role=menuitem)
  const addToPub = page.getByText('Submit to publication').first();
  await addToPub.waitFor({ timeout: 5000 });
  await addToPub.click();
  await page.waitForTimeout(1000);

  // Select odds.team from the publication picker
  const oddsPub = page.getByText(/odds\.?team/i).first();
  await oddsPub.waitFor({ timeout: 5000 });
  await oddsPub.click();
  await page.waitForTimeout(500);

  // Confirm / submit if a button appears
  const submitBtn = page.getByRole('button').filter({ hasText: /submit|confirm|add/i }).first();
  await submitBtn.click({ timeout: 5000 }).catch(() => {
    // Button might not appear if selection is immediate
  });

  await page.waitForTimeout(2000);
  console.log(`✓ Submitted "${story.title}" to odds.team`);
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];
  const page = await context.newPage();

  console.log('Fetching stories…');
  const stories = await scrapeMyStories(page);
  const candidate = stories.find(s => !s.inOddsTeam);

  if (!candidate) {
    console.log('✅ Nothing to publish — all stories are already in odds-team.');
    await browser.close();
    return;
  }

  await submitToOddsTeam(page, candidate);

  await page.close();
  await browser.close();
}

main().catch(console.error);
