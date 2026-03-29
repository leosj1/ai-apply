// Headless browser module using Playwright for JS-rendered job boards
// Uses dynamic require() to avoid webpack bundling issues in Next.js
// Falls back to enhanced fetch if Playwright is not available

/* eslint-disable @typescript-eslint/no-explicit-any */

let browser: any = null;
let playwrightAvailable: boolean | null = null;

const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
];

function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// Load playwright-core at runtime
// webpack externals config in next.config.mjs ensures this is NOT bundled
function getPlaywright(): any | null {
  if (playwrightAvailable === false) return null;
  try {
    // This require() is emitted as-is by webpack (not bundled) due to externals config
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pw = require("playwright-core");
    if (!pw || !pw.chromium) {
      playwrightAvailable = false;
      console.warn("[browser] playwright-core loaded but chromium not available");
      return null;
    }
    if (!playwrightAvailable) {
      console.log("[browser] playwright-core loaded successfully");
    }
    playwrightAvailable = true;
    return pw;
  } catch (err) {
    playwrightAvailable = false;
    console.warn("[browser] playwright-core not available:", (err as Error).message);
    return null;
  }
}

async function getBrowser(): Promise<any> {
  if (browser?.isConnected?.()) return browser;

  const pw = getPlaywright();
  if (!pw) throw new Error("Playwright not available");

  browser = await pw.chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-blink-features=AutomationControlled",
    ],
  });
  return browser;
}

export interface BrowserScrapeResult {
  html: string;
  url: string;
  status: number;
}

// Enhanced fetch fallback when Playwright is not available
async function fetchFallback(
  url: string,
  timeoutMs: number,
): Promise<BrowserScrapeResult | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": randomUA(),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
      },
    });
    clearTimeout(timer);
    if (res.status >= 400) return null;
    const html = await res.text();
    return { html, url: res.url || url, status: res.status };
  } catch {
    return null;
  }
}

// Scrape a page — tries Playwright first, falls back to enhanced fetch
export async function scrapePage(
  url: string,
  options: {
    waitSelector?: string;
    waitMs?: number;
    timeoutMs?: number;
    scrollToBottom?: boolean;
  } = {}
): Promise<BrowserScrapeResult | null> {
  const { waitSelector, waitMs = 2000, timeoutMs = 30000, scrollToBottom = false } = options;

  // Try Playwright first
  const pw = getPlaywright();
  if (pw) {
    let context: any = null;
    let page: any = null;
    try {
      const b = await getBrowser();
      context = await b.newContext({
        userAgent: randomUA(),
        viewport: { width: 1366, height: 768 },
        locale: "en-US",
        timezoneId: "America/New_York",
        javaScriptEnabled: true,
        ignoreHTTPSErrors: true,
        extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
      });
      page = await context.newPage();

      // Block heavy resources
      await page.route("**/*", (route: any) => {
        const type = route.request().resourceType();
        if (["image", "media", "font", "stylesheet"].includes(type)) {
          route.abort();
        } else {
          route.continue();
        }
      });

      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: timeoutMs,
      });
      if (!response) return null;
      const status = response.status();
      if (status >= 400) return null;

      if (waitSelector) {
        await page.waitForSelector(waitSelector, { timeout: 10000 }).catch(() => {});
      }
      if (waitMs > 0) await page.waitForTimeout(waitMs);

      if (scrollToBottom) {
        await page.evaluate(async () => {
          await new Promise<void>((resolve) => {
            let totalHeight = 0;
            const distance = 400;
            const timer = setInterval(() => {
              window.scrollBy(0, distance);
              totalHeight += distance;
              if (totalHeight >= document.body.scrollHeight || totalHeight > 10000) {
                clearInterval(timer);
                resolve();
              }
            }, 200);
          });
        });
        await page.waitForTimeout(1000);
      }

      const html = await page.content();
      return { html, url: page.url(), status };
    } catch (err) {
      console.error(`[browser] Playwright error for ${url}:`, (err as Error).message);
    } finally {
      if (page) await page.close().catch(() => {});
      if (context) await context.close().catch(() => {});
    }
  }

  // Fallback to enhanced fetch
  return fetchFallback(url, timeoutMs);
}

export function isPlaywrightAvailable(): boolean {
  if (playwrightAvailable === null) getPlaywright();
  return playwrightAvailable === true;
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
}
