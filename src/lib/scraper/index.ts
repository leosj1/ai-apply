// Main job crawler — orchestrates scraping from multiple sources
// and saves results to the ScrapedJob table for caching

import { prisma } from "@/lib/prisma";
import { fetchWithProxy } from "./proxy";
import {
  parseGreenhouseJobList,
  parseGreenhouseJobDetail,
  parseLeverJobList,
  parseLeverJobDetail,
  parseGenericJobPage,
  type ParsedJob,
} from "./parsers";
import {
  scrapeLinkedInJobs,
  scrapeIndeedJobs,
  scrapeGlassdoorJobs,
  scrapeZipRecruiterJobs,
  scrapeWorkdayJobs,
} from "./direct-scrapers";

// ── ATS board lists (comprehensive — crawl ALL of them) ──
const GREENHOUSE_BOARDS = [
  // Tier 1: Major tech
  "airbnb", "stripe", "cloudflare", "hashicorp", "datadog",
  "cockroachlabs", "rippling", "gusto", "instacart", "doordash",
  "mercury", "deel", "lattice", "carta", "netlify",
  "temporal", "circleci", "dopplerhq", "1password", "tempus",
  // Tier 2: Growth-stage
  "depop", "poshmark", "color", "cerebral", "figma",
  "notion", "airtable", "retool", "vercel", "supabase",
  "linear", "loom", "miro", "canva", "webflow",
  // Tier 3: Enterprise & fintech
  "plaid", "brex", "ramp", "chime", "robinhood",
  "coinbase", "kraken", "opensea", "dapper", "alchemy",
  "anchorage", "chainalysis", "fireblocks", "consensys",
  // Tier 4: AI/ML & data
  "openai", "anthropic", "huggingface", "scale", "labelbox",
  "weights-and-biases", "cohere", "adept", "inflection",
  // Tier 5: Infrastructure & devtools
  "grafana", "elastic", "confluent", "cockroachlabs",
  "planetscale", "neon", "timescale", "clickhouse",
  "postman", "snyk", "sonarqube", "launchdarkly",
  // Tier 6: Health & biotech
  "flatiron", "tempus", "ro", "hims", "nurx",
  "cityblock", "devoted", "clover", "oscar",
  // Tier 7: More companies
  "anduril", "palantir", "relativity", "toast",
  "squarespace", "etsy", "pinterest", "snap",
  "discord", "reddit", "tumblr", "medium",
];

// Lever boards — only confirmed working ones (all others 404)
const LEVER_BOARDS = [
  "spotify", "plaid", "attentive", "anyscale",
];

// Track boards that returned 404 to skip them in future crawls
const failedBoards = new Set<string>();

// ── Supported auto-apply platforms ──
// Only scan for jobs on platforms where we have proven, reliable auto-apply automation.
// Greenhouse: hybrid API + browser handler + AI agent
// Lever: direct API submission + browser handler + AI agent
// Ashby: schema-driven handler with AI question answering
// Workable: schema-driven handler with API
// Recruitee: full API submission
const SUPPORTED_PLATFORM_PATTERNS = [
  /boards\.greenhouse\.io|job-boards\.greenhouse\.io|greenhouse\.io/i,
  /[?&]gh_jid=/i, // Greenhouse embedded on company career pages
  /jobs\.lever\.co/i,
  /ashbyhq\.com|jobs\.ashby\.com/i,
  /apply\.workable\.com|jobs\.workable\.com/i,
  /\.recruitee\.com/i,
];

export function isSupportedPlatformUrl(url: string): boolean {
  return SUPPORTED_PLATFORM_PATTERNS.some((pattern) => pattern.test(url));
}

// JSearch quota tracking — skip API calls when quota is exhausted
let jsearchQuotaExhaustedAt = 0; // timestamp when quota was detected as exhausted
const JSEARCH_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour cooldown

export function isJSearchAvailable(): boolean {
  if (!process.env.RAPIDAPI_KEY) return false;
  if (jsearchQuotaExhaustedAt > 0 && Date.now() - jsearchQuotaExhaustedAt < JSEARCH_COOLDOWN_MS) {
    return false;
  }
  return true;
}

