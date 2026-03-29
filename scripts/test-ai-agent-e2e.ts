/**
 * Standalone E2E test for the AI Agent auto-apply.
 * Runs the actual AI agent loop against real job URLs using Playwright + OpenAI.
 * Bypasses Clerk auth — tests the agent directly.
 * 
 * Usage: npx tsx scripts/test-ai-agent-e2e.ts [--url <url>] [--all]
 */

import { config } from "dotenv";
config({ path: ".env.local" });

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chromium } = require("playwright-extra");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
chromium.use(StealthPlugin());
import Anthropic from "@anthropic-ai/sdk";
import { runAIAgent, AgentContext } from "../src/lib/auto-apply/ai-agent";
import { installHCaptchaCapture } from "../src/lib/auto-apply/captcha/solver";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const claudeClient = { provider: "claude" as const, client: anthropic };

// Mock user context for testing
const TEST_CONTEXT: AgentContext = {
  firstName: "Seun",
  lastName: "Johnson",
  email: "johnsonseun15@gmail.com",
  phone: "5015024609",
  linkedIn: "https://linkedin.com/in/sjohnson",
  resumeText: `Seun Johnson — Senior Software Engineer
5+ years of experience in full-stack development, cloud infrastructure, and DevOps.
Skills: TypeScript, Python, Go, React, Node.js, AWS, GCP, Kubernetes, Docker, Terraform, CI/CD
Experience:
- Senior Software Engineer at TechCorp (2021-present): Led migration to microservices, reduced deployment time by 60%
- Software Engineer at StartupXYZ (2019-2021): Built real-time data pipeline processing 1M+ events/day
- Junior Developer at WebAgency (2017-2019): Full-stack web development with React and Node.js
Education: BS Computer Science, University of Lagos`,
  coverLetterText: `Dear Hiring Manager,
I am excited to apply for this position. With 5+ years of experience in software engineering, I bring strong expertise in full-stack development, cloud infrastructure, and team leadership. I am passionate about building scalable systems and would love to contribute to your team.
Best regards, Seun Johnson`,
  currentTitle: "Senior Software Engineer",
  yearsExp: "5",
  needsSponsorship: false,
  location: "California",
  resumeFilePath: process.env.RESUME_PDF_PATH || "/Users/sjohnson45/Library/Mobile Documents/com~apple~CloudDocs/Seun_Johnson_RESUME_Intuit.pdf",
  dbUserId: process.env.DB_USER_ID || "cmlq3peek0000aq2dyhj97whw",
  clerkId: process.env.CLERK_USER_ID || "user_39eEK8F7gqAIw6UWICr0KuqKTB5",
};

