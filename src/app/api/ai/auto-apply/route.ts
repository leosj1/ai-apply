import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import OpenAI from "openai";
import { crawlJobs, queryScrapedJobs, isJSearchAvailable, getJSearchStatus, isSupportedPlatformUrl } from "@/lib/scraper";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// Claude client — preferred for AI agent and question answering
let anthropicClient: any = null;
try {
  if (process.env.ANTHROPIC_API_KEY) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Anthropic = require("@anthropic-ai/sdk").default || require("@anthropic-ai/sdk");
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    console.log("[AutoApply] Claude client initialized (preferred for AI agent)");
  }
} catch (err) {
  console.log(`[AutoApply] Claude client not available: ${(err as Error).message?.slice(0, 60)}`);
}

// Resolved AI client: Claude preferred, OpenAI fallback
const resolvedAIClient = anthropicClient
  ? { provider: "claude" as const, client: anthropicClient }
  : openai
    ? { provider: "openai" as const, client: openai }
    : null;

// In-memory scan state per user — survives page refresh but not server restart
const activeScanState = new Map<string, { percent: number; label: string; startedAt: number }>();

// Auto-detect career pivot by comparing current role keywords against target role keywords
// Returns pivot context string if detected, empty string otherwise
function detectCareerPivot(
  currentRole: string | null | undefined,
  targetRoles: string[],
  resumeSnippet: string | null,
  manualPivot?: { isPivoting?: boolean; pivotFromRole?: string | null; pivotToRole?: string | null; pivotTransferableSkills?: string | null },
): { isPivoting: boolean; fromRole: string; toRole: string; transferableSkills: string[] } {
  // If user manually set pivot, honor that
  if (manualPivot?.isPivoting) {
    const skills = (() => { try { return JSON.parse(manualPivot.pivotTransferableSkills || "[]"); } catch { return []; } })();
    return { isPivoting: true, fromRole: manualPivot.pivotFromRole || currentRole || "current role", toRole: manualPivot.pivotToRole || targetRoles[0] || "", transferableSkills: skills };
  }

  if (!currentRole || targetRoles.length === 0) return { isPivoting: false, fromRole: "", toRole: "", transferableSkills: [] };

  // Normalize and tokenize role titles into keyword sets
  const tokenize = (s: string) => s.toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()
    .split(" ").filter((w) => w.length > 2 && !["the", "and", "for", "with", "senior", "junior", "lead", "staff", "principal", "manager", "director", "head"].includes(w));

  const currentTokens = new Set(tokenize(currentRole));
  const targetTokenSets = targetRoles.map((r) => new Set(tokenize(r)));

  // Check overlap — if less than 30% of current role keywords appear in ANY target role, it's a pivot
  let maxOverlap = 0;
  let bestTarget = targetRoles[0];
  for (let i = 0; i < targetTokenSets.length; i++) {
    const target = targetTokenSets[i];
    const overlap = Array.from(currentTokens).filter((t) => target.has(t)).length;
    const ratio = currentTokens.size > 0 ? overlap / Math.max(currentTokens.size, target.size) : 0;
    if (ratio > maxOverlap) { maxOverlap = ratio; bestTarget = targetRoles[i]; }
  }

  const isPivoting = maxOverlap < 0.3;
  if (!isPivoting) return { isPivoting: false, fromRole: "", toRole: "", transferableSkills: [] };

  // Auto-infer transferable skills from resume snippet
  const universalSkills = ["leadership", "communication", "project management", "stakeholder management",
    "problem solving", "data analysis", "team collaboration", "strategic planning", "process improvement",
    "cross-functional", "mentoring", "budgeting", "presentation", "negotiation", "agile", "scrum"];
  const resumeLower = (resumeSnippet || "").toLowerCase();
  const detectedSkills = universalSkills.filter((s) => resumeLower.includes(s));
  if (detectedSkills.length === 0) detectedSkills.push("leadership", "communication", "problem solving");

  return { isPivoting: true, fromRole: currentRole, toRole: bestTarget, transferableSkills: detectedSkills };
}

const JOB_SOURCES = ["LinkedIn", "Indeed", "Glassdoor", "Greenhouse", "Lever", "Workday", "ZipRecruiter", "Dice", "Built In", "Wellfound", "Company Website"];

// URL patterns that are NEVER job postings — block specific paths, not entire domains
const BLOCKED_URL_PATTERNS = [
  /levels\.fyi/i,
  /payscale\.com/i,
  /salary\.com/i,
  /comparably\.com/i,
  /glassdoor\.com\/Salaries/i,
  /glassdoor\.com\/Reviews/i,
  /glassdoor\.com\/Overview/i,
  /google\.com\/search/i,
  /bing\.com\/search/i,
  /youtube\.com/i,
  /reddit\.com/i,
  /twitter\.com/i,
  /x\.com\/(?!.*jobs)/i,
  /wikipedia\.org/i,
  /stackoverflow\.com\/questions/i,
  /github\.com\/(?!.*careers|.*jobs)/i,
  /amazon\.com\/s\?/i,
  /jobleads\.com/i,
  /jooble\.org/i,
  /talent\.com\/redirect/i,
  /neuvoo\.com/i,
  /careerbuilder\.com\/advice/i,
  /theladders\.com\/career-advice/i,
];

// Known job board URL patterns — trusted sources, auto-approved if HTTP 200
const JOB_URL_PATTERNS = [
  // ATS platforms
  /boards\.greenhouse\.io\/[\w-]+\/jobs\//i,
  /jobs\.lever\.co\/[\w-]+\//i,
  /apply\.workable\.com\//i,
  /ashbyhq\.com\/[\w-]+\/jobs\//i,
  /jobs\.smartrecruiters\.com\//i,
  /icims\.com\/jobs\//i,
  /myworkdayjobs\.com\//i,
  /taleo\.net\/careersection/i,
  /jobvite\.com\/.*\/job\//i,
  /bamboohr\.com\/.*\/jobs\//i,
  /recruitee\.com\/o\//i,
  /breezy\.hr\/p\//i,
  /jazz\.co\/apply\//i,
  // Major job boards
  /linkedin\.com\/jobs\/view\//i,
  /glassdoor\.com\/job-listing\//i,
  /glassdoor\.com\/Job\/.*-jobs-/i,
  /indeed\.com\/viewjob/i,
  /indeed\.com\/rc\/clk/i,
  /ziprecruiter\.com\/c\//i,
  /ziprecruiter\.com\/jobs\//i,
  /dice\.com\/job-detail\//i,
  /monster\.com\/job-openings\//i,
  /simplyhired\.com\/job\//i,
  /wellfound\.com\/.*\/jobs\//i,
  /builtin\.com\/job\//i,
  /otta\.com\/jobs\//i,
  // Career page patterns
  /careers\.[\w-]+\.com/i,
  /jobs\.[\w-]+\.com/i,
  /\/careers?\/.*job/i,
  /\/job[s]?\/\d+/i,
  /\/careers?\/.*\d{4,}/i,
  /\/openings?\//i,
];

// Helper: extract citation URLs from Responses API output
function extractCitationUrls(response: Record<string, unknown>): string[] {
  const urls: string[] = [];
  try {
    const output = response.output as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(output)) {
      for (const item of output) {
        if (item.type === "message") {
          const content = item.content as Array<Record<string, unknown>> | undefined;
          if (Array.isArray(content)) {
            for (const block of content) {
              const annotations = block.annotations as Array<Record<string, unknown>> | undefined;
              if (Array.isArray(annotations)) {
                for (const ann of annotations) {
                  if (ann.type === "url_citation" && typeof ann.url === "string") {
                    urls.push(ann.url);
                  }
                }
              }
            }
          }
        }
      }
    }
  } catch { /* ignore parsing errors */ }
  return urls;
}