export function getJSearchStatus(): { available: boolean; exhaustedAt: number | null; cooldownMinutes: number } {
  const available = isJSearchAvailable();
  const exhaustedAt = jsearchQuotaExhaustedAt > 0 ? jsearchQuotaExhaustedAt : null;
  const remaining = exhaustedAt ? Math.max(0, JSEARCH_COOLDOWN_MS - (Date.now() - exhaustedAt)) : 0;
  return { available, exhaustedAt, cooldownMinutes: Math.ceil(remaining / 60000) };
}

// ── Core crawl function ──
// Hybrid approach:
//   1. JSearch API for major job boards (LinkedIn, Indeed, Glassdoor, ZipRecruiter)
//      — these all block direct scraping (403), so we use the API aggregator
//   2. Direct scraping for ATS boards (Greenhouse, Lever)
//      — these serve static HTML and work without auth
export async function crawlJobs(
  query: string,
  location: string,
  options: {
    maxPerSource?: number;
    includeAts?: boolean;
    includeJSearch?: boolean;
    includeDirectScrape?: boolean;
  } = {}
): Promise<{ saved: number; skipped: number; errors: number }> {
  const {
    maxPerSource = 100,
    includeAts = true,
    includeJSearch = true,
    includeDirectScrape = true,
  } = options;

  let totalSaved = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  // ── JSearch API: aggregates LinkedIn, Indeed, Glassdoor, ZipRecruiter, etc. ──
  const JSEARCH_API_KEY = process.env.RAPIDAPI_KEY;
  const jsearchAvailable = isJSearchAvailable();
  if (includeJSearch && JSEARCH_API_KEY && !jsearchAvailable) {
    console.warn(`[crawl] JSearch API skipped: quota exhausted (cooldown ${getJSearchStatus().cooldownMinutes}min remaining)`);
  }
  if (includeJSearch && JSEARCH_API_KEY && jsearchAvailable) {
    try {
      const isRemote = location.toLowerCase().includes("remote");
      const params = new URLSearchParams({
        query: `${query} in ${location}`,
        page: "1",
        num_pages: "5",
        date_posted: "week",
        remote_jobs_only: isRemote ? "true" : "false",
      });

      console.log(`[crawl] JSearch API: "${query}" in "${location}"...`);
      const jsRes = await fetch(`https://jsearch.p.rapidapi.com/search?${params}`, {
        headers: {
          "X-RapidAPI-Key": JSEARCH_API_KEY,
          "X-RapidAPI-Host": "jsearch.p.rapidapi.com",
        },
        signal: AbortSignal.timeout(15000), // 15s timeout for JSearch
      });

      if (jsRes.ok) {
        const jsData = await jsRes.json();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const jobs: any[] = jsData.data || [];
        console.log(`[crawl] JSearch API: ${jobs.length} results`);

        const parsedJobs: ParsedJob[] = [];
        for (const j of jobs) {
          const url = j.job_apply_link || j.job_google_link;
          if (!url || !j.employer_name || !j.job_title) continue;
          // Only keep jobs from platforms with proven auto-apply automation
          if (!isSupportedPlatformUrl(url)) continue;

          let loc = "Not specified";
          if (j.job_is_remote) {
            loc = j.job_city ? `Remote (${j.job_city}, ${j.job_state || j.job_country || ""})`.trim() : "Remote";
          } else if (j.job_city) {
            loc = [j.job_city, j.job_state, j.job_country].filter(Boolean).join(", ");
          }

          let salary: string | null = null;
          if (j.job_min_salary && j.job_max_salary) {
            const cur = j.job_salary_currency || "USD";
            const per = j.job_salary_period === "YEAR" ? "/yr" : j.job_salary_period === "HOUR" ? "/hr" : "";
            salary = `${cur} $${Math.round(j.job_min_salary).toLocaleString()} - $${Math.round(j.job_max_salary).toLocaleString()}${per}`;
          } else if (j.job_min_salary) {
            salary = `$${Math.round(j.job_min_salary).toLocaleString()}+`;
          }

          // Detect real source: prefer JSearch's publisher field, then URL-based detection
          let source = detectSourceFromUrl(url);
          if (source === "other" && j.job_publisher) {
            const pub = j.job_publisher.toLowerCase();
            if (pub.includes("linkedin")) source = "linkedin";
            else if (pub.includes("indeed")) source = "indeed";
            else if (pub.includes("glassdoor")) source = "glassdoor";
            else if (pub.includes("ziprecruiter")) source = "ziprecruiter";
            else if (pub.includes("dice")) source = "dice";
            else if (pub.includes("monster")) source = "monster";
            else if (pub.includes("simply")) source = "simplyhired";
            else if (pub.includes("built in") || pub.includes("builtin")) source = "builtin";
            else source = j.job_publisher;
          }

          const tags = j.job_required_skills?.slice(0, 5) ||
            j.job_highlights?.Qualifications?.slice(0, 4).map((q: string) => q.split(/[,;]/)[0].trim().substring(0, 30)) || [];

          parsedJobs.push({
            url,
            company: j.employer_name,
            role: j.job_title,
            location: loc,
            salary,
            description: j.job_description?.substring(0, 5000) || null,
            source,
            tags,
            employmentType: j.job_employment_type || null,
            isRemote: j.job_is_remote || false,
            postedAt: j.job_posted_at_datetime_utc ? new Date(j.job_posted_at_datetime_utc) : null,
          });
        }

        const { saved, skipped } = await saveJobs(parsedJobs);
        totalSaved += saved;
        totalSkipped += skipped;
        console.log(`[crawl] JSearch: saved ${saved} (LinkedIn, Indeed, Glassdoor, ZipRecruiter, etc.)`);
      } else if (jsRes.status === 429 || jsRes.status === 403) {
        // Quota exhausted — mark and skip for cooldown period
        jsearchQuotaExhaustedAt = Date.now();
        console.warn(`[crawl] JSearch API quota exhausted (${jsRes.status}). Skipping for 1 hour.`);
        totalErrors++;
      } else {
        console.error(`[crawl] JSearch API error: ${jsRes.status}`);
        totalErrors++;
      }
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("aborted") || msg.includes("timeout")) {
        console.warn(`[crawl] JSearch API timeout — skipping`);
      } else {
        console.error(`[crawl] JSearch API error:`, msg);
      }
      totalErrors++;
    }
  } else if (includeJSearch && !JSEARCH_API_KEY) {
    console.warn(`[crawl] JSearch API skipped: RAPIDAPI_KEY not set`);
  }

  // ── Direct scrape: ATS boards (Greenhouse JSON API + Lever HTML) ──
  // Run in parallel batches for speed
  if (includeAts) {
    const keywords = query.toLowerCase().split(/[\s,]+/).filter((k) => k.length > 2);

    // Helper: fetch one Greenhouse board
    const crawlGreenhouse = async (company: string) => {
      try {
        const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${company}/jobs?content=true`;
        const res = await fetch(apiUrl, {
          headers: { "Accept": "application/json" },
          signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) { if (res.status === 404) failedBoards.add(`gh:${company}`); return; }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data: { jobs: any[] } = await res.json();
        if (!data.jobs || data.jobs.length === 0) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const matching = data.jobs.filter((j: any) => {
          const text = `${j.title} ${j.location?.name || ""}`.toLowerCase();
          return keywords.some((kw) => text.includes(kw));
        });
        if (matching.length === 0) return;
        console.log(`[crawl] greenhouse/${company}: ${matching.length} matching jobs`);
        const companyName = formatCompanyName(company);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parsedJobs: ParsedJob[] = matching.slice(0, maxPerSource).map((j: any) => {
          const loc = j.location?.name || null;
          const desc = j.content ? j.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().substring(0, 5000) : null;
          return {
            url: j.absolute_url || `https://boards.greenhouse.io/${company}/jobs/${j.id}`,
            company: companyName, role: j.title, location: loc, salary: null,
            description: desc, source: "greenhouse",
            tags: j.departments?.map((d: { name: string }) => d.name) || [],
            employmentType: null, isRemote: loc ? loc.toLowerCase().includes("remote") : false,
            postedAt: j.updated_at ? new Date(j.updated_at) : null,
          };
        });
        const { saved, skipped } = await saveJobs(parsedJobs);
        totalSaved += saved; totalSkipped += skipped;
      } catch (err) {
        const msg = (err as Error).message;
        if (!msg.includes("aborted")) totalErrors++;
      }
    };

    // Helper: fetch one Lever board
    const crawlLever = async (company: string) => {
      try {
        const boardUrl = `https://jobs.lever.co/${company}`;
        const result = await fetchWithProxy(boardUrl, { retries: 0 });
        if (!result || !result.html || result.status === 404) { failedBoards.add(`lv:${company}`); return; }
        const jobs = parseLeverJobList(result.html, boardUrl);
        const filtered = filterByQuery(jobs, query);
        if (filtered.length === 0) return;
        console.log(`[crawl] lever/${company}: ${filtered.length} matching jobs`);
        const { saved, skipped } = await saveJobs(filtered);
        totalSaved += saved; totalSkipped += skipped;
      } catch (err) {
        console.error(`[crawl] lever/${company} error:`, (err as Error).message);
        totalErrors++;
      }
    };

    // Run all ATS boards in parallel (batches of 5 for Greenhouse + all Lever)
    const ghAvailable = GREENHOUSE_BOARDS.filter((c) => !failedBoards.has(`gh:${c}`));
    const ghBoards = shuffleArray(ghAvailable).slice(0, 10);
    const lvAvailable = LEVER_BOARDS.filter((c) => !failedBoards.has(`lv:${c}`));

    const allPromises: Promise<void>[] = [];

    // Greenhouse in batches of 5
    for (let i = 0; i < ghBoards.length; i += 5) {
      const batch = ghBoards.slice(i, i + 5);
      allPromises.push(...batch.map(c => crawlGreenhouse(c)));
    }
    // Lever all at once (only 4 boards)
    allPromises.push(...lvAvailable.map(c => crawlLever(c)));

    await Promise.allSettled(allPromises);
  }

  // ── Direct scrape: major job boards ──
  // DISABLED: LinkedIn, Indeed, Glassdoor, ZipRecruiter, and Workday direct scrapers
  // are unreliable (rate-limited, CAPTCHAs, 403s) and these platforms don't have
  // dedicated auto-apply handlers. JSearch API serves as backup for these sources,
  // and results are filtered to only keep jobs linking to supported ATS platforms.
  // The Playwright scrapers below are kept as dead code for future reference.
  if (false && includeDirectScrape) {
    const SCRAPER_TIMEOUT = 30_000; // 30s max per scraper

    // Helper to run a scraper with timeout and save results
    const runScraper = async (name: string, fn: () => Promise<ParsedJob[]>) => {
      try {
        const jobs = await Promise.race([
          fn(),
          new Promise<ParsedJob[]>((_, reject) =>
            setTimeout(() => reject(new Error(`${name} timeout (${SCRAPER_TIMEOUT / 1000}s)`)), SCRAPER_TIMEOUT)
          ),
        ]);
        if (jobs.length > 0) {
          const { saved, skipped } = await saveJobs(jobs);
          console.log(`[crawl] ${name}: saved ${saved}, skipped ${skipped}`);
          totalSaved += saved;
          totalSkipped += skipped;
        }
      } catch (err) {
        console.warn(`[crawl] ${name}: ${(err as Error).message}`);
        totalErrors++;
      }
    };

    // Workday uses JSON API (no browser) — run in background
    const workdayPromise = runScraper("Workday", () => scrapeWorkdayJobs(query, location, maxPerSource));

    // Browser scrapers run sequentially (one Playwright page at a time)
    // Each has a 30s timeout so they can't stall the scan
    await runScraper("LinkedIn", () => scrapeLinkedInJobs(query, location, 50));
    await runScraper("Indeed", () => scrapeIndeedJobs(query, location, 50));
    await runScraper("Glassdoor", () => scrapeGlassdoorJobs(query, location, 30));
    await runScraper("ZipRecruiter", () => scrapeZipRecruiterJobs(query, location, 30));

    await workdayPromise;
  }

  console.log(`[crawl] Done: ${totalSaved} saved, ${totalSkipped} skipped, ${totalErrors} errors`);
  return { saved: totalSaved, skipped: totalSkipped, errors: totalErrors };
}

