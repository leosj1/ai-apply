// Site-specific job listing parsers using Cheerio
import * as cheerio from "cheerio";

export interface ParsedJob {
  url: string;
  company: string;
  role: string;
  location: string | null;
  salary: string | null;
  description: string | null;
  source: string;
  tags: string[];
  employmentType: string | null;
  isRemote: boolean;
  postedAt: Date | null;
}

// ── Greenhouse parser ──
// Greenhouse job boards are static HTML, easy to parse
// URL pattern: https://boards.greenhouse.io/{company}/jobs/{id}
export function parseGreenhouseJobList(html: string, boardUrl: string): ParsedJob[] {
  const $ = cheerio.load(html);
  const jobs: ParsedJob[] = [];
  const company = boardUrl.match(/boards\.greenhouse\.io\/([^/]+)/)?.[1] || "Unknown";

  $("div.opening").each((_, el) => {
    const $el = $(el);
    const linkEl = $el.find("a");
    const role = linkEl.text().trim();
    const href = linkEl.attr("href");
    if (!role || !href) return;

    const url = href.startsWith("http") ? href : `https://boards.greenhouse.io${href}`;
    const location = $el.find(".location").text().trim() || null;

    jobs.push({
      url,
      company: formatCompanyName(company),
      role,
      location,
      salary: null,
      description: null,
      source: "greenhouse",
      tags: [],
      employmentType: null,
      isRemote: location?.toLowerCase().includes("remote") || false,
      postedAt: null,
    });
  });

  return jobs;
}

export function parseGreenhouseJobDetail(html: string, url: string): Partial<ParsedJob> | null {
  const $ = cheerio.load(html);

  const role = $("h1.app-title").text().trim() || $("h1").first().text().trim();
  const location = $(".location").first().text().trim() || null;
  const description = $("#content").text().trim() || $(".content").text().trim() || null;

  if (!role) return null;

  return {
    url,
    role,
    location,
    description: description?.substring(0, 5000) || null,
    isRemote: location?.toLowerCase().includes("remote") || false,
  };
}

// ── Lever parser ──
// URL pattern: https://jobs.lever.co/{company}/{uuid}
export function parseLeverJobList(html: string, boardUrl: string): ParsedJob[] {
  const $ = cheerio.load(html);
  const jobs: ParsedJob[] = [];
  const company = boardUrl.match(/jobs\.lever\.co\/([^/]+)/)?.[1] || "Unknown";

  $(".posting").each((_, el) => {
    const $el = $(el);
    const linkEl = $el.find("a.posting-title");
    const role = linkEl.find("h5").text().trim();
    const href = linkEl.attr("href");
    if (!role || !href) return;

    const location = $el.find(".posting-categories .sort-by-location").text().trim() || null;
    const commitment = $el.find(".posting-categories .sort-by-commitment").text().trim() || null;

    jobs.push({
      url: href,
      company: formatCompanyName(company),
      role,
      location,
      salary: null,
      description: null,
      source: "lever",
      tags: [],
      employmentType: commitment || null,
      isRemote: location?.toLowerCase().includes("remote") || false,
      postedAt: null,
    });
  });

  return jobs;
}

export function parseLeverJobDetail(html: string, url: string): Partial<ParsedJob> | null {
  const $ = cheerio.load(html);

  const role = $("h2.posting-headline").text().trim() || $("h2").first().text().trim();
  const location = $(".posting-categories .location").text().trim() || null;
  const descParts: string[] = [];
  $(".posting-page .section-wrapper").each((_, el) => {
    descParts.push($(el).text().trim());
  });
  const description = descParts.join("\n\n").substring(0, 5000) || null;

  if (!role) return null;

  return {
    url,
    role,
    location,
    description,
    isRemote: location?.toLowerCase().includes("remote") || false,
  };
}

// ── Indeed parser ──
// Indeed search results page
export function parseIndeedSearchResults(html: string): ParsedJob[] {
  const $ = cheerio.load(html);
  const jobs: ParsedJob[] = [];

  $(".job_seen_beacon, .jobsearch-ResultsList .result").each((_, el) => {
    const $el = $(el);
    const titleEl = $el.find("h2.jobTitle a, .jobTitle a");
    const role = titleEl.text().trim();
    const href = titleEl.attr("href");
    if (!role || !href) return;

    const url = href.startsWith("http") ? href : `https://www.indeed.com${href}`;
    const company = $el.find(".companyName, [data-testid='company-name']").text().trim();
    const location = $el.find(".companyLocation, [data-testid='text-location']").text().trim() || null;
    const salary = $el.find(".salary-snippet-container, .metadata.salary-snippet-container").text().trim() || null;

    if (!company) return;

    jobs.push({
      url,
      company,
      role,
      location,
      salary,
      description: null,
      source: "indeed",
      tags: [],
      employmentType: null,
      isRemote: location?.toLowerCase().includes("remote") || false,
      postedAt: null,
    });
  });

  return jobs;
}

// ── LinkedIn parser ──
// LinkedIn public job search (no auth required for search results)
// URL: https://www.linkedin.com/jobs/search/?keywords=...&location=...
export function parseLinkedInSearchResults(html: string): ParsedJob[] {
  const $ = cheerio.load(html);
  const jobs: ParsedJob[] = [];

  // LinkedIn public job cards
  $(".base-card, .job-search-card").each((_, el) => {
    const $el = $(el);
    const titleEl = $el.find("h3.base-search-card__title, .base-search-card__title");
    const role = titleEl.text().trim();
    const href = $el.find("a.base-card__full-link, a.base-search-card__full-link").attr("href");
    if (!role || !href) return;

    const company = $el.find("h4.base-search-card__subtitle, .base-search-card__subtitle").text().trim();
    const location = $el.find(".job-search-card__location").text().trim() || null;
    const dateEl = $el.find("time");
    const postedAt = dateEl.attr("datetime") ? new Date(dateEl.attr("datetime")!) : null;

    if (!company) return;

    // Clean up LinkedIn URL to standard format
    const cleanUrl = href.split("?")[0];

    jobs.push({
      url: cleanUrl,
      company,
      role,
      location,
      salary: null,
      description: null,
      source: "linkedin",
      tags: [],
      employmentType: null,
      isRemote: location?.toLowerCase().includes("remote") || false,
      postedAt,
    });
  });

  return jobs;
}