// Test jobs — 22 platforms covering major ATS systems
const TEST_JOBS = [
  // ── Greenhouse (direct job-boards) ──
  {
    name: "Mercury (Greenhouse direct)",
    url: "https://job-boards.greenhouse.io/mercury/jobs/5520964004",
    company: "Mercury",
    role: "Senior Backend Engineer - Product",
  },
  {
    name: "Postman (Greenhouse direct)",
    url: "https://job-boards.greenhouse.io/postman/jobs/7528077003",
    company: "Postman",
    role: "Strategic Solutions Engineering",
  },
  {
    name: "Reddit (Greenhouse direct)",
    url: "https://job-boards.greenhouse.io/reddit/jobs/7377109",
    company: "Reddit",
    role: "Senior ML Engineer",
  },
  {
    name: "Flex (Greenhouse direct)",
    url: "https://job-boards.greenhouse.io/flex/jobs/4649208005",
    company: "Flex",
    role: "Software Engineer I, Fullstack",
  },
  {
    name: "Airtable (Greenhouse direct)",
    url: "https://job-boards.greenhouse.io/airtable/jobs/8409376002",
    company: "Airtable",
    role: "Software Engineer, New Grad (2026)",
  },
  {
    name: "SpaceX (Greenhouse direct)",
    url: "https://job-boards.greenhouse.io/spacex/jobs/8149124002",
    company: "SpaceX",
    role: "Summer 2026 Engineering Internship",
  },
  {
    name: "Loop (Greenhouse direct)",
    url: "https://job-boards.greenhouse.io/loop/jobs/5780582004",
    company: "Loop",
    role: "2026 New Grad, Software Engineer",
  },
  // ── Greenhouse (embedded iframe) ──
  {
    name: "Airbnb (Greenhouse iframe)",
    url: "https://careers.airbnb.com/positions/7609564?gh_jid=7609564",
    company: "Airbnb",
    role: "Senior Software Engineer, Service Mesh",
  },
  {
    name: "Stripe (Greenhouse embedded)",
    url: "https://stripe.com/jobs/listing/backend-engineer-core-tech-canada/6567253/apply",
    company: "Stripe",
    role: "Backend Engineer, Core Tech",
  },
  // ── Lever ──
  {
    name: "Plaid (Lever)",
    url: "https://jobs.lever.co/plaid/9c7b4342-de57-4a74-8ada-9741a07c7b5f",
    company: "Plaid",
    role: "Product Manager",
  },
  {
    name: "Veeva (Lever)",
    url: "https://jobs.lever.co/veeva/8fe22df0-02b4-453d-919c-c8998cf913f6",
    company: "Veeva Systems",
    role: "Associate Software Engineer",
  },
  {
    name: "Belvedere (Lever)",
    url: "https://jobs.lever.co/belvederetrading/f81a8965-5537-4a4b-aec6-c02dfa51815e",
    company: "Belvedere Trading",
    role: "Software Engineer - Entry Level 2026",
  },
  // ── Ashby ──
  {
    name: "Zip (Ashby)",
    url: "https://jobs.ashbyhq.com/zip/5f28357a-c95d-485a-84f9-feff64ce9fb3/application",
    company: "Zip",
    role: "Software Engineer, New Grad (2026 Start)",
  },
  {
    name: "EliseAI (Ashby)",
    url: "https://jobs.ashbyhq.com/eliseai/1ffbd278-a5fe-443c-984f-521d61a97353/application",
    company: "EliseAI",
    role: "Software Engineer (New Grads 2025-2026)",
  },
  {
    name: "Benchling (Ashby)",
    url: "https://jobs.ashbyhq.com/benchling/b3c9b312-6e2b-4dbc-9b15-0b0310d75a7f/application",
    company: "Benchling",
    role: "Software Engineer, New Grad (2026)",
  },
  // ── Workable ──
  {
    name: "ByStadium (Workable)",
    url: "https://apply.workable.com/bystadium/j/F92DE7EF78",
    company: "ByStadium",
    role: "Software Engineer - Fresher (2026/2027)",
  },
  {
    name: "DataVisor (Workable)",
    url: "https://apply.workable.com/datavisor-jobs/j/2FB6A93BF6/",
    company: "DataVisor",
    role: "Backend Software Engineer",
  },
  // ── SmartRecruiters ──
  {
    name: "Visa (SmartRecruiters)",
    url: "https://jobs.smartrecruiters.com/Visa/744000103598105-software-engineer-new-college-grad-2026-highlands-ranch-co",
    company: "Visa",
    role: "Software Engineer, New College Grad - 2026",
  },
  {
    name: "Experian (SmartRecruiters)",
    url: "https://jobs.smartrecruiters.com/Experian/744000087951481-software-engineer-xcelerator-rotation-program-entry-level-swe-remote",
    company: "Experian",
    role: "Software Engineer Xcelerator Rotation Program - Entry Level",
  },
  // ── iCIMS ──
  {
    name: "General Dynamics (iCIMS)",
    url: "https://careers-gdms.icims.com/jobs/71514/software-engineer-%E2%80%93-entry-level/job",
    company: "General Dynamics Mission Systems",
    role: "Software Engineer – Entry Level",
  },
  // ── BambooHR ──
  {
    name: "BambooHR (BambooHR)",
    url: "https://www.bamboohr.com/careers/engineering-it-team",
    company: "BambooHR",
    role: "Software Engineer",
  },
  // ── Taleo (legacy — many listings expire quickly) ──
  // Taleo URLs are kept as a stretch goal; most Taleo jobs require account creation
  // which adds complexity. Uncomment to test:
  // {
  //   name: "AmericanExpress (Taleo)",
  //   url: "https://axp.taleo.net/careersection/rp/jobdetail.ftl?job=25021238",
  //   company: "American Express",
  //   role: "Senior Software Engineer",
  // },
  // ── JazzHR ──
  {
    name: "Eclipse Foundation (JazzHR)",
    url: "https://eclipsefoundation.applytojob.com/apply/eXFgacP5SJ/Software-Engineer",
    company: "Eclipse Foundation",
    role: "Software Engineer",
  },
  // ── Breezy HR ──
  {
    name: "Matroid (Breezy HR)",
    url: "https://matroid.breezy.hr/p/f6dea6b23c47-software-engineering-intern-product-summer-2026/apply",
    company: "Matroid",
    role: "Software Engineering Intern, Product (Summer 2026)",
  },
  // ── Recruitee ──
  {
    name: "Apply Digital (Recruitee)",
    url: "https://applydigital.recruitee.com/o/junior-software-engineer",
    company: "Apply Digital",
    role: "Junior Software Engineer",
  },
  // ── Jobvite ──
  {
    name: "Egnyte (Jobvite)",
    url: "https://jobs.jobvite.com/egnyte/job/oRaFwfwW",
    company: "Egnyte",
    role: "Java Software Engineer - Core Infrastructure",
  },
  {
    name: "TechSmith (Jobvite)",
    url: "https://jobs.jobvite.com/techsmith/job/oFM0ufwF",
    company: "TechSmith",
    role: "Full Stack Software Engineer",
  },
  // ── Workday / MyWorkdayJobs ──
  {
    name: "Boeing (Workday)",
    url: "https://boeing.wd1.myworkdayjobs.com/en-US/EXTERNAL_CAREERS/job/Entry-Level-Software-Engineer---Systems-Test-and-Verification_JR2026496504-1/apply",
    company: "Boeing",
    role: "Entry Level Software Engineer - Systems Test and Verification",
  },
  {
    name: "Chevron (Workday)",
    url: "https://chevron.wd5.myworkdayjobs.com/en-US/jobs/job/XMLNAME-2025---2026--University-Hire---Software-Engineer-Full-time_R000064955-1",
    company: "Chevron",
    role: "2025-2026 University Hire – Software Engineer",
  },
];