// ── Real-time scrape: fetch a single job page and parse it ──
export async function scrapeJobPage(url: string): Promise<ParsedJob | null> {
  try {
    const result = await fetchWithProxy(url);
    if (!result || !result.html) return null;

    // Determine source and use appropriate parser
    if (url.includes("boards.greenhouse.io")) {
      const detail = parseGreenhouseJobDetail(result.html, url);
      if (!detail?.role) return null;
      const company = url.match(/boards\.greenhouse\.io\/([^/]+)/)?.[1] || "Unknown";
      return {
        url,
        company: detail.company || formatCompanyName(company),
        role: detail.role,
        location: detail.location || null,
        salary: null,
        description: detail.description || null,
        source: "greenhouse",
        tags: [],
        employmentType: null,
        isRemote: detail.isRemote || false,
        postedAt: null,
      };
    }

    if (url.includes("jobs.lever.co")) {
      const detail = parseLeverJobDetail(result.html, url);
      if (!detail?.role) return null;
      const company = url.match(/jobs\.lever\.co\/([^/]+)/)?.[1] || "Unknown";
      return {
        url,
        company: detail.company || formatCompanyName(company),
        role: detail.role,
        location: detail.location || null,
        salary: null,
        description: detail.description || null,
        source: "lever",
        tags: [],
        employmentType: null,
        isRemote: detail.isRemote || false,
        postedAt: null,
      };
    }

    // Generic: try JSON-LD / Open Graph
    const parsed = parseGenericJobPage(result.html, url);
    if (!parsed?.role) return null;

    return {
      url,
      company: (parsed.company as string) || "Unknown",
      role: parsed.role,
      location: parsed.location || null,
      salary: parsed.salary || null,
      description: parsed.description || null,
      source: detectSourceFromUrl(url),
      tags: [],
      employmentType: parsed.employmentType || null,
      isRemote: parsed.isRemote || false,
      postedAt: parsed.postedAt || null,
    };
  } catch (err) {
    console.error(`[scrape] Failed to scrape ${url}:`, (err as Error).message);
    return null;
  }
}

