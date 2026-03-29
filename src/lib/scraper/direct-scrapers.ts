// Direct scrapers for major job boards using headless browser (Playwright)
// These boards block simple HTTP requests, so we need full JS rendering

import * as cheerio from "cheerio";
import { scrapePage } from "./browser";
import type { ParsedJob } from "./parsers";

// ── LinkedIn Jobs (public search — no login required for search results) ──
export async function scrapeLinkedInJobs(
  query: string,
  location: string,
  maxResults = 50,
): Promise<ParsedJob[]> {
  const jobs: ParsedJob[] = [];

  try {
    // LinkedIn public job search URL (no login needed)
    const encodedQuery = encodeURIComponent(query);
    const encodedLocation = encodeURIComponent(location);
    const isRemote = location.toLowerCase().includes("remote");

    // Scrape multiple pages
    for (let start = 0; start < maxResults; start += 25) {
      const url = `https://www.linkedin.com/jobs/search/?keywords=${encodedQuery}&location=${encodedLocation}&f_TPR=r604800${isRemote ? "&f_WT=2" : ""}&start=${start}`;

      console.log(`[linkedin] Scraping page ${Math.floor(start / 25) + 1}...`);
      const result = await scrapePage(url, {
        waitSelector: ".base-search-card, .jobs-search__results-list",
        waitMs: 5000,
        scrollToBottom: true,
        timeoutMs: 25000,
      });

      if (!result?.html) {
        console.log(`[linkedin] No HTML at offset ${start}, stopping`);
        break;
      }

      console.log(`[linkedin] Got ${result.html.length} bytes, URL: ${result.url.substring(0, 80)}`);

      const $ = cheerio.load(result.html);
      const cards = $(".base-search-card, .base-card, .job-search-card");

      if (cards.length === 0) {
        // Check if we hit a login wall or captcha
        const title = $("title").text();
        console.log(`[linkedin] No job cards at offset ${start}, page title: "${title.substring(0, 60)}"`);
        if (title.includes("Log In") || title.includes("Sign In") || result.html.includes("authwall")) {
          console.log(`[linkedin] Hit login wall, stopping`);
        }
        break;
      }

      cards.each((_, el) => {
        const $el = $(el);
        const title = $el.find(".base-search-card__title, h3").text().trim();
        const company = $el.find(".base-search-card__subtitle, h4").text().trim();
        const loc = $el.find(".job-search-card__location").text().trim();
        const link = $el.find("a.base-card__full-link, a").attr("href");
        const dateText = $el.find("time").attr("datetime");

        if (!title || !company || !link) return;

        // Clean up LinkedIn URL
        const cleanUrl = link.split("?")[0];

        jobs.push({
          url: cleanUrl.startsWith("http") ? cleanUrl : `https://www.linkedin.com${cleanUrl}`,
          company,
          role: title,
          location: loc || location,
          salary: null,
          description: null,
          source: "linkedin",
          tags: [],
          employmentType: null,
          isRemote: isRemote || loc.toLowerCase().includes("remote"),
          postedAt: dateText ? new Date(dateText) : null,
        });
      });

      console.log(`[linkedin] Found ${cards.length} jobs on page ${Math.floor(start / 25) + 1}`);

      // Small delay between pages
      await new Promise((r) => setTimeout(r, 1500));
    }
  } catch (err) {
    console.error(`[linkedin] Scrape error:`, (err as Error).message);
  }

  console.log(`[linkedin] Total: ${jobs.length} jobs scraped`);
  return jobs;
}