async function testJob(job: typeof TEST_JOBS[0]) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`🧪 TESTING: ${job.name}`);
  console.log(`   URL: ${job.url}`);
  console.log(`${"=".repeat(70)}`);

  const startTime = Date.now();
  // Detect Workday even from aggregator pages — check URL and also page content for Workday links
  const isWorkday = job.url.includes("myworkdayjobs.com") || job.url.includes("workday.com") || job.url.includes("nvidia") || process.argv.includes("--workday");
  if (isWorkday) console.log(`⚙️  Workday detected — using Chrome channel (TLS fingerprinting bypass)`);
  // Use headed mode for Lever (hCaptcha) and SmartRecruiters (Cloudflare bot detection)
  const isLever = job.url.includes("jobs.lever.co");
  const isSmartRecruiters = job.url.includes("smartrecruiters.com");
  const isJobvite = job.url.includes("jobvite.com");
  const isWorkable = job.url.includes("workable.com");
  const isAshby = job.url.includes("ashbyhq.com");
  const isRecruitee = job.url.includes("recruitee.com");
  const needsHeaded = isLever || isSmartRecruiters || isJobvite || isAshby || isWorkable || isRecruitee;
  const needsChrome = isWorkday || isSmartRecruiters || isWorkable || isRecruitee;
  const browser = await chromium.launch({
    headless: !needsHeaded,
    ...(needsChrome ? { channel: "chrome" } : {}),
    args: needsChrome ? [
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
    ] : [],
  });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
    locale: "en-US",
    timezoneId: "America/Los_Angeles",
  });
  const page = await context.newPage();

  // Stealth: mask webdriver property to bypass Cloudflare/bot detection
  if (needsChrome) {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      const originalQuery = window.navigator.permissions.query;
      (window.navigator.permissions as any).query = (parameters: any) =>
        parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
          : originalQuery(parameters);
    });
  }

  // Install rqdata capture before goto so checksiteconfig is captured during page load
  if (isLever) installHCaptchaCapture(page);

  try {
    // Load page
    console.log(`🌐 Loading page...`);
    try {
      await page.goto(job.url, { waitUntil: "networkidle", timeout: 30000 });
    } catch {
      try { await page.goto(job.url, { waitUntil: "domcontentloaded", timeout: 15000 }); } catch { /* */ }
    }
    // SPA platforms need extra time to render — use DOM-based waits
    if (isWorkday) {
      await page.waitForTimeout(12000);
      const bodyText = await page.textContent("body").catch(() => "") || "";
      if (bodyText.includes("doesn't exist") || bodyText.includes("does not exist") || bodyText.length < 200) {
        console.log("⚠️  Workday page may not have loaded — retrying...");
        await page.reload({ waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(12000);
      }
    } else if (isWorkable) {
      // Workable SPA: wait for form elements or job content to appear (up to 20s)
      console.log(`⏳ Waiting for Workable SPA to render...`);
      try {
        await page.waitForSelector('input:not([type="hidden"]), textarea, form, [data-ui="application"], .careers-application', { timeout: 20000 });
        await page.waitForTimeout(2000);
        console.log(`✅ Workable form content detected`);
      } catch {
        console.log(`⚠️  Workable form not detected after 20s — proceeding anyway`);
        await page.waitForTimeout(3000);
      }
    } else {
      await page.waitForTimeout(3000);
    }
    console.log(`📄 Title: ${await page.title()}`);
    console.log(`📍 URL: ${page.url()}`);

    // Run AI Agent
    console.log(`\n🤖 Starting AI Agent (max 20 iterations)...`);
    const result = await runAIAgent(
      claudeClient,
      page,
      TEST_CONTEXT,
      job.url,
      job.role,
      job.company,
      context, // pass browserContext for new tab detection
    );

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`\n📊 RESULT (${elapsed}s, ${result.iterationsUsed} iterations):`);
    console.log(`   Success: ${result.success ? "✅ YES" : "❌ NO"}`);
    console.log(`   Platform: ${result.platform}`);
    console.log(`   Message: ${result.message.slice(0, 300)}`);
    console.log(`   Confirmation: ${result.confirmationDetected}`);
    if (result.confirmationText) console.log(`   Confirmation text: ${result.confirmationText.slice(0, 200)}`);
    console.log(`   Steps (${result.stepsCompleted.length}):`);
    result.stepsCompleted.forEach((s, i) => console.log(`     ${i + 1}. ${s}`));
    console.log(`   Screenshots: ${result.screenshotSteps.length}`);

    // Save screenshots for debugging (headless mode relies on these)
    const fs = await import("fs");
    const path = await import("path");
    const dir = path.join(process.cwd(), ".test-screenshots");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const safeName = job.name.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
    result.screenshotSteps.forEach((ss, i) => {
      const ssPath = path.join(dir, `${safeName}_step${i + 1}.png`);
      fs.writeFileSync(ssPath, Buffer.from(ss.screenshot, "base64"));
    });
    // Save a URL reference file for easy identification
    fs.writeFileSync(path.join(dir, `${safeName}_url.txt`), `${job.url}\n${job.name}\n${result.success ? "SUCCESS" : "FAILED"}: ${result.message}\n`);
    console.log(`   📸 ${result.screenshotSteps.length} screenshots saved to .test-screenshots/${safeName}_step*.png`);
    result.screenshotSteps.forEach((ss, i) => {
      console.log(`      Step ${i + 1}: ${ss.step.slice(0, 80)}`);
    });

    return { name: job.name, success: result.success, message: result.message, steps: result.stepsCompleted.length, iterations: result.iterationsUsed, elapsed };
  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`❌ Error (${elapsed}s): ${(err as Error).message}`);
    return { name: job.name, success: false, message: (err as Error).message, steps: 0, iterations: 0, elapsed };
  } finally {
    await browser.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const testAll = args.includes("--all");
  const urlIdx = args.indexOf("--url");

  console.log("🧪 AI Agent End-to-End Test (Direct)");
  console.log(`Time: ${new Date().toISOString()}`);
  console.log(`Anthropic API Key: ${process.env.ANTHROPIC_API_KEY ? "✅ Set" : "❌ Missing"}`);
  console.log(`Resume PDF: ${process.env.RESUME_PDF_PATH || "Not set"}\n`);

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("❌ ANTHROPIC_API_KEY is required. Set it in .env.local");
    process.exit(1);
  }

  console.log(`Total platforms configured: ${TEST_JOBS.length}\n`);

  let jobsToTest: typeof TEST_JOBS;
  const jobIdx = args.indexOf("--job");
  if (urlIdx >= 0 && args[urlIdx + 1]) {
    jobsToTest = [{ name: "Custom", url: args[urlIdx + 1], company: "Test", role: "Test" }];
  } else if (jobIdx >= 0 && args[jobIdx + 1]) {
    const filter = args[jobIdx + 1].toLowerCase();
    jobsToTest = TEST_JOBS.filter(j => j.name.toLowerCase().includes(filter) || j.company.toLowerCase().includes(filter));
    if (jobsToTest.length === 0) {
      console.error(`❌ No jobs matching "${args[jobIdx + 1]}". Available: ${TEST_JOBS.map(j => j.name).join(", ")}`);
      process.exit(1);
    }
  } else if (testAll) {
    jobsToTest = TEST_JOBS;
  } else {
    // Default: test first job
    jobsToTest = [TEST_JOBS[0]];
  }

  const results = [];
  for (const job of jobsToTest) {
    const result = await testJob(job);
    results.push(result);
  }

  // Summary
  console.log(`\n${"=".repeat(70)}`);
  console.log("📊 FINAL SUMMARY");
  console.log(`${"=".repeat(70)}`);
  const passed = results.filter(r => r.success).length;
  const captchaBlocked = results.filter(r => !r.success && r.message.toLowerCase().includes("captcha") && r.steps >= 5).length;
  const notFound = results.filter(r => !r.success && (r.message.toLowerCase().includes("not found") || r.message.toLowerCase().includes("404") || r.message.toLowerCase().includes("expired") || r.message.toLowerCase().includes("no longer available"))).length;
  results.forEach(r => {
    const isCaptcha = !r.success && r.message.toLowerCase().includes("captcha") && r.steps >= 5;
    const icon = r.success ? "✅" : isCaptcha ? "🔒" : "❌";
    const label = r.success ? "PASSED" : isCaptcha ? "CAPTCHA-BLOCKED (form filled)" : "FAILED";
    console.log(`${icon} ${r.name}: ${label} (${r.elapsed}s, ${r.iterations} iters, ${r.steps} steps)`);
    if (!r.success) console.log(`   → ${r.message.slice(0, 200)}`);
  });
  console.log(`\n${passed}/${results.length} fully passed`);
  if (captchaBlocked > 0) console.log(`🔒 ${captchaBlocked} CAPTCHA-blocked (form filled successfully, needs CAPTCHA solver)`);
  if (notFound > 0) console.log(`⚠️  ${notFound} jobs expired/not found (URL needs updating)`);
  console.log(`📊 Effective success rate: ${passed + captchaBlocked}/${results.length} (${Math.round((passed + captchaBlocked) / results.length * 100)}%)`);
}

main().catch(console.error);