// Validate a URL is a real job posting: checks HTTP status + page content
async function isValidJobUrl(url: string, timeoutMs = 10000): Promise<boolean> {
  if (!url || !url.startsWith("http")) return false;

  // Block known non-job URL patterns
  for (const pattern of BLOCKED_URL_PATTERNS) {
    if (pattern.test(url)) return false;
  }

  // LinkedIn: can't fetch (requires login). Trust if URL has valid job ID format.
  if (url.includes("linkedin.com/jobs/view/")) {
    const pathMatch = url.match(/linkedin\.com\/jobs\/view\/([^?#/]+)/);
    if (pathMatch) {
      const segment = pathMatch[1];
      if (/^\d{8,}$/.test(segment)) return true;
      const trailingId = segment.match(/-(\d{8,})$/);
      if (trailingId) return true;
    }
    console.log(`[url-validate] Rejected LinkedIn ${url}: invalid job ID format`);
    return false;
  }

  // ATS platforms: trust URL pattern without fetching (they often block bots / use SPAs)
  const trustedDomains = [
    "boards.greenhouse.io", "job-boards.greenhouse.io", "greenhouse.io",
    "jobs.lever.co", "lever.co",
    "linkedin.com/jobs", "linkedin.com/in",
    "myworkdayjobs.com", "workday.com",
    "ashbyhq.com", "jobs.ashby.com",
    "jobs.smartrecruiters.com", "smartrecruiters.com",
    "icims.com",
    "taleo.net", "oracle.com",
    "apply.workable.com", "jobs.workable.com",
    "indeed.com/viewjob", "indeed.com/jobs",
    "glassdoor.com/job",
    "workingnomads.com", "weworkremotely.com", "remoteok.com",
    "angel.co/company", "wellfound.com",
    "builtin.com/job", "dice.com/job",
    "ziprecruiter.com/jobs", "monster.com/job",
    "simplyhired.com/job", "careerbuilder.com/job",
    "recruit.net", "jobright.ai", "otta.com",
    // Company career pages that embed ATS
    "/careers/", "/jobs/", "/job/",
    "careers.airbnb.com", "careers.google.com", "careers.microsoft.com",
    "jobs.netflix.com", "careers.walmart.com",
  ];
  const lowerUrl = url.toLowerCase();
  for (const domain of trustedDomains) {
    if (lowerUrl.includes(domain)) return true;
  }

  // Trust any URL with ATS query parameters (gh_jid = Greenhouse, lever_source, etc.)
  const atsQueryParams = ["gh_jid", "lever_source", "ashby_jid", "icims_id"];
  for (const param of atsQueryParams) {
    if (lowerUrl.includes(param + "=")) return true;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
      },
    });
    clearTimeout(timer);

    if (res.status < 200 || res.status >= 400) return false;

    // Check both original URL and final URL (after redirects) against known patterns
    const finalUrl = res.url || url;
    for (const pattern of JOB_URL_PATTERNS) {
      if (pattern.test(url) || pattern.test(finalUrl)) return true;
    }

    // For other URLs, check page content for job posting signals (weighted)
    const html = await res.text();
    const lowerHtml = html.substring(0, 80000).toLowerCase();

    // Strong signals (worth 2 points each)
    const strongSignals = [
      "job description", "responsibilities", "qualifications",
      "requirements", "about the role", "what you'll do",
      "what we're looking for", "apply now", "submit application",
      "apply for this", "job details", "we are hiring",
    ];
    // Weak signals (worth 1 point each)
    const weakSignals = [
      "apply", "career", "position", "job posting",
      "full-time", "part-time", "remote", "salary", "compensation",
      "benefits", "equal opportunity", "experience required",
    ];

    let score = 0;
    for (const s of strongSignals) { if (lowerHtml.includes(s)) score += 2; }
    for (const s of weakSignals) { if (lowerHtml.includes(s)) score += 1; }

    // Also check for JSON-LD JobPosting schema (very strong signal)
    if (lowerHtml.includes('"jobposting"') || lowerHtml.includes('"job_posting"')) score += 5;

    if (score < 3) {
      console.log(`[url-validate] Rejected ${url}: job signal score ${score}/3`);
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

// Validate multiple URLs in parallel, returns a Set of valid job posting URLs
async function validateUrls(urls: string[]): Promise<Set<string>> {
  const results = await Promise.allSettled(
    urls.map(async (url) => ({ url, valid: await isValidJobUrl(url) }))
  );
  const valid = new Set<string>();
  for (const r of results) {
    if (r.status === "fulfilled" && r.value.valid) valid.add(r.value.url);
  }
  return valid;
}

// GET: fetch status, jobs, preferences, notifications, and analytics
export async function GET() {
  try {
    const { userId: clerkId } = auth();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { clerkId },
      include: { preferences: true, jobApplications: true, resumes: true, notifications: { orderBy: { createdAt: "desc" }, take: 20 } },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());

    const appliedJobs = user.jobApplications.filter((j) => j.status === "applied" || j.status === "phone_screen" || j.status === "interview" || j.status === "offer");
    const appliedToday = appliedJobs.filter((j) => j.appliedAt && j.appliedAt >= startOfDay).length;
    const appliedThisWeek = appliedJobs.filter((j) => j.appliedAt && j.appliedAt >= startOfWeek).length;

    const scoredJobs = user.jobApplications.filter((j) => j.matchScore != null);
    const averageMatchScore = scoredJobs.length > 0
      ? Math.round(scoredJobs.reduce((sum, j) => sum + (j.matchScore || 0), 0) / scoredJobs.length)
      : 0;

    const jobs = user.jobApplications
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((j) => ({
        id: j.id,
        company: j.company,
        role: j.role,
        location: j.location,
        salary: j.salary,
        match: j.matchScore || 0,
        status: j.status,
        appliedAt: j.appliedAt ? getRelativeTime(j.appliedAt) : null,
        tags: JSON.parse(j.tags || "[]"),
        url: j.url,
        source: j.source,
        matchBreakdown: j.matchBreakdown ? JSON.parse(j.matchBreakdown) : null,
        hasPackage: !!(j.tailoredResume && j.generatedCoverLetter),
        tailoredResume: j.tailoredResume || null,
        generatedCoverLetter: j.generatedCoverLetter || null,
        jobDescription: j.jobDescription || null,
        createdAt: j.createdAt.toISOString(),
      }));

    // Auto-scan check: uses its own toggle, separate from auto-apply
    const prefs = user.preferences;
    let scanDue = false;
    const scanCredits = prefs?.scanCredits ?? 50;
    if (prefs?.autoScanActive && scanCredits > 0 && prefs.lastScannedAt) {
      const minsSince = (now.getTime() - prefs.lastScannedAt.getTime()) / 60000;
      const interval = prefs.scanInterval || "daily";
      const intervalMinutes: Record<string, number> = {
        "1min": 1, "5min": 5, "10min": 10, "30min": 30,
        "hourly": 60, "daily": 1440, "weekly": 10080,
      };
      if (minsSince >= (intervalMinutes[interval] || 1440)) scanDue = true;
    } else if (prefs?.autoScanActive && scanCredits > 0 && !prefs.lastScannedAt) {
      scanDue = true;
    }

    // Weekly analytics (last 7 days)
    const analytics = { daily: [] as { day: string; applied: number; matched: number }[] };
    for (let i = 6; i >= 0; i--) {
      const d = new Date(startOfDay);
      d.setDate(d.getDate() - i);
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      const dayApps = user.jobApplications.filter((j) => j.createdAt >= d && j.createdAt < next);
      analytics.daily.push({
        day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()],
        applied: dayApps.filter((j) => j.status === "applied" || j.status === "phone_screen" || j.status === "interview" || j.status === "offer").length,
        matched: dayApps.filter((j) => j.status === "matched").length,
      });
    }

    // Check if a scan is currently running for this user
    const currentScan = activeScanState.get(user.id);
    const scanInProgress = !!currentScan && (Date.now() - currentScan.startedAt < 180_000);

    // Check Gmail connection status for verification code retrieval
    let gmailConnected = false;
    const gmailToken = await prisma.gmailToken.findUnique({ where: { userId: user.id }, select: { email: true } });
    if (gmailToken) {
      gmailConnected = true;
    } else {
      // Try Clerk auto-connect in background
      try {
        const { autoConnectGmailFromClerk } = await import("@/lib/email/gmail");
        gmailConnected = await autoConnectGmailFromClerk(clerkId, user.id, user.email);
      } catch { /* non-critical */ }
    }

    return NextResponse.json({
      isActive: prefs?.autoApplyActive ?? false,
      autoScanActive: prefs?.autoScanActive ?? false,
      scanInterval: prefs?.scanInterval || "daily",
      scanCredits,
      lastScannedAt: prefs?.lastScannedAt?.toISOString() || null,
      scanDue,
      scanInProgress,
      scanProgress: scanInProgress ? { percent: currentScan!.percent, label: currentScan!.label } : null,
      appliedToday,
      appliedThisWeek,
      averageMatchScore,
      totalMatched: user.jobApplications.filter((j) => j.status === "matched").length,
      totalReady: user.jobApplications.filter((j) => j.status === "ready").length,
      totalApplied: appliedJobs.length,
      totalInterviewing: user.jobApplications.filter((j) => j.status === "interview" || j.status === "phone_screen").length,
      totalOffers: user.jobApplications.filter((j) => j.status === "offer").length,
      jobs,
      hasResume: user.resumes.length > 0,
      gmailConnected,
      preferences: prefs
        ? {
            targetRoles: JSON.parse(prefs.targetRoles || "[]"),
            locations: JSON.parse(prefs.preferredLocations || "[]"),
            companySizes: JSON.parse(prefs.companySizes || "[]"),
            minSalary: prefs.minSalary,
          }
        : null,
      notifications: user.notifications.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        message: n.message,
        read: n.read,
        createdAt: getRelativeTime(n.createdAt),
      })),
      unreadCount: user.notifications.filter((n) => !n.read).length,
      analytics,
    });
  } catch (error) {
    console.error("Auto-apply GET error:", error);
    return NextResponse.json({ error: "Failed to fetch status" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId: clerkId } = auth();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { clerkId },
      include: { preferences: true, resumes: true, jobApplications: { select: { company: true, role: true, url: true, status: true } } },
    });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const body = await req.json();
    const { action } = body;

    // ── TOGGLE auto-apply on/off ──
    if (action === "toggle") {
      const current = user.preferences?.autoApplyActive ?? false;
      if (user.preferences) {
        await prisma.userPreferences.update({
          where: { userId: user.id },
          data: { autoApplyActive: !current },
        });
      } else {
        await prisma.userPreferences.create({
          data: { userId: user.id, autoApplyActive: true },
        });
      }
      return NextResponse.json({ isActive: !current });
    }

    // ── TOGGLE auto-scan on/off (separate from auto-apply) ──
    if (action === "toggleScan") {
      const current = user.preferences?.autoScanActive ?? false;
      if (user.preferences) {
        await prisma.userPreferences.update({
          where: { userId: user.id },
          data: { autoScanActive: !current },
        });
      } else {
        await prisma.userPreferences.create({
          data: { userId: user.id, autoScanActive: true },
        });
      }
      return NextResponse.json({ autoScanActive: !current });
    }

    // ── UPDATE SCAN INTERVAL ──
    if (action === "updateScanInterval") {
      const { interval } = body;
      if (!["1min", "5min", "10min", "30min", "hourly", "daily", "weekly"].includes(interval)) {
        return NextResponse.json({ error: "Invalid interval" }, { status: 400 });
      }
      if (user.preferences) {
        await prisma.userPreferences.update({
          where: { userId: user.id },
          data: { scanInterval: interval },
        });
      }
      return NextResponse.json({ success: true, scanInterval: interval });
    }

    // ── SCAN — Multi-source job discovery with SSE progress streaming ──
    if (action === "scan") {
      const prefs = user.preferences;

      // Credit check
      const currentCredits = prefs?.scanCredits ?? 0;
      if (currentCredits <= 0) {
        if (prefs?.autoScanActive) {
          await prisma.userPreferences.update({
            where: { userId: user.id },
            data: { autoScanActive: false },
          });
        }
        return NextResponse.json({ error: "No scan credits remaining. Purchase more credits to continue scanning.", noCredits: true }, { status: 403 });
      }

      const targetRoles = prefs ? JSON.parse(prefs.targetRoles || "[]") : [];
      const locations = prefs ? JSON.parse(prefs.preferredLocations || "[]") : [];
      const minSalary = prefs?.minSalary || "100000";

      const roleContext = targetRoles.length > 0 ? targetRoles.join(", ") : user.jobTitle || "Software Engineer";
      const locationContext = locations.length > 0 ? locations[0] : "United States";
      const isRemote = locations.some((l: string) => l.toLowerCase().includes("remote"));

      // Source display name helper
      const SOURCE_NAMES: Record<string, string> = {
        linkedin: "LinkedIn", indeed: "Indeed", glassdoor: "Glassdoor",
        greenhouse: "Greenhouse", lever: "Lever", ziprecruiter: "ZipRecruiter",
        dice: "Dice", builtin: "Built In", wellfound: "Wellfound",
        monster: "Monster", simplyhired: "SimplyHired", smartrecruiters: "SmartRecruiters",
        workday: "Workday", ashby: "Ashby", bamboohr: "BambooHR", jobvite: "Jobvite",
      };
      const displaySource = (s: string) => SOURCE_NAMES[s.toLowerCase()] || (s.charAt(0).toUpperCase() + s.slice(1));

      // Get existing jobs for dedup — include dismissed/rejected jobs
      const existingKeys = new Set(user.jobApplications.map((j) => `${j.company}|||${j.role}`));
      const existingUrls = new Set(user.jobApplications.map((j) => j.url).filter(Boolean));
      // Also track normalized keys for fuzzy dedup (Sr. → Senior, etc.)
      const normalizeTitle = (s: string) => s.toLowerCase()
        .replace(/\bsr\.?\b/g, "senior").replace(/\bjr\.?\b/g, "junior")
        .replace(/\blead\b/g, "senior").replace(/\bprincipal\b/g, "staff")
        .replace(/\bengr?\b/g, "engineer").replace(/\bdev\b/g, "developer")
        .replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
      const existingNormKeys = new Set(user.jobApplications.map((j) =>
        `${j.company.toLowerCase()}|||${normalizeTitle(j.role)}`
      ));

      const TARGET_JOBS = 25;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const candidateJobs: any[] = [];
      const seenUrls = new Set<string>();
      const seenNormKeys = new Set<string>();

      // Track source counts for diversity — no single source should dominate
      const sourceCounts: Record<string, number> = {};
      const MAX_PER_SOURCE = 15; // Cap any single source at 15 candidates

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const addCandidate = (job: any) => {
        if (!job.url || !job.company || !job.role) return false;
        // Only keep jobs from platforms with proven auto-apply automation
        if (!isSupportedPlatformUrl(job.url)) return false;
        if (seenUrls.has(job.url) || existingUrls.has(job.url)) return false;
        // Exact dedup
        const key = `${job.company}|||${job.role}`;
        if (existingKeys.has(key)) return false;
        // Fuzzy dedup — catches "Sr. SWE" vs "Senior Software Engineer" at same company
        const normKey = `${job.company.toLowerCase()}|||${normalizeTitle(job.role)}`;
        if (existingNormKeys.has(normKey) || seenNormKeys.has(normKey)) return false;
        // Source diversity cap
        const src = (job.source || "unknown").toLowerCase();
        if ((sourceCounts[src] || 0) >= MAX_PER_SOURCE) return false;
        seenUrls.add(job.url);
        seenNormKeys.add(normKey);
        candidateJobs.push(job);
        sourceCounts[src] = (sourceCounts[src] || 0) + 1;
        return true;
      };

      // Helper to add cached jobs — interleave sources for diversity
      const addCachedJobs = (results: Awaited<ReturnType<typeof queryScrapedJobs>>) => {
        // Group by source, then round-robin to ensure diversity
        const bySource: Record<string, typeof results> = {};
        for (const j of results) {
          const src = j.source;
          if (!bySource[src]) bySource[src] = [];
          bySource[src].push(j);
        }
        const sources = Object.keys(bySource);
        let added = true;
        let idx = 0;
        while (added) {
          added = false;
          for (const src of sources) {
            if (idx < bySource[src].length) {
              const j = bySource[src][idx];
              const desc = j.description
                ? j.description.substring(0, 500).replace(/\n+/g, " ").trim() + (j.description.length > 500 ? "..." : "")
                : "No description available.";
              const ok = addCandidate({
                company: j.company, role: j.role,
                location: j.location || (j.isRemote ? "Remote" : "Not specified"),
                salary: j.salary || "Not listed", url: j.url,
                source: displaySource(j.source),
                tags: (() => { try { return JSON.parse(j.tags); } catch { return []; } })(),
                jobDescription: desc, employmentType: j.employmentType,
              });
              if (ok) added = true;
            }
          }
          idx++;
        }
      };

      // JSearch job helper
      interface JSearchJob {
        employer_name: string; job_title: string;
        job_city?: string; job_state?: string; job_country?: string;
        job_is_remote?: boolean; job_min_salary?: number; job_max_salary?: number;
        job_salary_currency?: string; job_salary_period?: string;
        job_apply_link?: string; job_google_link?: string;
        job_description?: string; job_employment_type?: string; job_publisher?: string;
        job_highlights?: { Qualifications?: string[]; Responsibilities?: string[] };
        job_required_skills?: string[];
      }
      const detectJSearchSource = (url: string, publisher?: string) => {
        if (url.includes("linkedin.com")) return "LinkedIn";
        if (url.includes("indeed.com")) return "Indeed";
        if (url.includes("glassdoor.com")) return "Glassdoor";
        if (url.includes("greenhouse.io")) return "Greenhouse";
        if (url.includes("lever.co")) return "Lever";
        if (url.includes("ziprecruiter.com")) return "ZipRecruiter";
        if (url.includes("dice.com")) return "Dice";
        if (url.includes("builtin.com")) return "Built In";
        if (url.includes("wellfound.com")) return "Wellfound";
        if (url.includes("monster.com")) return "Monster";
        if (url.includes("simplyhired.com")) return "SimplyHired";
        if (url.includes("smartrecruiters.com")) return "SmartRecruiters";
        if (url.includes("workday")) return "Workday";
        if (publisher) return publisher;
        return "Company Website";
      };

      // ── SSE streaming response ──
      // Prevent duplicate concurrent scans
      if (activeScanState.has(user.id)) {
        const existing = activeScanState.get(user.id)!;
        // If scan started less than 3 minutes ago, it's still running
        if (Date.now() - existing.startedAt < 180_000) {
          return NextResponse.json({ error: "Scan already in progress", scanInProgress: true, scanProgress: existing }, { status: 409 });
        }
        // Stale scan — clean it up
        activeScanState.delete(user.id);
      }

      // Mark scan as active
      activeScanState.set(user.id, { percent: 0, label: "Starting scan...", startedAt: Date.now() });

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          let streamClosed = false;
          const send = (event: string, data: Record<string, unknown>) => {
            if (streamClosed) return; // Guard against writing to closed controller
            try {
              controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
            } catch { streamClosed = true; return; }
            // Update in-memory state so GET can return it on page refresh
            if (event === "progress") {
              activeScanState.set(user.id, {
                percent: (data.percent as number) || 0,
                label: (data.label as string) || "",
                startedAt: activeScanState.get(user.id)?.startedAt || Date.now(),
              });
            } else if (event === "done" || event === "error") {
              activeScanState.delete(user.id);
            }
          };

          try {
            // Step 1: Query cache
            send("progress", { step: 1, total: 5, label: "Searching job cache...", percent: 5 });
            try {
              const searchTerms = targetRoles.length > 0 ? targetRoles : [roleContext];
              for (const term of searchTerms.slice(0, 3)) {
                const cached = await queryScrapedJobs(term as string, {
                  location: locationContext, isRemote: isRemote || undefined, limit: 100, maxAgeDays: 14,
                });
                console.log(`[scan] Cache query "${term}": ${cached.length} results`);
                addCachedJobs(cached);
              }
              console.log(`[scan] ${candidateJobs.length} candidates from cache`);
              send("progress", { step: 1, total: 5, label: `Found ${candidateJobs.length} cached jobs`, percent: 15 });
            } catch (err) { console.error("[scan] Cache query failed:", err); }

            // Step 2: Crawl — adapt strategy based on JSearch availability
            const jsearchUp = isJSearchAvailable();
            const useDirectScrape = !jsearchUp; // Fallback to Playwright when JSearch is down
            const crawlTimeout = jsearchUp ? 30_000 : 60_000; // More time for Playwright
            if (!jsearchUp) {
              const status = getJSearchStatus();
              console.log(`[scan] JSearch unavailable (cooldown ${status.cooldownMinutes}min). Using direct scrapers.`);
              send("progress", { step: 2, total: 5, label: "JSearch unavailable — scraping directly...", percent: 20 });
            } else {
              send("progress", { step: 2, total: 5, label: "Searching job boards...", percent: 20 });
            }
            try {
              const searchTerms = targetRoles.length > 0 ? targetRoles : [roleContext];
              const primaryTerm = searchTerms[0] as string;
              console.log(`[scan] Crawl for "${primaryTerm}" in "${locationContext}" (jsearch=${jsearchUp}, direct=${useDirectScrape})...`);

              await Promise.race([
                crawlJobs(primaryTerm, locationContext, {
                  maxPerSource: 50, includeAts: true, includeJSearch: jsearchUp, includeDirectScrape: useDirectScrape,
                }),
                new Promise<void>((resolve) => setTimeout(resolve, crawlTimeout)),
              ]);

              send("progress", { step: 2, total: 5, label: "Collecting results...", percent: 40 });

              // Re-query cache — get fresh results from all search terms
              for (const term of searchTerms.slice(0, 3)) {
                const freshResults = await queryScrapedJobs(term as string, {
                  location: locationContext, isRemote: isRemote || undefined, limit: 200, maxAgeDays: 7,
                });
                addCachedJobs(freshResults);
              }
              console.log(`[scan] ${candidateJobs.length} candidates after crawl`);
              send("progress", { step: 2, total: 5, label: `${candidateJobs.length} candidates found`, percent: 50 });
            } catch (err) { console.error("[scan] Crawl failed:", err); }

            // Step 3: JSearch fallback (only if we don't have enough candidates AND JSearch is available)
            const JSEARCH_API_KEY = process.env.RAPIDAPI_KEY;
            if (candidateJobs.length < TARGET_JOBS && JSEARCH_API_KEY && isJSearchAvailable()) {
              send("progress", { step: 3, total: 5, label: "Searching additional job boards...", percent: 55 });
              const searchQueries = targetRoles.length > 0
                ? targetRoles.slice(0, 3).map((role: string) => `${role} in ${locationContext}`)
                : [`${roleContext} in ${locationContext}`];

              for (const query of searchQueries) {
                if (candidateJobs.length >= TARGET_JOBS * 2) break;
                try {
                  const params = new URLSearchParams({
                    query, page: "3", num_pages: "2", date_posted: "month",
                    remote_jobs_only: isRemote ? "true" : "false",
                  });
                  console.log(`[jsearch] Searching: "${query}"`);
                  const jsRes = await fetch(`https://jsearch.p.rapidapi.com/search?${params}`, {
                    headers: { "X-RapidAPI-Key": JSEARCH_API_KEY, "X-RapidAPI-Host": "jsearch.p.rapidapi.com" },
                  });
                  if (!jsRes.ok) { console.error(`[jsearch] API error ${jsRes.status}`); continue; }
                  const jsData = await jsRes.json();
                  const jobs: JSearchJob[] = jsData.data || [];
                  console.log(`[jsearch] Got ${jobs.length} results for "${query}"`);

                  for (const j of jobs) {
                    const url = j.job_apply_link || j.job_google_link;
                    if (!url || !j.employer_name || !j.job_title) continue;
                    // Only keep jobs from platforms with proven auto-apply automation
                    if (!isSupportedPlatformUrl(url)) continue;
                    let loc = "Not specified";
                    if (j.job_is_remote) {
                      loc = j.job_city ? `Remote (${j.job_city}, ${j.job_state || j.job_country || ""})`.trim() : "Remote";
                    } else if (j.job_city) { loc = [j.job_city, j.job_state, j.job_country].filter(Boolean).join(", "); }
                    let sal = "Not listed";
                    if (j.job_min_salary && j.job_max_salary) {
                      const cur = j.job_salary_currency || "USD";
                      const per = j.job_salary_period === "YEAR" ? "/yr" : j.job_salary_period === "HOUR" ? "/hr" : "";
                      sal = `${cur} $${Math.round(j.job_min_salary).toLocaleString()} - $${Math.round(j.job_max_salary).toLocaleString()}${per}`;
                    } else if (j.job_min_salary) { sal = `$${Math.round(j.job_min_salary).toLocaleString()}+`; }
                    const tags = j.job_required_skills?.slice(0, 4) ||
                      j.job_highlights?.Qualifications?.slice(0, 4).map((q: string) => q.split(/[,;]/)[0].trim().substring(0, 30)) || [];
                    const desc = j.job_description
                      ? j.job_description.substring(0, 500).replace(/\n+/g, " ").trim() + (j.job_description.length > 500 ? "..." : "")
                      : "No description available.";
                    const source = detectJSearchSource(url, j.job_publisher);
                    addCandidate({
                      company: j.employer_name, role: j.job_title, location: loc, salary: sal,
                      url, source, tags, jobDescription: desc, employmentType: j.job_employment_type || null,
                    });
                    // Save to cache
                    try {
                      await prisma.scrapedJob.upsert({
                        where: { url },
                        create: {
                          url, company: j.employer_name, role: j.job_title,
                          location: loc, salary: sal, description: j.job_description || null,
                          source: source.toLowerCase(), tags: JSON.stringify(tags),
                          employmentType: j.job_employment_type || null,
                          isRemote: j.job_is_remote || false, updatedAt: new Date(),
                        },
                        update: { active: true, updatedAt: new Date() },
                      });
                    } catch { /* ignore */ }
                  }
                } catch (err) { console.error(`[jsearch] Error for "${query}":`, err); }
              }
              console.log(`[scan] ${candidateJobs.length} candidates after JSearch`);
              send("progress", { step: 3, total: 5, label: `${candidateJobs.length} total candidates found`, percent: 65 });
            }

            if (candidateJobs.length === 0) {
              send("error", { message: "No jobs found matching your criteria. Try broadening your search preferences." });
              activeScanState.delete(user.id);
              if (!streamClosed) { try { controller.close(); } catch { /* */ } }
              streamClosed = true;
              return;
            }

            // Step 4: AI scoring (Claude) — rich context for accurate differentiation
            send("progress", { step: 4, total: 5, label: `Scoring ${candidateJobs.length} jobs with AI...`, percent: 70 });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let scoredJobs: any[] = candidateJobs;

            // Build candidate profile from resume + preferences
            const latestResume = user.resumes.length > 0
              ? user.resumes.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0]
              : null;
            const resumeSnippet = latestResume?.content
              ? latestResume.content.substring(0, 1500).replace(/\n{3,}/g, "\n\n")
              : null;

            if (anthropicClient && candidateJobs.length > 0) {
              try {
                // Score up to 30 candidates — enough to pick best 25
                const toScore = candidateJobs.slice(0, 30);
                const jobSummaries = toScore.map((j, i) => {
                  const tags = (j.tags || []).slice(0, 5).join(", ");
                  const desc = (j.jobDescription || "").substring(0, 200).replace(/\n+/g, " ").trim();
                  const empType = j.employmentType ? ` [${j.employmentType}]` : "";
                  return `${i + 1}. ${j.role} at ${j.company} | ${j.location} | ${j.salary}${empType}${tags ? ` | Skills: ${tags}` : ""}${desc ? `\n   ${desc}` : ""}`;
                }).join("\n");

                const userSkills = prefs?.skills ? (() => { try { return JSON.parse(prefs.skills); } catch { return []; } })() : [];
                const empTypes = prefs?.employmentTypes ? (() => { try { return JSON.parse(prefs.employmentTypes); } catch { return ["FULLTIME"]; } })() : ["FULLTIME"];
                const candidateProfile = [
                  `Current role: ${prefs?.currentRole || user.jobTitle || "Not specified"}`,
                  `Experience: ${user.yearsExp || "Not specified"} years`,
                  prefs?.experienceLevel ? `Seniority level: ${prefs.experienceLevel}` : "",
                  `Target roles: ${roleContext}`,
                  `Candidate's actual location: ${user.location || "Not specified"}`,
                  `Preferred locations: ${locationContext}`,
                  `Minimum salary: $${minSalary}`,
                  userSkills.length > 0 ? `Key skills: ${userSkills.join(", ")}` : "",
                  empTypes.length > 0 ? `Employment types: ${empTypes.join(", ")}` : "",
                  // Immigration context — affects which jobs are realistic
                  prefs?.needsSponsorship ? `⚠️ Needs visa sponsorship — deprioritize jobs that likely don't sponsor (small companies, contract roles)` : "",
                  prefs?.immigrationStatus ? `Immigration status: ${prefs.immigrationStatus.replace(/_/g, " ")}` : "",
                  prefs?.workAuthorization ? `Work authorization: ${prefs.workAuthorization.replace(/_/g, " ")}` : "",
                  // Career pivot context — auto-detected or manual
                  (() => {
                    const pivot = detectCareerPivot(prefs?.currentRole || user.jobTitle, targetRoles, resumeSnippet, prefs ? { isPivoting: prefs.isPivoting ?? false, pivotFromRole: prefs.pivotFromRole, pivotToRole: prefs.pivotToRole, pivotTransferableSkills: prefs.pivotTransferableSkills } : undefined);
                    if (pivot.isPivoting) return `🔄 CAREER PIVOT: Transitioning from "${pivot.fromRole}" to "${pivot.toRole}". Evaluate transferable skills generously — ${pivot.transferableSkills.join(", ")} all transfer. Prioritize transition-friendly roles (those valuing diverse backgrounds, cross-functional experience, or explicitly welcoming career changers).`;
                    return "";
                  })(),
                  resumeSnippet ? `\nResume summary:\n${resumeSnippet}` : "",
                ].filter(Boolean).join("\n");

                const matchPrompt = `You are an expert recruiter scoring job-candidate fit. Score each job realistically.

## Candidate Profile
${candidateProfile}

## Jobs to Score
${jobSummaries}

## Scoring Rules
- roleRelevance (0-100): Does the job TITLE and FUNCTION match the candidate's target roles? This is the MOST important dimension. A "Software Engineer" candidate should score 10-20 for "Account Executive", "Sales Rep", "Marketing Manager", etc. — completely different career tracks score near zero. Same job family (e.g. "Frontend Engineer" vs "Software Engineer") = 85+. Adjacent roles (e.g. "DevOps" for a "Software Engineer") = 60-75. Unrelated fields = 10-30.
- skills (0-100): How well do the job's required skills match the candidate's experience and resume?
- location (0-100): Does the job location match the candidate's ACTUAL location and preferences? Remote jobs = 90+. Same city/metro area = 85+. Same state but different city = 60-70. Different state or region entirely = 20-40. A job in Los Angeles should NOT score high for a candidate in Oakland/San Francisco — those are different metro areas (400+ miles apart).
- salary (0-100): Does the listed salary meet the minimum? "Not listed" = 50 (unknown). Below minimum = 20-40. Above = 85+.
- experience (0-100): Does the candidate's years of experience and seniority match the role level?
- matchScore: Weighted average — roleRelevance 30%, skills 25%, experience 20%, location 15%, salary 10%. Round to nearest integer.

BE DISCRIMINATING. Use the FULL range 15-98. A perfect match is rare (95+). A poor match should score 30-50. Average matches are 55-75. Good matches are 76-89. A completely irrelevant role (wrong career track entirely) should score 15-35 regardless of other factors.

Return JSON only, no other text: {"scores":[{"index":1,"matchScore":82,"matchBreakdown":{"roleRelevance":95,"skills":85,"location":90,"salary":70,"experience":80}},...]}`;
                const claudeResponse = await anthropicClient.messages.create({
                  model: "claude-sonnet-4-20250514",
                  max_tokens: 4000,
                  messages: [
                    { role: "user", content: `You are a precise job matching scorer. Return ONLY valid JSON. Be discriminating — use the full scoring range. Never give all jobs the same score.\n\n${matchPrompt}` },
                  ],
                });
                const raw = claudeResponse.content?.[0]?.type === "text" ? claudeResponse.content[0].text : "{}";
                // Extract JSON from response (Claude may wrap it in markdown code blocks)
                const jsonMatch = raw.match(/\{[\s\S]*\}/);
                const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : "{}");
                const scores = Array.isArray(parsed) ? parsed : (parsed.scores || []);
                if (Array.isArray(scores)) {
                  let scored = 0;
                  for (const score of scores) {
                    const idx = (score.index || 0) - 1;
                    if (idx >= 0 && idx < candidateJobs.length && typeof score.matchScore === "number") {
                      candidateJobs[idx].matchScore = Math.max(10, Math.min(98, score.matchScore));
                      candidateJobs[idx].matchBreakdown = score.matchBreakdown || null;
                      scored++;
                    }
                  }
                  console.log(`[scan] Claude scored ${scored}/${toScore.length} jobs`);
                }
              } catch (err) { console.error("[scan] Claude scoring failed:", err); }
            } else if (openai && candidateJobs.length > 0) {
              // Fallback to GPT if Claude is not available
              try {
                const toScore = candidateJobs.slice(0, 30);
                const jobSummaries = toScore.map((j, i) => {
                  const tags = (j.tags || []).slice(0, 5).join(", ");
                  const desc = (j.jobDescription || "").substring(0, 200).replace(/\n+/g, " ").trim();
                  const empType = j.employmentType ? ` [${j.employmentType}]` : "";
                  return `${i + 1}. ${j.role} at ${j.company} | ${j.location} | ${j.salary}${empType}${tags ? ` | Skills: ${tags}` : ""}${desc ? `\n   ${desc}` : ""}`;
                }).join("\n");
                const completion = await openai.chat.completions.create({
                  model: "gpt-4o-mini",
                  messages: [
                    { role: "system", content: "You are a precise job matching scorer. Return ONLY valid JSON." },
                    { role: "user", content: `Score these jobs for fit. Return JSON: {"scores":[{"index":1,"matchScore":82,"matchBreakdown":{"roleRelevance":95,"skills":85,"location":90,"salary":70,"experience":80}},...]}\n\nJobs:\n${jobSummaries}` },
                  ],
                  temperature: 0.4, max_tokens: 4000,
                  response_format: { type: "json_object" },
                });
                const raw = completion.choices[0]?.message?.content || "{}";
                const parsed = JSON.parse(raw);
                const scores = Array.isArray(parsed) ? parsed : (parsed.scores || []);
                if (Array.isArray(scores)) {
                  let scored = 0;
                  for (const score of scores) {
                    const idx = (score.index || 0) - 1;
                    if (idx >= 0 && idx < candidateJobs.length && typeof score.matchScore === "number") {
                      candidateJobs[idx].matchScore = Math.max(10, Math.min(98, score.matchScore));
                      candidateJobs[idx].matchBreakdown = score.matchBreakdown || null;
                      scored++;
                    }
                  }
                  console.log(`[scan] GPT scored ${scored}/${toScore.length} jobs (fallback)`);
                }
              } catch (err) { console.error("[scan] GPT scoring fallback failed:", err); }
            }
            // Fallback for unscored jobs — estimate based on basic heuristics instead of flat 75%
            for (const job of scoredJobs) {
              if (!job.matchScore || job.matchScore === 0) {
                // Simple heuristic: check if role/location roughly match preferences
                // Unmatched roles get a LOW score (35) so they fall below the MIN_MATCH_SCORE threshold
                const roleMatch = targetRoles.some((r: string) => job.role?.toLowerCase().includes(r.toLowerCase())) ? 75 : 35;
                const locMatch = job.location?.toLowerCase().includes("remote") && isRemote ? 85
                  : locations.some((l: string) => job.location?.toLowerCase().includes(l.toLowerCase())) ? 80 : 50;
                job.matchScore = Math.round(roleMatch * 0.6 + locMatch * 0.4);
              }
              if (!job.matchBreakdown) {
                job.matchBreakdown = null; // Don't fake breakdown data — show "no breakdown" in UI
              }
            }
            send("progress", { step: 4, total: 5, label: "AI scoring complete", percent: 85 });

            // Step 5: Save to database
            send("progress", { step: 5, total: 5, label: "Saving top matches...", percent: 90 });
            scoredJobs.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));
            // Filter out low-scoring jobs — don't save irrelevant roles (e.g. Account Executive for a Software Engineer)
            const MIN_MATCH_SCORE = 50;
            const qualifiedJobs = scoredJobs.filter(j => (j.matchScore || 0) >= MIN_MATCH_SCORE);
            const droppedCount = scoredJobs.length - qualifiedJobs.length;
            if (droppedCount > 0) console.log(`[scan] Dropped ${droppedCount} jobs below ${MIN_MATCH_SCORE} match score`);
            const topJobs = qualifiedJobs.slice(0, TARGET_JOBS);
            const savedJobs = [];
            let skippedDupes = 0;
            for (const job of topJobs) {
              const key = `${job.company}|||${job.role}`;
              if (existingKeys.has(key)) { skippedDupes++; continue; }
              existingKeys.add(key);
              const saved = await prisma.jobApplication.create({
                data: {
                  userId: user.id, company: job.company, role: job.role,
                  location: job.location || null, salary: job.salary || null,
                  matchScore: job.matchScore || 75, status: "matched", url: job.url,
                  tags: JSON.stringify(job.tags || []), source: job.source || "Scraped",
                  matchBreakdown: job.matchBreakdown ? JSON.stringify(job.matchBreakdown) : null,
                  jobDescription: job.jobDescription || null,
                },
              });
              savedJobs.push(saved);
            }

            // Update credits
            if (user.preferences) {
              const newCredits = Math.max(0, currentCredits - 1);
              const updateData: Record<string, unknown> = { lastScannedAt: new Date(), scanCredits: newCredits };
              if (newCredits <= 0) updateData.autoScanActive = false;
              await prisma.userPreferences.update({ where: { userId: user.id }, data: updateData });
            }
            if (savedJobs.length > 0) {
              await prisma.notification.create({
                data: {
                  userId: user.id, type: "new_matches",
                  title: `${savedJobs.length} new job match${savedJobs.length > 1 ? "es" : ""} found`,
                  message: `Found ${savedJobs.length} verified job postings matching your profile.${skippedDupes > 0 ? ` ${skippedDupes} duplicate${skippedDupes > 1 ? "s" : ""} filtered.` : ""}`,
                  metadata: JSON.stringify({ count: savedJobs.length, skippedDupes }),
                },
              });
              // High-match alert for 90%+ jobs
              const highMatches = savedJobs.filter((j) => (j.matchScore || 0) >= 90);
              if (highMatches.length > 0) {
                const topJob = highMatches[0];
                await prisma.notification.create({
                  data: {
                    userId: user.id, type: "new_matches",
                    title: `Excellent match: ${topJob.role} at ${topJob.company}`,
                    message: `${highMatches.length} job${highMatches.length > 1 ? "s" : ""} scored 90%+ match. ${topJob.role} at ${topJob.company} is a top pick!`,
                    metadata: JSON.stringify({ jobId: topJob.id, score: topJob.matchScore }),
                  },
                });

                // Send email notification for high-match jobs
                try {
                  const { sendHighMatchEmail } = await import("@/lib/notifications/email");
                  await sendHighMatchEmail({
                    to: user.email,
                    subject: `🎯 ${highMatches.length} High-Match Job${highMatches.length > 1 ? "s" : ""} Found!`,
                    userName: user.firstName || undefined,
                    jobs: highMatches.map((j) => ({
                      role: j.role,
                      company: j.company,
                      location: j.location || undefined,
                      salary: j.salary || undefined,
                      matchScore: j.matchScore || 0,
                      url: j.url || undefined,
                    })),
                  });
                } catch (emailErr) {
                  console.error("[scan] Email notification failed:", emailErr);
                }
              }
            }

            console.log(`[scan] Saved ${savedJobs.length} jobs, skipped ${skippedDupes} dupes`);
            send("progress", { step: 5, total: 5, label: `Done! ${savedJobs.length} new matches saved`, percent: 100 });
            send("done", { count: savedJobs.length, skippedDupes });
          } catch (err) {
            console.error("[scan] Fatal error:", err);
            send("error", { message: "Scan failed unexpectedly. Please try again." });
          }
          // Safety cleanup — ensure scan state is always cleared
          activeScanState.delete(user.id);
          if (!streamClosed) { try { controller.close(); } catch { /* already closed */ } }
          streamClosed = true;
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    }

    // ── PREPARE — Tailor resume + generate cover letter ──
    if (action === "prepare") {
      if (!openai) {
        return NextResponse.json({ error: "AI not configured" }, { status: 500 });
      }

      const { jobId } = body;
      const job = await prisma.jobApplication.findUnique({ where: { id: jobId } });
      if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

      // Guard: Block preparing jobs with very low match scores
      const PREPARE_MIN_SCORE = 40;
      if (job.matchScore && job.matchScore < PREPARE_MIN_SCORE) {
        return NextResponse.json({
          error: `Match score too low (${job.matchScore}%). "${job.role}" doesn't match your profile. Skip this job or adjust your target roles.`,
        }, { status: 400 });
      }

      const resume = user.resumes.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
      const resumeText = resume?.content || `${user.firstName || ""} ${user.lastName || ""}\n${user.jobTitle || ""}\n${user.yearsExp || ""} years experience`;

      // Build context for career pivot (auto-detected or manual) and immigration
      const prefs = user.preferences;
      const resumeSnippetForPivot = resume?.content ? resume.content.substring(0, 1500) : null;
      const userTargetRoles = prefs ? (() => { try { return JSON.parse(prefs.targetRoles || "[]"); } catch { return []; } })() : [];
      const pivot = detectCareerPivot(
        prefs?.currentRole || user.jobTitle,
        userTargetRoles.length > 0 ? userTargetRoles : [job.role],
        resumeSnippetForPivot,
        prefs ? { isPivoting: prefs.isPivoting ?? false, pivotFromRole: prefs.pivotFromRole, pivotToRole: prefs.pivotToRole, pivotTransferableSkills: prefs.pivotTransferableSkills } : undefined,
      );
      const pivotContext = pivot.isPivoting
        ? `\n\n⚠️ CAREER PIVOT: This candidate is transitioning from "${pivot.fromRole}" to "${pivot.toRole}".
Transferable skills: ${pivot.transferableSkills.join(", ")}
IMPORTANT: Reframe their experience to highlight transferable skills. Use language from the target role. Don't hide their background — position it as a strength (e.g., "Brings unique cross-functional perspective from ${pivot.fromRole} into ${pivot.toRole}").`
        : "";
      const immigrationContext = prefs?.needsSponsorship
        ? `\nNote: Candidate needs visa sponsorship. Do NOT mention immigration status in the resume or cover letter.`
        : "";

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are an expert career coach and resume writer. Given a job description and a candidate's resume, produce:
1. A tailored version of the resume that emphasizes relevant experience, uses keywords from the JD, and is optimized for ATS systems
2. A professional cover letter (3-4 paragraphs) addressed to the hiring team at the specific company${pivotContext}${immigrationContext}

Return ONLY a JSON object with two keys:
- "tailoredResume": the optimized resume text (keep formatting clean with sections)
- "coverLetter": the cover letter text
No markdown wrapping.`,
          },
          {
            role: "user",
            content: `Job: ${job.role} at ${job.company}\nLocation: ${job.location || "Not specified"}\nSalary: ${job.salary || "Not specified"}\n\nJob Description:\n${job.jobDescription || "No description available"}\n\nCandidate Resume:\n${resumeText}`,
          },
        ],
        temperature: 0.6,
        max_tokens: 3000,
        response_format: { type: "json_object" },
      });

      const result = completion.choices[0]?.message?.content || "{}";
      let parsed;
      try {
        parsed = JSON.parse(result);
      } catch {
        return NextResponse.json({ error: "Failed to generate application package" }, { status: 500 });
      }

      await prisma.jobApplication.update({
        where: { id: jobId },
        data: {
          tailoredResume: parsed.tailoredResume || null,
          generatedCoverLetter: parsed.coverLetter || null,
          status: "ready",
        },
      });

      return NextResponse.json({ success: true });
    }

    // ── AUTO-APPLY — Use Playwright to fill application forms ──
    if (action === "autoApply") {
      const { jobId } = body;
      const job = await prisma.jobApplication.findUnique({ where: { id: jobId } });
      if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
      if (!job.url) return NextResponse.json({ error: "No URL for this job" }, { status: 400 });
      if (!job.tailoredResume) return NextResponse.json({ error: "Prepare the job first to generate a tailored resume" }, { status: 400 });

      // Guard: Don't apply to jobs with very low match scores — they're likely irrelevant roles
      const AUTO_APPLY_MIN_SCORE = 50;
      if (job.matchScore && job.matchScore < AUTO_APPLY_MIN_SCORE) {
        return NextResponse.json({
          error: `Match score too low (${job.matchScore}%). This job doesn't match your profile well enough for auto-apply. Minimum required: ${AUTO_APPLY_MIN_SCORE}%.`,
        }, { status: 400 });
      }

      const { autoApply: runAutoApply, detectPlatform, generateProxyEmail } = await import("@/lib/auto-apply");
      const platform = detectPlatform(job.url);

      // Generate tracking tag for internal email-to-job linking (NOT sent to job sites)
      const trackingTag = generateProxyEmail(user.email, job.company, job.role);

      // Build LinkedIn cookies path if user has exported cookies
      const linkedInCookiesPath = process.env.LINKEDIN_COOKIES_PATH || undefined;

      // Extract resume PDF from DB and write to temp file for Playwright upload
      let resumeFilePath = process.env.RESUME_PDF_PATH || undefined;
      if (!resumeFilePath) {
        try {
          const latestResume = await prisma.resume.findFirst({
            where: { userId: user.id, pdfData: { not: null } },
            orderBy: { createdAt: "desc" },
            select: { pdfData: true, pdfMimeType: true, name: true },
          });
          if (latestResume?.pdfData) {
            const fs = require("fs");
            const path = require("path");
            const os = require("os");
            const tmpDir = path.join(os.tmpdir(), "auto-apply-resumes");
            if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
            const ext = latestResume.pdfMimeType === "application/pdf" ? ".pdf" : ".pdf";
            const tmpFile = path.join(tmpDir, `${user.id}-resume${ext}`);
            fs.writeFileSync(tmpFile, Buffer.from(latestResume.pdfData, "base64"));
            resumeFilePath = tmpFile;
            console.log(`[AutoApply] Extracted resume PDF from DB: ${tmpFile}`);
          }
        } catch (resumeErr) {
          console.error("[AutoApply] Failed to extract resume from DB:", resumeErr);
        }
      }

      // Proactively ensure Gmail access is available for verification code retrieval
      // If user signed in with Google via Clerk and Gmail scopes are configured,
      // this grabs the token and saves it — zero extra steps for the user.
      try {
        const { autoConnectGmailFromClerk } = await import("@/lib/email/gmail");
        await autoConnectGmailFromClerk(clerkId, user.id, user.email);
      } catch (gmailErr) {
        console.log("[AutoApply] Gmail auto-connect skipped:", (gmailErr as Error).message?.slice(0, 60));
      }

      // Use the user's ORIGINAL email on the application form
      // Job sites must not know this is an automated application
      const aiAgentEnabled = !!resolvedAIClient;
      console.log(`[AutoApply] Starting auto-apply for ${job.company} — ${job.role}`);
      console.log(`[AutoApply] AI Agent: ${aiAgentEnabled ? `ENABLED (${resolvedAIClient?.provider})` : "DISABLED (no ANTHROPIC_API_KEY or OPENAI_API_KEY)"}`);
      console.log(`[AutoApply] Resume file: ${resumeFilePath || "NONE"}`);
      console.log(`[AutoApply] User email: ${user.email}, dbUserId: ${user.id}`);
      const applyContext = {
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        email: user.email,
        phone: user.phone || "",
        linkedIn: user.linkedIn || "",
        location: user.location || "",
        resumeText: job.tailoredResume,
        coverLetterText: job.generatedCoverLetter || "",
        currentTitle: user.jobTitle || "",
        yearsExp: user.yearsExp || "",
        needsSponsorship: user.preferences?.needsSponsorship ?? false,
        linkedInCookiesPath,
        resumeFilePath,
        clerkId,
        jobTitle: job.role,
        company: job.company,
      };
      const aiOpts = resolvedAIClient ? {
        aiClient: resolvedAIClient,
        openai: resolvedAIClient.provider === "openai" ? resolvedAIClient.client : undefined,
        dbUserId: user.id,
        jobTitle: job.role,
        company: job.company,
      } : undefined;

      let result = await runAutoApply(job.url, applyContext, aiOpts);

      // Retry once if failed — gives a second chance for transient failures
      if (!result.success && !result.message?.includes("timed out")) {
        console.log(`[AutoApply] First attempt failed for ${job.company}, retrying once...`);
        result = await runAutoApply(job.url, applyContext, aiOpts);
        if (result.success) {
          console.log(`[AutoApply] Retry succeeded for ${job.company}`);
        }
      }

      // Store proof of application in the notes field
      const proofLog = [
        `Auto-apply attempt: ${new Date().toISOString()}`,
        `Platform: ${platform}`,
        `Email used: ${user.email}`,
        `Result: ${result.success ? "SUCCESS" : "FAILED"}`,
        `Message: ${result.message}`,
        `Confirmation: ${result.confirmationDetected ? `YES — ${result.confirmationText}` : "Not detected"}`,
        ...(result.stepsCompleted || []).map((s, i) => `  Step ${i + 1}: ${s}`),
      ].join("\n");

      // Save screenshot proof to disk for later viewing
      if (result.screenshotSteps?.length) {
        try {
          const fs = require("fs");
          const path = require("path");
          const proofDir = path.join(process.cwd(), ".proof-screenshots");
          if (!fs.existsSync(proofDir)) fs.mkdirSync(proofDir, { recursive: true });
          const proofFile = path.join(proofDir, `${jobId}.json`);
          fs.writeFileSync(proofFile, JSON.stringify({
            jobId,
            company: job.company,
            role: job.role,
            url: job.url,
            platform,
            appliedAt: new Date().toISOString(),
            email: user.email,
            steps: result.stepsCompleted || [],
            screenshots: result.screenshotSteps.map(s => ({ step: s.step, screenshot: s.screenshot })),
          }));
          console.log(`[AutoApply] Saved ${result.screenshotSteps.length} proof screenshots for ${job.company}`);
        } catch (proofErr) {
          console.error("[AutoApply] Failed to save proof screenshots:", proofErr);
        }
      }

      if (result.success) {
        const screenshotCount = result.screenshotSteps?.length || 0;
        // Stricter validation: for AI agent, require confirmation detection to mark as "applied"
        // If agent says success but no confirmation page was detected, mark as "pending_review"
        const isVerifiedSuccess = result.confirmationDetected || result.platform !== "ai-agent";
        const finalStatus = isVerifiedSuccess ? "applied" : "pending_review";
        if (!isVerifiedSuccess) {
          console.log(`[AutoApply] AI agent reported success but no confirmation detected for ${job.company} — marking as pending_review`);
        }
        await prisma.jobApplication.update({
          where: { id: jobId },
          data: {
            status: finalStatus,
            appliedAt: new Date(),
            notes: proofLog + (screenshotCount > 0 ? `\n📸 ${screenshotCount} proof screenshots saved` : "") + (!isVerifiedSuccess ? "\n⚠️ No confirmation page detected — needs manual verification" : ""),
            proxyEmail: trackingTag,
          },
        });

        // Send application confirmation email to the user
        try {
          const { sendApplicationConfirmationEmail } = await import("@/lib/notifications/email");
          await sendApplicationConfirmationEmail({
            to: user.email,
            userName: user.firstName || undefined,
            role: job.role,
            company: job.company,
            platform,
            proxyEmail: trackingTag,
            confirmationDetected: result.confirmationDetected || false,
            confirmationText: result.confirmationText || undefined,
            url: job.url || undefined,
            stepsCompleted: result.stepsCompleted,
          });
        } catch (emailErr) {
          console.error("[AutoApply] Failed to send confirmation email:", emailErr);
        }

        // Trigger background Gmail sync to pick up confirmation/verification emails
        // This links ATS emails to the job application automatically
        try {
          const { syncGmailInbox } = await import("@/lib/email/gmail");
          // Delay slightly to allow confirmation emails to arrive
          setTimeout(async () => {
            try {
              const syncResult = await syncGmailInbox(user.id);
              console.log(`[AutoApply] Post-apply Gmail sync: ${syncResult.synced} synced, ${syncResult.linked} linked`);
            } catch (syncErr) {
              console.log(`[AutoApply] Post-apply Gmail sync failed: ${(syncErr as Error).message?.slice(0, 60)}`);
            }
          }, 15000); // 15s delay for emails to arrive
        } catch { /* Gmail not connected — skip */ }
      } else {
        // Store failed attempt proof too
        await prisma.jobApplication.update({
          where: { id: jobId },
          data: { notes: proofLog },
        });
      }

      // Count fields completed from steps
      const fieldsCompleted = (result.stepsCompleted || []).filter((s: string) =>
        s.startsWith("Filled") || s.startsWith("Set ") || s.startsWith("Selected") || s.startsWith("Answered") || s.startsWith("Uploaded")
      ).length;

      // Detect method used
      const method = result.platform === "ai-agent" ? "ai-agent"
        : (result.message?.includes("via API") || result.confirmationText?.includes("via")) ? "api"
        : "browser";

      const isVerifiedSuccess = result.success && (result.confirmationDetected || result.platform !== "ai-agent");
      return NextResponse.json({
        success: result.success,
        verifiedSuccess: isVerifiedSuccess,
        platform: result.platform || platform,
        method,
        message: result.message + (!result.success ? "" : isVerifiedSuccess ? "" : " (⚠️ No confirmation page detected — may need manual verification)"),
        emailUsed: user.email,
        trackingTag,
        confirmationDetected: result.confirmationDetected || false,
        confirmationText: result.confirmationText || "",
        fieldsCompleted,
        iterationsUsed: (result as any).iterationsUsed || null,
        screenshot: result.screenshotBase64 ? `data:image/png;base64,${result.screenshotBase64}` : null,
        stepsCompleted: result.stepsCompleted || [],
        screenshotSteps: (result.screenshotSteps || []).map((s) => ({
          step: s.step,
          screenshot: `data:image/png;base64,${s.screenshot}`,
        })),
      });
    }

    // ── APPLY — Mark as applied ──
    if (action === "apply") {
      const { jobId } = body;
      await prisma.jobApplication.update({
        where: { id: jobId },
        data: { status: "applied", appliedAt: new Date() },
      });
      return NextResponse.json({ success: true });
    }

    // ── BATCH AUTO-APPLY — Apply all ready jobs via Playwright ──
    if (action === "bulkApply") {
      const readyJobs = await prisma.jobApplication.findMany({
        where: { userId: user.id, status: "ready" },
      });

      if (readyJobs.length === 0) {
        return NextResponse.json({ success: true, count: 0, message: "No ready jobs to apply to." });
      }

      const { batchAutoApply, generateProxyEmail } = await import("@/lib/auto-apply");
      const linkedInCookiesPath = process.env.LINKEDIN_COOKIES_PATH || undefined;
      const resumeFilePath = process.env.RESUME_PDF_PATH || undefined;

      // Filter to jobs that have URLs, tailored resumes, and adequate match scores
      const BULK_MIN_SCORE = 50;
      const applyableJobs = readyJobs.filter((j) => j.url && j.tailoredResume && (!j.matchScore || j.matchScore >= BULK_MIN_SCORE));
      const skippedCount = readyJobs.length - applyableJobs.length;
      if (skippedCount > 0) console.log(`[bulkApply] Skipped ${skippedCount} jobs (missing URL/resume or match score < ${BULK_MIN_SCORE})`);

      // User's ORIGINAL email is used on all forms (no proxy emails to job sites)
      const batchResult = await batchAutoApply(
        applyableJobs.map((j) => ({ id: j.id, url: j.url!, company: j.company, role: j.role })),
        {
          firstName: user.firstName || "",
          lastName: user.lastName || "",
          email: user.email,
          phone: "",
          linkedIn: user.linkedIn || "",
          resumeText: "",
          coverLetterText: "",
          currentTitle: user.jobTitle || "",
          yearsExp: user.yearsExp || "",
          needsSponsorship: user.preferences?.needsSponsorship ?? false,
          linkedInCookiesPath,
          resumeFilePath,
        },
      );

      // Update each job based on result
      for (const r of batchResult.results) {
        // Generate tracking tag for internal email-to-job linking (NOT sent to job sites)
        const trackingTag = generateProxyEmail(user.email, r.company, r.role);
        const proofLog = [
          `Batch auto-apply: ${new Date().toISOString()}`,
          `Platform: ${r.result.platform}`,
          `Email used: ${user.email}`,
          `Result: ${r.result.success ? "SUCCESS" : "FAILED"}`,
          `Confirmation: ${r.result.confirmationDetected ? `YES — ${r.result.confirmationText}` : "Not detected"}`,
          ...(r.result.stepsCompleted || []).map((s, i) => `  Step ${i + 1}: ${s}`),
        ].join("\n");

        if (r.result.success) {
          await prisma.jobApplication.update({
            where: { id: r.jobId },
            data: { status: "applied", appliedAt: new Date(), notes: proofLog, proxyEmail: trackingTag },
          });
        } else {
          await prisma.jobApplication.update({
            where: { id: r.jobId },
            data: { notes: proofLog },
          });
        }
      }

      if (batchResult.succeeded > 0) {
        await prisma.notification.create({
          data: {
            userId: user.id,
            type: "status_change",
            title: `Batch applied to ${batchResult.succeeded} job${batchResult.succeeded > 1 ? "s" : ""}`,
            message: `${batchResult.succeeded} succeeded, ${batchResult.failed} failed${skippedCount > 0 ? `, ${skippedCount} skipped (no URL/resume)` : ""}.`,
          },
        });
      }

      return NextResponse.json({
        success: true,
        total: batchResult.total,
        succeeded: batchResult.succeeded,
        failed: batchResult.failed,
        skipped: skippedCount,
        results: batchResult.results.map((r) => ({
          jobId: r.jobId,
          company: r.company,
          role: r.role,
          success: r.result.success,
          platform: r.result.platform,
          message: r.result.message,
          confirmationDetected: r.result.confirmationDetected || false,
        })),
      });
    }

    // ── SKIP ──
    if (action === "skip") {
      const { jobId } = body;
      await prisma.jobApplication.update({
        where: { id: jobId },
        data: { status: "skipped" },
      });
      return NextResponse.json({ success: true });
    }

    // ── UPDATE STATUS — Application tracking pipeline ──
    if (action === "updateStatus") {
      const { jobId, status } = body;
      const validStatuses = ["matched", "ready", "applied", "phone_screen", "interview", "offer", "rejected", "skipped", "expired"];
      if (!validStatuses.includes(status)) {
        return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      }
      const job = await prisma.jobApplication.update({
        where: { id: jobId },
        data: { status },
      });
      await prisma.notification.create({
        data: {
          userId: user.id,
          type: "status_change",
          title: `${job.company} — ${status.replace("_", " ")}`,
          message: `Your application for ${job.role} at ${job.company} moved to "${status.replace("_", " ")}".`,
        },
      });
      return NextResponse.json({ success: true });
    }

    // ── UPDATE PACKAGE — Save user edits ──
    if (action === "updatePackage") {
      const { jobId, tailoredResume, coverLetter } = body;
      await prisma.jobApplication.update({
        where: { id: jobId },
        data: {
          tailoredResume: tailoredResume ?? undefined,
          generatedCoverLetter: coverLetter ?? undefined,
        },
      });
      return NextResponse.json({ success: true });
    }

    // ── GET PACKAGE ──
    if (action === "getPackage") {
      const { jobId } = body;
      const job = await prisma.jobApplication.findUnique({ where: { id: jobId } });
      if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
      return NextResponse.json({
        jobDescription: job.jobDescription,
        tailoredResume: job.tailoredResume,
        coverLetter: job.generatedCoverLetter,
        company: job.company,
        role: job.role,
      });
    }

    // ── DELETE JOB — Remove a single job match ──
    if (action === "deleteJob") {
      const { jobId } = body;
      await prisma.jobApplication.delete({ where: { id: jobId } });
      return NextResponse.json({ success: true });
    }

    // ── ADD JOB — Manually add a job ──
    if (action === "addJob") {
      const { company, role, url, location, salary, source } = body;
      if (!company || !role) {
        return NextResponse.json({ error: "Company and role are required" }, { status: 400 });
      }
      const job = await prisma.jobApplication.create({
        data: {
          userId: user.id,
          company,
          role,
          url: url || null,
          location: location || null,
          salary: salary || null,
          source: source || "Manual",
          status: "matched",
          matchScore: 0,
          tags: "[]",
        },
      });
      return NextResponse.json({ success: true, jobId: job.id });
    }

    // ── CLEAR ALL JOBS — Remove all job matches for this user ──
    if (action === "clearAllJobs") {
      const result = await prisma.jobApplication.deleteMany({ where: { userId: user.id } });
      return NextResponse.json({ success: true, deleted: result.count });
    }

    // ── ADD CREDITS — Add scan credits to user's account ──
    if (action === "addCredits") {
      const { amount } = body;
      const credits = Math.max(1, Math.min(amount || 10, 500));
      if (user.preferences) {
        const updated = await prisma.userPreferences.update({
          where: { userId: user.id },
          data: { scanCredits: { increment: credits } },
        });
        return NextResponse.json({ success: true, scanCredits: updated.scanCredits });
      }
      return NextResponse.json({ error: "No preferences found" }, { status: 404 });
    }

    // ── VALIDATE EXISTING URLS — Check all job URLs and delete broken ones ──
    if (action === "validateExistingUrls") {
      const allJobs = await prisma.jobApplication.findMany({
        where: { userId: user.id, url: { not: null } },
        select: { id: true, url: true },
      });
      if (allJobs.length === 0) {
        return NextResponse.json({ success: true, checked: 0, deleted: 0 });
      }

      const urls = allJobs.map((j) => j.url as string);
      console.log(`[validateExistingUrls] Checking ${urls.length} URLs...`);
      const validSet = await validateUrls(urls);
      console.log(`[validateExistingUrls] ${validSet.size}/${urls.length} are reachable`);

      const brokenJobIds = allJobs
        .filter((j) => !validSet.has(j.url as string))
        .map((j) => j.id);

      if (brokenJobIds.length > 0) {
        await prisma.jobApplication.updateMany({
          where: { id: { in: brokenJobIds } },
          data: { status: "expired" },
        });
      }

      return NextResponse.json({
        success: true,
        checked: allJobs.length,
        valid: validSet.size,
        expired: brokenJobIds.length,
      });
    }

    // ── RESET EXPIRED — Fix incorrectly expired jobs back to matched ──
    if (action === "resetExpired") {
      const result = await prisma.jobApplication.updateMany({
        where: { userId: user.id, status: "expired" },
        data: { status: "matched" },
      });
      return NextResponse.json({ success: true, reset: result.count });
    }

    // ── MARK NOTIFICATIONS READ ──
    if (action === "markNotificationsRead") {
      await prisma.notification.updateMany({
        where: { userId: user.id, read: false },
        data: { read: true },
      });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("Auto-apply POST error:", error);
    return NextResponse.json({ error: "Failed to process request" }, { status: 500 });
  }
}

function getRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr > 1 ? "s" : ""} ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
}
