/**
 * Test auto-apply via the same code path the UI/API route uses.
 * Calls autoApply() from index.ts with OpenAI — identical to what happens
 * when a user clicks "Auto Apply" in the dashboard.
 *
 * Usage: npx tsx scripts/test-api-route.ts [--url <url>] [--job <name>]
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Same user context the API route builds from the DB
const USER_CONTEXT = {
  firstName: "Seun",
  lastName: "Johnson",
  email: "johnsonseun15@gmail.com",
  phone: "5015024609",
  linkedIn: "https://linkedin.com/in/sjohnson",
  location: "California",
  resumeText: `Seun Johnson — Senior Software Engineer
5+ years of experience in full-stack development, cloud infrastructure, and DevOps.
Skills: TypeScript, Python, Go, React, Node.js, AWS, GCP, Kubernetes, Docker, Terraform, CI/CD
Experience:
- Senior Software Engineer at TechCorp (2021-present): Led migration to microservices, reduced deployment time by 60%
- Software Engineer at StartupXYZ (2019-2021): Built real-time data pipeline processing 1M+ events/day
Education: BS Computer Science, University of Lagos`,
  coverLetterText: `Dear Hiring Manager,
I am excited to apply for this position. With 5+ years of experience in software engineering, I bring strong expertise in full-stack development and cloud infrastructure.
Best regards, Seun Johnson`,
  currentTitle: "Senior Software Engineer",
  yearsExp: "5",
  needsSponsorship: false,
  resumeFilePath: process.env.RESUME_PDF_PATH || "/Users/sjohnson45/Library/Mobile Documents/com~apple~CloudDocs/Seun_Johnson_RESUME_Intuit.pdf",
  clerkId: process.env.CLERK_USER_ID || "user_39eEK8F7gqAIw6UWICr0KuqKTB5",
};

const DB_USER_ID = process.env.DB_USER_ID || "cmlq3peek0000aq2dyhj97whw";

// Test jobs across platforms
const TEST_JOBS = [
  // Greenhouse
  { name: "Mercury", platform: "greenhouse", url: "https://job-boards.greenhouse.io/mercury/jobs/5520964004", company: "Mercury", role: "Senior Backend Engineer" },
  { name: "Flex", platform: "greenhouse", url: "https://job-boards.greenhouse.io/flex/jobs/4649208005", company: "Flex", role: "Software Engineer I" },
  { name: "Loop", platform: "greenhouse", url: "https://job-boards.greenhouse.io/loop/jobs/6286030003", company: "Loop", role: "Software Engineer, Full-Stack" },
  { name: "Reddit", platform: "greenhouse", url: "https://job-boards.greenhouse.io/reddit/jobs/7377109", company: "Reddit", role: "Senior ML Engineer" },
  // Lever
  { name: "Veeva", platform: "lever", url: "https://jobs.lever.co/veeva/8fe22df0-02b4-453d-919c-c8998cf913f6", company: "Veeva", role: "Associate Software Engineer" },
  // Ashby
  { name: "Whatnot", platform: "ashby", url: "https://jobs.ashbyhq.com/whatnot/bc8f8c7f-2c4c-4f43-a238-953568c101b8", company: "Whatnot", role: "Software Engineer, New Grad" },
  // Workable
  { name: "DataVisor", platform: "workable", url: "https://apply.workable.com/datavisor/j/E5D86B7E2F/", company: "DataVisor", role: "Software Engineer" },
  // SmartRecruiters
  { name: "Visa", platform: "smartrecruiters", url: "https://jobs.smartrecruiters.com/Visa/744000048835498", company: "Visa", role: "Software Engineer" },
];

async function testJob(job: typeof TEST_JOBS[0]) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`🧪 TESTING: ${job.name} (${job.platform})`);
  console.log(`   URL: ${job.url}`);
  console.log(`${"=".repeat(70)}`);

  const startTime = Date.now();

  try {
    // Import autoApply — same function the API route calls
    const { autoApply, detectPlatform } = await import("../src/lib/auto-apply");
    const platform = detectPlatform(job.url);
    console.log(`📋 Detected platform: ${platform}`);

    // Call autoApply with AI agent — exactly like the API route does
    const result = await autoApply(job.url, USER_CONTEXT, {
      openai,
      dbUserId: DB_USER_ID,
      jobTitle: job.role,
      company: job.company,
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`\n📊 RESULT (${elapsed}s):`);
    console.log(`   Success: ${result.success ? "✅ YES" : "❌ NO"}`);
    console.log(`   Platform: ${result.platform}`);
    console.log(`   Message: ${result.message}`);
    console.log(`   Confirmation: ${result.confirmationDetected || false}`);
    if (result.confirmationText) console.log(`   Confirmation text: ${result.confirmationText}`);
    if (result.stepsCompleted?.length) {
      console.log(`   Steps (${result.stepsCompleted.length}):`);
      for (const s of result.stepsCompleted) console.log(`     - ${s}`);
    }
    if (result.screenshotSteps?.length) {
      console.log(`   Screenshots: ${result.screenshotSteps.length}`);
      // Save screenshots
      const fs = await import("fs");
      const dir = ".test-screenshots";
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const prefix = `${job.name.toLowerCase().replace(/\s+/g, "_")}__api_`;
      for (let i = 0; i < result.screenshotSteps.length; i++) {
        const ss = result.screenshotSteps[i];
        const path = `${dir}/${prefix}step${i + 1}.png`;
        fs.writeFileSync(path, Buffer.from(ss.screenshot, "base64"));
      }
      console.log(`   📸 Screenshots saved to ${dir}/${prefix}*.png`);
    }

    return { name: job.name, platform: job.platform, success: result.success, elapsed, message: result.message, confirmationDetected: result.confirmationDetected };
  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`❌ ERROR (${elapsed}s):`, (err as Error).message);
    return { name: job.name, platform: job.platform, success: false, elapsed, message: (err as Error).message, confirmationDetected: false };
  }
}

async function main() {
  const args = process.argv.slice(2);
  let jobFilter: string | null = null;
  let urlOverride: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--job" && args[i + 1]) jobFilter = args[++i];
    if (args[i] === "--url" && args[i + 1]) urlOverride = args[++i];
  }

  console.log("🧪 Auto-Apply API Route Test");
  console.log(`Time: ${new Date().toISOString()}`);
  console.log(`OpenAI: ${process.env.OPENAI_API_KEY ? "✅" : "❌"}`);
  console.log(`Resume: ${USER_CONTEXT.resumeFilePath}`);
  console.log(`Gmail refresh token: ${process.env.GOOGLE_GMAIL_REFRESH_TOKEN ? "✅" : "❌"}`);

  let jobs = TEST_JOBS;

  if (urlOverride) {
    jobs = [{ name: "Custom", platform: "unknown", url: urlOverride, company: "Custom", role: "Custom Role" }];
  } else if (jobFilter) {
    jobs = TEST_JOBS.filter(j => j.name.toLowerCase().includes(jobFilter!.toLowerCase()) || j.platform.toLowerCase().includes(jobFilter!.toLowerCase()));
    if (jobs.length === 0) {
      console.error(`No jobs matching "${jobFilter}". Available: ${TEST_JOBS.map(j => j.name).join(", ")}`);
      process.exit(1);
    }
  }

  console.log(`\nTesting ${jobs.length} job(s): ${jobs.map(j => `${j.name} (${j.platform})`).join(", ")}\n`);

  const results: Awaited<ReturnType<typeof testJob>>[] = [];
  for (const job of jobs) {
    results.push(await testJob(job));
  }

  // Summary
  console.log(`\n${"=".repeat(70)}`);
  console.log("📊 FINAL SUMMARY");
  console.log(`${"=".repeat(70)}`);
  for (const r of results) {
    const icon = r.success ? "✅" : r.message?.includes("CAPTCHA") ? "🔒" : "❌";
    console.log(`${icon} ${r.name} (${r.platform}): ${r.success ? "PASSED" : "FAILED"} (${r.elapsed}s)`);
    if (!r.success) console.log(`   → ${r.message?.slice(0, 120)}`);
  }
  const passed = results.filter(r => r.success).length;
  console.log(`\n${passed}/${results.length} passed`);

  process.exit(passed === results.length ? 0 : 1);
}

main().catch(console.error);