// ── Query the ScrapedJob cache ──
export async function queryScrapedJobs(
  query: string,
  options: {
    location?: string;
    isRemote?: boolean;
    sources?: string[];
    limit?: number;
    maxAgeDays?: number;
  } = {}
): Promise<ScrapedJobResult[]> {
  const {
    location,
    isRemote,
    sources,
    limit = 50,
    maxAgeDays = 7,
  } = options;

  const minDate = new Date();
  minDate.setDate(minDate.getDate() - maxAgeDays);

  // Build where clause
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {
    active: true,
    scrapedAt: { gte: minDate },
  };

  if (sources && sources.length > 0) {
    where.source = { in: sources };
  }

  if (isRemote !== undefined) {
    where.isRemote = isRemote;
  }

  // Fetch all active jobs within the time window
  const jobs = await prisma.scrapedJob.findMany({
    where,
    orderBy: { scrapedAt: "desc" },
    take: limit * 3, // Fetch more than needed for keyword filtering
  });

  // Keyword-based filtering with synonym expansion (SQLite has no full-text search)
  const keywords = query.toLowerCase().split(/[\s,]+/).filter((k) => k.length > 2);
  const locationKeywords = location?.toLowerCase().split(/[\s,]+/).filter((k) => k.length > 2) || [];

  // Expand keywords with synonyms for better matching
  const SYNONYMS: Record<string, string[]> = {
    "engineer": ["developer", "dev", "programmer", "architect", "swe"],
    "software": ["backend", "frontend", "fullstack", "full-stack", "web", "mobile", "platform"],
    "senior": ["staff", "principal", "lead", "sr"],
    "devops": ["sre", "infrastructure", "platform", "cloud", "reliability"],
    "data": ["analytics", "ml", "machine learning", "ai", "scientist"],
    "manager": ["director", "head", "vp", "lead"],
    "designer": ["ux", "ui", "product design", "design"],
  };

  const expandedKeywords = new Set(keywords);
  for (const kw of keywords) {
    const synonyms = SYNONYMS[kw];
    if (synonyms) synonyms.forEach((s) => expandedKeywords.add(s));
  }

  const scored = jobs.map((job) => {
    const roleText = job.role.toLowerCase();
    const text = `${roleText} ${job.company} ${job.description || ""} ${job.tags}`.toLowerCase();
    const locText = `${job.location || ""}`.toLowerCase();

    // Score by keyword matches (original + expanded)
    let score = 0;
    for (const kw of Array.from(expandedKeywords)) {
      if (roleText.includes(kw)) score += 3;
      else if (text.includes(kw)) score += 1;
    }

    // Bonus for exact original keyword matches
    for (const kw of keywords) {
      if (roleText.includes(kw)) score += 2;
    }

    // Location scoring
    if (locationKeywords.length > 0) {
      for (const kw of locationKeywords) {
        if (locText.includes(kw)) score += 2;
      }
    }
    if (isRemote && job.isRemote) score += 3;

    return { ...job, relevanceScore: score };
  });

  // Sort by relevance score
  scored.sort((a, b) => b.relevanceScore - a.relevanceScore);

  // Return jobs with any relevance; if too few, include all recent jobs as fallback
  const relevant = scored.filter((j) => j.relevanceScore > 0);
  if (relevant.length >= 5) {
    return relevant.slice(0, limit);
  }

  // Fallback: return all jobs sorted by score (even 0-score), capped at limit
  return scored.slice(0, limit);
}

