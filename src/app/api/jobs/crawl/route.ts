// Background crawl API — triggers scraping from multiple job sources
// Can be called by:
//   - Cron job (GET with ?cron_secret=...) — no auth needed, crawls for ALL users
//   - Authenticated user (POST) — crawls for that user's preferences
//   - Manual trigger from dashboard (POST)

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { crawlJobs, cleanupStaleJobs, crawlGoogleJobs, isJSearchAvailable, getJSearchStatus } from "@/lib/scraper";
import { prisma } from "@/lib/prisma";

// In-memory lock to prevent concurrent background crawls
let backgroundCrawlRunning = false;

// GET: cron-triggered background crawl OR stats
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const cronSecret = url.searchParams.get("cron_secret");
  const CRON_SECRET = process.env.CRON_SECRET;

  // If cron_secret param is present, this is a cron-triggered crawl
  if (cronSecret) {
    if (!CRON_SECRET || cronSecret !== CRON_SECRET) {
      return NextResponse.json({ error: "Invalid cron secret" }, { status: 401 });
    }
    return runBackgroundCrawl();
  }

  // Otherwise, return stats (requires auth)
  try {
    const { userId: clerkId } = auth();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const totalJobs = await prisma.scrapedJob.count({ where: { active: true } });
    const last24h = await prisma.scrapedJob.count({
      where: {
        active: true,
        scrapedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    });
    const bySource = await prisma.scrapedJob.groupBy({
      by: ["source"],
      where: { active: true },
      _count: true,
    });

    const jsearchStatus = getJSearchStatus();

    return NextResponse.json({
      totalJobs,
      last24h,
      bySource: bySource.map((s) => ({ source: s.source, count: s._count })),
      jsearch: jsearchStatus,
      backgroundCrawlRunning,
    });
  } catch (err) {
    console.error("[crawl-api] Stats error:", err);
    return NextResponse.json({ error: "Failed to get stats" }, { status: 500 });
  }
}

// POST: user-triggered crawl (requires auth)
export async function POST(req: NextRequest) {
  try {
    const { userId: clerkId } = auth();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { queries, location, includeAts, includeDirectScrape } = body;

    let searchQueries: string[] = queries || [];
    let searchLocation: string = location || "United States";

    if (searchQueries.length === 0) {
      const user = await prisma.user.findUnique({
        where: { clerkId },
        include: { preferences: true },
      });

      if (user?.preferences) {
        const targetRoles = JSON.parse(user.preferences.targetRoles || "[]");
        const locations = JSON.parse(user.preferences.preferredLocations || "[]");
        searchQueries = targetRoles.length > 0 ? targetRoles : [user.jobTitle || "Software Engineer"];
        searchLocation = locations.length > 0 ? locations[0] : "United States";
      } else {
        searchQueries = ["Software Engineer"];
      }
    }

    console.log(`[crawl-api] User crawl: queries=${searchQueries.join(", ")}, location=${searchLocation}`);
    await cleanupStaleJobs(30);

    let totalSaved = 0, totalSkipped = 0, totalErrors = 0;

    for (const query of searchQueries.slice(0, 3)) {
      const result = await crawlJobs(query, searchLocation, {
        maxPerSource: 50,
        includeAts: includeAts !== false,
        includeJSearch: isJSearchAvailable(),
        includeDirectScrape: includeDirectScrape || false,
      });
      totalSaved += result.saved;
      totalSkipped += result.skipped;
      totalErrors += result.errors;

      const gResult = await crawlGoogleJobs(query, searchLocation);
      totalSaved += gResult.saved;
      totalErrors += gResult.errors;
    }

    return NextResponse.json({ success: true, saved: totalSaved, skipped: totalSkipped, errors: totalErrors });
  } catch (err) {
    console.error("[crawl-api] Error:", err);
    return NextResponse.json({ error: "Crawl failed" }, { status: 500 });
  }
}

// Background crawl — runs for all users with auto-scan enabled
// Uses Playwright direct scrapers + ATS APIs to keep cache fresh
async function runBackgroundCrawl() {
  if (backgroundCrawlRunning) {
    return NextResponse.json({ message: "Background crawl already running" }, { status: 409 });
  }

  backgroundCrawlRunning = true;
  const startTime = Date.now();

  try {
    console.log(`[bg-crawl] Starting background crawl...`);

    // Get all unique search queries from users with auto-scan enabled
    const activePrefs = await prisma.userPreferences.findMany({
      where: { autoScanActive: true },
      include: { user: { select: { jobTitle: true } } },
    });

    // Collect unique queries and locations
    const querySet = new Set<string>();
    const locationSet = new Set<string>();

    for (const pref of activePrefs) {
      const roles: string[] = JSON.parse(pref.targetRoles || "[]");
      const locs: string[] = JSON.parse(pref.preferredLocations || "[]");
      if (roles.length > 0) {
        roles.slice(0, 3).forEach(r => querySet.add(r));
      } else if (pref.user.jobTitle) {
        querySet.add(pref.user.jobTitle);
      }
      if (locs.length > 0) locationSet.add(locs[0]);
    }

    // Fallback defaults
    if (querySet.size === 0) querySet.add("Software Engineer");
    if (locationSet.size === 0) locationSet.add("United States");

    const queries = Array.from(querySet).slice(0, 5);
    const location = Array.from(locationSet)[0];

    console.log(`[bg-crawl] ${activePrefs.length} active users, ${queries.length} queries, location="${location}"`);

    // Cleanup stale jobs
    await cleanupStaleJobs(30);

    let totalSaved = 0, totalErrors = 0;
    const jsearchUp = isJSearchAvailable();

    for (const query of queries) {
      console.log(`[bg-crawl] Crawling "${query}" in "${location}" (jsearch=${jsearchUp})...`);
      try {
        const result = await crawlJobs(query, location, {
          maxPerSource: 50,
          includeAts: true,
          includeJSearch: jsearchUp,
          includeDirectScrape: true, // Always use Playwright in background crawls
        });
        totalSaved += result.saved;
        totalErrors += result.errors;
      } catch (err) {
        console.error(`[bg-crawl] Error crawling "${query}":`, (err as Error).message);
        totalErrors++;
      }
    }

    const duration = Math.round((Date.now() - startTime) / 1000);
    console.log(`[bg-crawl] Done: ${totalSaved} saved, ${totalErrors} errors, ${duration}s`);

    return NextResponse.json({
      success: true,
      saved: totalSaved,
      errors: totalErrors,
      duration: `${duration}s`,
      queries,
      location,
      jsearchAvailable: jsearchUp,
    });
  } catch (err) {
    console.error("[bg-crawl] Fatal error:", err);
    return NextResponse.json({ error: "Background crawl failed" }, { status: 500 });
  } finally {
    backgroundCrawlRunning = false;
  }
}
