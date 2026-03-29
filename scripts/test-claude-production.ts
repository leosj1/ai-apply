#!/usr/bin/env npx tsx
/**
 * Test Greenhouse E2E using the ACTUAL production applyGreenhouseHybrid.
 * This imports the real production code — same path as the API route.
 * 
 * Usage: npx tsx scripts/test-claude-production.ts
 */

import * as path from "path";
import * as fs from "fs";
import * as dotenv from "dotenv";
dotenv.config({ path: path.join(__dirname, "..", ".env.local") });

import { parseGreenhouseUrl, applyGreenhouseHybrid, discoverBoardToken } from "../src/lib/auto-apply/api/greenhouse";
import type { ApplicantData } from "../src/lib/auto-apply/api/types";

const SS_DIR = path.join(__dirname, "proof-screenshots");
if (!fs.existsSync(SS_DIR)) fs.mkdirSync(SS_DIR, { recursive: true });

const RESUME_PATH = process.env.RESUME_PDF_PATH || path.join(__dirname, "..", "resume.pdf");

const APPLICANT: ApplicantData = {
  firstName: "Seun",
  lastName: "Johnson",
  email: "johnsonseun15@gmail.com",
  phone: "5015024609",
  linkedIn: "https://linkedin.com/in/seunjohnson",
  location: "Oakland, CA",
  currentTitle: "Software Engineer",
  yearsExp: "3",
  needsSponsorship: false,
  resumeText: "Experienced software engineer with expertise in TypeScript, React, Node.js, Python. Built scalable web applications and APIs. Proficient in cloud infrastructure (AWS, GCP), databases (PostgreSQL, MongoDB), and CI/CD pipelines.",
  coverLetterText: "",
  resumeFilePath: fs.existsSync(RESUME_PATH) ? RESUME_PATH : undefined,
};

function createAIClient() {
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Anthropic = require("@anthropic-ai/sdk").default || require("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      console.log("🤖 AI Provider: Claude (Anthropic)");
      return { provider: "claude" as const, client };
    } catch (err) {
      console.log(`⚠️ Claude init failed: ${(err as Error).message}`);
    }
  }
  if (process.env.OPENAI_API_KEY) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const OpenAI = require("openai").default || require("openai");
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    console.log("🤖 AI Provider: OpenAI (fallback)");
    return { provider: "openai" as const, client };
  }
  return null;
}

async function main() {
  console.log("=== Greenhouse E2E — Production Code Path (Claude) ===\n");

  const aiClient = createAIClient();
  if (!aiClient) {
    console.error("❌ No AI API key");
    process.exit(1);
  }

  // Find a live job
  console.log("📋 Finding live Greenhouse job...");
  const companies = [
    { name: "Discord", token: "discord" },
    { name: "Figma", token: "figma" },
  ];

  let selectedJob: { company: string; boardToken: string; jobId: string; title: string } | null = null;
  for (const co of companies) {
    try {
      const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${co.token}/jobs`);
      const data = await res.json();
      const jobs = (data.jobs || []) as { id: number; title: string }[];
      if (jobs.length > 0) {
        const job = jobs.find((j: { title: string }) => !j.title.includes("Japan") && !j.title.includes("Korea") && !j.title.includes("中")) || jobs[0];
        selectedJob = { company: co.name, boardToken: co.token, jobId: String(job.id), title: job.title };
        break;
      }
    } catch { /* skip */ }
  }

  if (!selectedJob) {
    console.error("❌ No live jobs found");
    process.exit(1);
  }

  console.log(`✅ ${selectedJob.title} at ${selectedJob.company}`);
  console.log(`   Board: ${selectedJob.boardToken}, Job ID: ${selectedJob.jobId}\n`);

  // Launch browser
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  // Set up S3 route interception for resume uploads
  if (APPLICANT.resumeFilePath) {
    try {
      const { setupS3RouteInterception } = await import("../src/lib/auto-apply/agent/preprocessing");
      await setupS3RouteInterception(page, APPLICANT.resumeFilePath);
      console.log("📎 S3 route interception set up for resume upload");
    } catch (err) {
      console.log(`⚠️ S3 interception setup failed: ${(err as Error).message?.slice(0, 60)}`);
    }
  }

  const startTime = Date.now();

  try {
    console.log("🚀 Running production applyGreenhouseHybrid...\n");

    const result = await applyGreenhouseHybrid(
      page,
      selectedJob.boardToken,
      selectedJob.jobId,
      APPLICANT,
      aiClient,  // This is the Claude AI client
      selectedJob.title,
      selectedJob.company,
    );

    const elapsed = Math.round((Date.now() - startTime) / 1000);

    // Save final screenshot
    try {
      const ssPath = path.join(SS_DIR, `claude-gh-${selectedJob.boardToken}-${selectedJob.jobId}-final.png`);
      await page.screenshot({ path: ssPath, fullPage: true });
      console.log(`\n📸 Final screenshot: ${ssPath}`);
    } catch { /* */ }

    console.log("\n=== Results ===");
    console.log(`Company:    ${selectedJob.company}`);
    console.log(`Job:        ${selectedJob.title}`);
    console.log(`AI:         ${aiClient.provider}`);
    console.log(`Success:    ${result.success ? "✅ YES" : "❌ NO"}`);
    console.log(`Message:    ${result.message}`);
    console.log(`Steps:      ${result.stepsCompleted?.length || 0}`);
    console.log(`Time:       ${elapsed}s`);

    if (result.stepsCompleted?.length) {
      console.log("\nSteps completed:");
      result.stepsCompleted.forEach((s: string) => console.log(`  - ${s}`));
    }

    if (result.message?.includes("security code")) {
      console.log("\n⚠️ Security code needed — production code handles this via Gmail API");
      console.log("   In production, the AI agent picks up from here and enters the code.");
    }

  } catch (err) {
    console.error("\n❌ Error:", (err as Error).message);
    try {
      const ssPath = path.join(SS_DIR, `claude-gh-error.png`);
      await page.screenshot({ path: ssPath, fullPage: true });
      console.log(`📸 Error screenshot: ${ssPath}`);
    } catch { /* */ }
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

main().catch(console.error);