// ── Glassdoor parser ──
export function parseGlassdoorSearchResults(html: string): ParsedJob[] {
  const $ = cheerio.load(html);
  const jobs: ParsedJob[] = [];

  $("[data-test='jobListing'], .react-job-listing").each((_, el) => {
    const $el = $(el);
    const role = $el.find("[data-test='job-title'], .jobLink").text().trim();
    const href = $el.find("a[data-test='job-title'], a.jobLink").attr("href");
    if (!role || !href) return;

    const url = href.startsWith("http") ? href : `https://www.glassdoor.com${href}`;
    const company = $el.find("[data-test='emp-name'], .jobEmpolyerName").text().trim();
    const location = $el.find("[data-test='emp-location'], .loc").text().trim() || null;
    const salary = $el.find("[data-test='detailSalary'], .salary-estimate").text().trim() || null;

    if (!company) return;

    jobs.push({
      url,
      company,
      role,
      location,
      salary,
      description: null,
      source: "glassdoor",
      tags: [],
      employmentType: null,
      isRemote: location?.toLowerCase().includes("remote") || false,
      postedAt: null,
    });
  });

  return jobs;
}

// ── ZipRecruiter parser ──
export function parseZipRecruiterSearchResults(html: string): ParsedJob[] {
  const $ = cheerio.load(html);
  const jobs: ParsedJob[] = [];

  $(".job_content, article.job-listing").each((_, el) => {
    const $el = $(el);
    const titleEl = $el.find(".job_title a, h2.title a");
    const role = titleEl.text().trim();
    const href = titleEl.attr("href");
    if (!role || !href) return;

    const url = href.startsWith("http") ? href : `https://www.ziprecruiter.com${href}`;
    const company = $el.find(".job_org, .company-name").text().trim();
    const location = $el.find(".job_location, .location").text().trim() || null;
    const salary = $el.find(".job_salary, .salary").text().trim() || null;

    if (!company) return;

    jobs.push({
      url,
      company,
      role,
      location,
      salary,
      description: null,
      source: "ziprecruiter",
      tags: [],
      employmentType: null,
      isRemote: location?.toLowerCase().includes("remote") || false,
      postedAt: null,
    });
  });

  return jobs;
}

// ── Generic job page parser ──
// Extracts structured data from any job page using JSON-LD, Open Graph, or heuristics
export function parseGenericJobPage(html: string, url: string): Partial<ParsedJob> | null {
  const $ = cheerio.load(html);

  // Try JSON-LD structured data first (most reliable)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let jsonLd: any = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html() || "");
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item["@type"] === "JobPosting") {
          jsonLd = item;
          break;
        }
      }
    } catch { /* ignore */ }
  });

  if (jsonLd) {
    const hiringOrg = jsonLd.hiringOrganization as Record<string, string> | undefined;
    const jobLocation = jsonLd.jobLocation as Record<string, unknown> | Record<string, unknown>[] | undefined;
    const salary = jsonLd.baseSalary as Record<string, unknown> | undefined;

    let location: string | null = null;
    if (Array.isArray(jobLocation) && jobLocation.length > 0) {
      const addr = jobLocation[0].address as Record<string, string> | undefined;
      location = addr ? [addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(Boolean).join(", ") : null;
    } else if (jobLocation) {
      const addr = (jobLocation as Record<string, unknown>).address as Record<string, string> | undefined;
      location = addr ? [addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(Boolean).join(", ") : null;
    }

    let salaryStr: string | null = null;
    if (salary) {
      const value = salary.value as Record<string, unknown> | undefined;
      if (value) {
        const min = value.minValue as number;
        const max = value.maxValue as number;
        const currency = salary.currency as string || "USD";
        if (min && max) salaryStr = `${currency} $${min.toLocaleString()} - $${max.toLocaleString()}`;
        else if (min) salaryStr = `${currency} $${min.toLocaleString()}+`;
      }
    }

    return {
      url,
      company: hiringOrg?.name || null as unknown as string,
      role: (jsonLd.title as string) || null as unknown as string,
      location,
      salary: salaryStr,
      description: ((jsonLd.description as string) || "").replace(/<[^>]*>/g, " ").substring(0, 5000) || null,
      employmentType: (jsonLd.employmentType as string) || null,
      isRemote: (jsonLd.jobLocationType as string)?.includes("TELECOMMUTE") ||
        location?.toLowerCase().includes("remote") || false,
      postedAt: jsonLd.datePosted ? new Date(jsonLd.datePosted as string) : null,
    };
  }

  // Fallback: Open Graph + heuristics
  const ogTitle = $('meta[property="og:title"]').attr("content") || $("title").text().trim();
  const ogDesc = $('meta[property="og:description"]').attr("content") || $('meta[name="description"]').attr("content");

  if (!ogTitle) return null;

  return {
    url,
    role: ogTitle,
    description: ogDesc?.substring(0, 5000) || null,
    isRemote: ogTitle.toLowerCase().includes("remote") || ogDesc?.toLowerCase().includes("remote") || false,
  };
}

// Helper: format company slug to readable name
function formatCompanyName(slug: string): string {
  return slug
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