export interface ScrapedJobResult {
  id: string;
  url: string;
  company: string;
  role: string;
  location: string | null;
  salary: string | null;
  description: string | null;
  source: string;
  tags: string;
  employmentType: string | null;
  isRemote: boolean;
  postedAt: Date | null;
  scrapedAt: Date;
  relevanceScore: number;
}

// ── Helpers ──

async function saveJobs(jobs: ParsedJob[]): Promise<{ saved: number; skipped: number }> {
  let saved = 0;
  let skipped = 0;

  for (const job of jobs) {
    if (!job.url || !job.company || !job.role) {
      skipped++;
      continue;
    }

    try {
      await prisma.scrapedJob.upsert({
        where: { url: job.url },
        create: {
          url: job.url,
          company: job.company,
          role: job.role,
          location: job.location,
          salary: job.salary,
          description: job.description,
          source: job.source,
          tags: JSON.stringify(job.tags || []),
          employmentType: job.employmentType,
          isRemote: job.isRemote,
          postedAt: job.postedAt,
          updatedAt: new Date(),
        },
        update: {
          company: job.company,
          role: job.role,
          location: job.location,
          salary: job.salary || undefined,
          description: job.description || undefined,
          tags: job.tags.length > 0 ? JSON.stringify(job.tags) : undefined,
          active: true,
          updatedAt: new Date(),
        },
      });
      saved++;
    } catch (err) {
      // Likely a unique constraint violation — skip
      const msg = (err as Error).message;
      if (!msg.includes("Unique constraint")) {
        console.error(`[crawl] Save error for ${job.url}:`, msg);
      }
      skipped++;
    }
  }

  return { saved, skipped };
}

