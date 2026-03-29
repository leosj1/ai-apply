// Rotating proxy manager for web scraping
// Supports: free proxy lists, or paid proxy services (BrightData, SmartProxy, etc.)

export interface ProxyConfig {
  url: string;       // http://user:pass@host:port or http://host:port
  protocol: "http" | "https" | "socks5";
  lastUsed?: number;
  failCount?: number;
}

// Rate limiter per domain to respect source limits
const domainLastRequest: Map<string, number> = new Map();
const DOMAIN_RATE_LIMITS: Record<string, number> = {
  "linkedin.com": 5000,       // 5s between requests
  "indeed.com": 3000,         // 3s
  "glassdoor.com": 5000,      // 5s
  "ziprecruiter.com": 3000,   // 3s
  "boards.greenhouse.io": 1500, // 1.5s
  "jobs.lever.co": 1500,      // 1.5s
  "default": 2000,            // 2s default
};

// User-Agent rotation pool
const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:123.0) Gecko/20100101 Firefox/123.0",
];

export function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// Parse proxy list from environment variable
// Format: comma-separated URLs like http://user:pass@host:port,http://host2:port2
export function loadProxies(): ProxyConfig[] {
  const proxyStr = process.env.SCRAPER_PROXIES || "";
  if (!proxyStr.trim()) return [];

  return proxyStr.split(",").map((p) => p.trim()).filter(Boolean).map((url) => ({
    url,
    protocol: url.startsWith("socks5") ? "socks5" as const : url.startsWith("https") ? "https" as const : "http" as const,
    lastUsed: 0,
    failCount: 0,
  }));
}

// Get next available proxy (round-robin with failure tracking)
let proxyIndex = 0;
const proxies = loadProxies();

export function getNextProxy(): ProxyConfig | null {
  if (proxies.length === 0) return null;

  // Skip proxies with too many failures
  const maxAttempts = proxies.length;
  for (let i = 0; i < maxAttempts; i++) {
    const proxy = proxies[proxyIndex % proxies.length];
    proxyIndex++;
    if ((proxy.failCount || 0) < 5) {
      proxy.lastUsed = Date.now();
      return proxy;
    }
  }

  // All proxies failed, reset and try again
  proxies.forEach((p) => { p.failCount = 0; });
  return proxies[0] || null;
}

export function markProxyFailed(proxy: ProxyConfig): void {
  proxy.failCount = (proxy.failCount || 0) + 1;
}

// Rate limiting: wait if we've requested this domain too recently
export async function respectRateLimit(domain: string): Promise<void> {
  const key = Object.keys(DOMAIN_RATE_LIMITS).find((d) => domain.includes(d)) || "default";
  const minDelay = DOMAIN_RATE_LIMITS[key];
  const lastReq = domainLastRequest.get(domain) || 0;
  const elapsed = Date.now() - lastReq;

  if (elapsed < minDelay) {
    await new Promise((resolve) => setTimeout(resolve, minDelay - elapsed));
  }
  domainLastRequest.set(domain, Date.now());
}

// Make a fetch request with optional proxy, rate limiting, and UA rotation
export async function fetchWithProxy(
  url: string,
  options: { timeoutMs?: number; retries?: number } = {}
): Promise<{ html: string; status: number } | null> {
  const { timeoutMs = 15000, retries = 2 } = options;
  const domain = new URL(url).hostname;

  await respectRateLimit(domain);

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      // Note: Node.js native fetch doesn't support proxies directly.
      // For proxy support, you'd use undici or node-fetch with an agent.
      // For now, direct fetch with UA rotation. Add proxy agent if SCRAPER_PROXIES is set.
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": getRandomUserAgent(),
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "gzip, deflate",
          "Cache-Control": "no-cache",
          "Pragma": "no-cache",
        },
        redirect: "follow",
      });
      clearTimeout(timer);

      if (res.status === 429) {
        // Rate limited — back off and retry
        console.log(`[proxy] Rate limited on ${domain}, backing off...`);
        await new Promise((resolve) => setTimeout(resolve, 5000 * (attempt + 1)));
        continue;
      }

      if (res.status >= 400) {
        console.log(`[proxy] HTTP ${res.status} for ${url}`);
        return { html: "", status: res.status };
      }

      const html = await res.text();
      return { html, status: res.status };
    } catch (err) {
      if (attempt === retries) {
        console.error(`[proxy] Failed after ${retries + 1} attempts for ${url}:`, (err as Error).message);
        return null;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
    }
  }

  return null;
}