// ── Indeed Jobs ──
export async function scrapeIndeedJobs(
  query: string,
  location: string,
  maxResults = 50,
): Promise<ParsedJob[]> {
  const jobs: ParsedJob[] = [];

  try {
    const encodedQuery = encodeURIComponent(query);
    const encodedLocation = encodeURIComponent(location);
    const isRemote = location.toLowerCase().includes("remote");

    for (let start = 0; start < maxResults; start += 15) {
      const url = `https://www.indeed.com/jobs?q=${encodedQuery}&l=${encodedLocation}${isRemote ? "&remotejob=032b3046-06a3-4876-8dfd-474eb5e7ed11" : ""}&start=${start}&fromage=7`;

      console.log(`[indeed] Scraping page ${Math.floor(start / 15) + 1}...`);
      const result = await scrapePage(url, {
        waitSelector: "#mosaic-jobResults, .jobsearch-ResultsList",
        waitMs: 3000,
        timeoutMs: 20000,
      });

      if (!result?.html) break;

      const $ = cheerio.load(result.html);
      const cards = $(".job_seen_beacon, .jobsearch-ResultsList > li, .result");

      if (cards.length === 0) {
        console.log(`[indeed] No job cards found at offset ${start}`);
        break;
      }

      cards.each((_, el) => {
        const $el = $(el);
        const title = $el.find("h2.jobTitle span, .jobTitle a, a[data-jk]").text().trim();
        const company = $el.find("[data-testid='company-name'], .companyName, .company").text().trim();
        const loc = $el.find("[data-testid='text-location'], .companyLocation, .location").text().trim();
        const salary = $el.find(".salary-snippet-container, .estimated-salary, .metadata .attribute_snippet").text().trim();
        const jobId = $el.find("a[data-jk]").attr("data-jk") || $el.find("a[id^='job_']").attr("id")?.replace("job_", "");
        const snippet = $el.find(".job-snippet, .underShelfFooter").text().trim();

        if (!title || !company) return;

        const jobUrl = jobId
          ? `https://www.indeed.com/viewjob?jk=${jobId}`
          : `https://www.indeed.com/jobs?q=${encodedQuery}&vjk=${title.replace(/\s+/g, "+")}`;

        jobs.push({
          url: jobUrl,
          company,
          role: title,
          location: loc || location,
          salary: salary || null,
          description: snippet || null,
          source: "indeed",
          tags: [],
          employmentType: null,
          isRemote: isRemote || loc.toLowerCase().includes("remote"),
          postedAt: null,
        });
      });

      console.log(`[indeed] Found ${cards.length} jobs on page ${Math.floor(start / 15) + 1}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  } catch (err) {
    console.error(`[indeed] Scrape error:`, (err as Error).message);
  }

  console.log(`[indeed] Total: ${jobs.length} jobs scraped`);
  return jobs;
}

// ── Glassdoor Jobs ──
export async function scrapeGlassdoorJobs(
  query: string,
  location: string,
  maxResults = 30,
): Promise<ParsedJob[]> {
  const jobs: ParsedJob[] = [];

  try {
    const encodedQuery = encodeURIComponent(query);
    const isRemote = location.toLowerCase().includes("remote");

    const url = `https://www.glassdoor.com/Job/jobs.htm?sc.keyword=${encodedQuery}${isRemote ? "&remoteWorkType=1" : ""}&fromAge=7`;

    console.log(`[glassdoor] Scraping...`);
    const result = await scrapePage(url, {
      waitSelector: "[data-test='jobListing'], .JobsList_jobListItem__wjTHv, .react-job-listing",
      waitMs: 4000,
      scrollToBottom: true,
      timeoutMs: 25000,
    });

    if (!result?.html) {
      console.log(`[glassdoor] No HTML returned`);
      return jobs;
    }

    console.log(`[glassdoor] Got ${result.html.length} bytes, URL: ${result.url.substring(0, 80)}`);

    const $ = cheerio.load(result.html);

    // Try multiple selector strategies — Glassdoor changes their DOM frequently
    let cards = $("[data-test='jobListing']");
    if (cards.length === 0) cards = $(".JobsList_jobListItem__wjTHv");
    if (cards.length === 0) cards = $(".react-job-listing");
    if (cards.length === 0) cards = $("li[data-id]");
    if (cards.length === 0) cards = $("li[data-jobid]");
    if (cards.length === 0) cards = $(".jobCard");

    if (cards.length === 0) {
      const title = $("title").text();
      console.log(`[glassdoor] No cards found, page title: "${title.substring(0, 60)}"`);
    }

    cards.each((_, el) => {
      if (jobs.length >= maxResults) return;
      const $el = $(el);
      const title = $el.find("[data-test='job-title'], .JobCard_jobTitle__GLyJ1, .job-title, a[data-test='job-link']").text().trim();
      const company = $el.find("[data-test='emp-name'], .EmployerProfile_compactEmployerName__LE242, .job-search-key-l2hmjp, .employer-name").text().trim();
      const loc = $el.find("[data-test='emp-location'], .JobCard_location__N_iYE, .location, .job-location").text().trim();
      const salary = $el.find("[data-test='detailSalary'], .JobCard_salaryEstimate__arV5J, .salary-estimate").text().trim();
      const link = $el.find("a[href*='/job-listing/'], a[href*='/partner/'], a[href*='/job/']").attr("href");

      if (!title || !company) return;

      const jobUrl = link
        ? (link.startsWith("http") ? link : `https://www.glassdoor.com${link}`)
        : `https://www.glassdoor.com/Job/${encodedQuery}-jobs-SRCH_KO0,${query.length}.htm`;

      jobs.push({
        url: jobUrl,
        company: company.replace(/\d+\.\d+★?$/, "").trim(),
        role: title,
        location: loc || location,
        salary: salary || null,
        description: null,
        source: "glassdoor",
        tags: [],
        employmentType: null,
        isRemote: isRemote || loc.toLowerCase().includes("remote"),
        postedAt: null,
      });
    });

    console.log(`[glassdoor] Found ${jobs.length} jobs`);
  } catch (err) {
    console.error(`[glassdoor] Scrape error:`, (err as Error).message);
  }

  return jobs;
}

// ── ZipRecruiter Jobs ──
export async function scrapeZipRecruiterJobs(
  query: string,
  location: string,
  maxResults = 30,
): Promise<ParsedJob[]> {
  const jobs: ParsedJob[] = [];

  try {
    const encodedQuery = encodeURIComponent(query);
    const encodedLocation = encodeURIComponent(location);
    const isRemote = location.toLowerCase().includes("remote");

    const url = `https://www.ziprecruiter.com/jobs-search?search=${encodedQuery}&location=${encodedLocation}${isRemote ? "&remote=1" : ""}&days=7`;

    console.log(`[ziprecruiter] Scraping...`);
    const result = await scrapePage(url, {
      waitSelector: ".job_result_two_pane, .job-listing, article, .job_content",
      waitMs: 4000,
      timeoutMs: 20000,
    });

    if (!result?.html) {
      console.log(`[ziprecruiter] No HTML returned`);
      return jobs;
    }

    console.log(`[ziprecruiter] Got ${result.html.length} bytes, URL: ${result.url.substring(0, 80)}`);

    const $ = cheerio.load(result.html);
    let cards = $(".job_result_two_pane");
    if (cards.length === 0) cards = $("article.job-listing");
    if (cards.length === 0) cards = $("[data-testid='job-card']");
    if (cards.length === 0) cards = $(".job_content");
    if (cards.length === 0) cards = $(".jobList article");

    if (cards.length === 0) {
      const title = $("title").text();
      console.log(`[ziprecruiter] No cards found, page title: "${title.substring(0, 60)}"`);
    }

    cards.each((_, el) => {
      if (jobs.length >= maxResults) return;
      const $el = $(el);
      const title = $el.find(".job_title, h2 a, [data-testid='job-title']").text().trim();
      const company = $el.find(".hiring_company, .company-name, [data-testid='company-name']").text().trim();
      const loc = $el.find(".location, [data-testid='location']").text().trim();
      const salary = $el.find(".salary, [data-testid='salary']").text().trim();
      const link = $el.find("a.job_link, h2 a, a[href*='/jobs/']").attr("href");
      const snippet = $el.find(".job_snippet, .job-description-snippet").text().trim();

      if (!title || !company) return;

      const jobUrl = link
        ? (link.startsWith("http") ? link : `https://www.ziprecruiter.com${link}`)
        : `https://www.ziprecruiter.com/jobs-search?search=${encodedQuery}`;

      jobs.push({
        url: jobUrl,
        company,
        role: title,
        location: loc || location,
        salary: salary || null,
        description: snippet || null,
        source: "ziprecruiter",
        tags: [],
        employmentType: null,
        isRemote: isRemote || loc.toLowerCase().includes("remote"),
        postedAt: null,
      });
    });

    console.log(`[ziprecruiter] Found ${jobs.length} jobs`);
  } catch (err) {
    console.error(`[ziprecruiter] Scrape error:`, (err as Error).message);
  }

  return jobs;
}

// ── Workday ATS Boards ──
// Workday uses a JSON API at: https://{company}.wd{N}.myworkdayjobs.com/wday/cxs/{company}/{site}/jobs
// This is a public API, no auth needed
// Confirmed working Workday API endpoints (tested with POST + searchText)
const WORKDAY_BOARDS = [
  { company: "adobe", wd: 5, site: "external_experienced" },
  { company: "paypal", wd: 1, site: "jobs" },
  { company: "crowdstrike", wd: 5, site: "crowdstrikecareers" },
];

export async function scrapeWorkdayJobs(
  query: string,
  location: string,
  maxPerBoard = 20,
): Promise<ParsedJob[]> {
  const allJobs: ParsedJob[] = [];
  const keywords = query.toLowerCase().split(/[\s,]+/).filter((k) => k.length > 2);
  const isRemote = location.toLowerCase().includes("remote");

  for (const board of WORKDAY_BOARDS) {
    try {
      const apiUrl = `https://${board.company}.wd${board.wd}.myworkdayjobs.com/wday/cxs/${board.company}/${board.site}/jobs`;
      const body = JSON.stringify({
        appliedFacets: {},
        limit: 50,
        offset: 0,
        searchText: query,
      });

      const res = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body,
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) continue;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = await res.json();
      const postings = data.jobPostings || [];
      if (postings.length === 0) continue;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const matching = postings.filter((j: any) => {
        const text = `${j.title} ${j.locationsText || ""}`.toLowerCase();
        return keywords.some((kw) => text.includes(kw));
      });

      if (matching.length === 0) continue;
      console.log(`[workday] ${board.company}: ${matching.length} matching jobs`);

      const companyName = board.company.charAt(0).toUpperCase() + board.company.slice(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const j of matching.slice(0, maxPerBoard)) {
        const loc = j.locationsText || null;
        allJobs.push({
          url: `https://${board.company}.wd${board.wd}.myworkdayjobs.com${j.externalPath}`,
          company: companyName,
          role: j.title,
          location: loc,
          salary: null,
          description: j.bulletFields?.join(" ") || null,
          source: "workday",
          tags: j.bulletFields?.slice(0, 3) || [],
          employmentType: j.timeType || null,
          isRemote: isRemote || (loc?.toLowerCase().includes("remote") ?? false),
          postedAt: j.postedOn ? new Date(j.postedOn) : null,
        });
      }
    } catch (err) {
      const msg = (err as Error).message;
      if (!msg.includes("aborted")) {
        console.error(`[workday] ${board.company} error:`, msg);
      }
    }
  }

  console.log(`[workday] Total: ${allJobs.length} jobs scraped`);
  return allJobs;
}