// ── Stale job cleanup — mark old jobs as inactive ──
export async function cleanupStaleJobs(maxAgeDays = 30): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxAgeDays);

  const result = await prisma.scrapedJob.updateMany({
    where: {
      active: true,
      updatedAt: { lt: cutoff },
    },
    data: { active: false },
  });

  if (result.count > 0) {
    console.log(`[cleanup] Marked ${result.count} stale jobs as inactive (older than ${maxAgeDays} days)`);
  }
  return result.count;
}

// ── Google Jobs scraping via SerpAPI (if key available) ──
export async function crawlGoogleJobs(
  query: string,
  location: string,
  maxResults = 20,
): Promise<{ saved: number; errors: number }> {
  const SERP_API_KEY = process.env.SERPAPI_KEY;
  if (!SERP_API_KEY) return { saved: 0, errors: 0 };

  try {
    const params = new URLSearchParams({
      engine: "google_jobs",
      q: `${query} ${location}`,
      api_key: SERP_API_KEY,
      chips: "date_posted:week",
    });

    console.log(`[crawl] Google Jobs: "${query}" in "${location}"...`);
    const res = await fetch(`https://serpapi.com/search.json?${params}`, {
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      console.error(`[crawl] Google Jobs API error: ${res.status}`);
      return { saved: 0, errors: 1 };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();
    const jobs = data.jobs_results || [];
    console.log(`[crawl] Google Jobs: ${jobs.length} results`);

    const parsedJobs: ParsedJob[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const j of jobs.slice(0, maxResults)) {
      // Google Jobs provides apply links from multiple sources
      const applyLinks = j.apply_options || [];
      const bestLink = applyLinks[0]?.link || j.share_link;
      if (!bestLink || !j.company_name || !j.title) continue;

      const source = applyLinks[0]?.title
        ? detectSourceFromUrl(applyLinks[0].link) || applyLinks[0].title
        : "google_jobs";

      parsedJobs.push({
        url: bestLink,
        company: j.company_name,
        role: j.title,
        location: j.location || null,
        salary: j.salary || null,
        description: j.description?.substring(0, 5000) || null,
        source: typeof source === "string" ? source : "google_jobs",
        tags: j.extensions?.filter((e: string) => !e.includes("ago") && !e.includes("hour")) || [],
        employmentType: j.detected_extensions?.schedule_type || null,
        isRemote: j.location?.toLowerCase().includes("remote") || false,
        postedAt: null,
      });
    }

    const { saved } = await saveJobs(parsedJobs);
    console.log(`[crawl] Google Jobs: saved ${saved}`);
    return { saved, errors: 0 };
  } catch (err) {
    console.error(`[crawl] Google Jobs error:`, (err as Error).message);
    return { saved: 0, errors: 1 };
  }
}

function filterByQuery(jobs: ParsedJob[], query: string): ParsedJob[] {
  const keywords = query.toLowerCase().split(/[\s,]+/).filter((k) => k.length > 2);
  if (keywords.length === 0) return jobs;

  return jobs.filter((job) => {
    const text = `${job.role} ${job.company} ${job.description || ""}`.toLowerCase();
    return keywords.some((kw) => text.includes(kw));
  });
}

function detectSourceFromUrl(url: string): string {
  if (url.includes("linkedin.com")) return "linkedin";
  if (url.includes("indeed.com")) return "indeed";
  if (url.includes("glassdoor.com")) return "glassdoor";
  if (url.includes("greenhouse.io")) return "greenhouse";
  if (url.includes("lever.co")) return "lever";
  if (url.includes("ziprecruiter.com")) return "ziprecruiter";
  if (url.includes("wellfound.com")) return "wellfound";
  if (url.includes("dice.com")) return "dice";
  if (url.includes("builtin.com")) return "builtin";
  if (url.includes("monster.com")) return "monster";
  if (url.includes("simplyhired.com")) return "simplyhired";
  if (url.includes("smartrecruiters.com")) return "smartrecruiters";
  if (url.includes("workday")) return "workday";
  if (url.includes("ashbyhq.com")) return "ashby";
  if (url.includes("bamboohr.com")) return "bamboohr";
  if (url.includes("jobvite.com")) return "jobvite";
  return "other";
}

function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function formatCompanyName(slug: string): string {
  return slug
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
