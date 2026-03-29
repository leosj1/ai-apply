#!/usr/bin/env npx tsx
/**
 * Test Workday via Claude AI agent.
 * Workday requires account creation — this tests the agent's navigation ability.
 */

import * as path from "path";
import * as fs from "fs";
import * as dotenv from "dotenv";
dotenv.config({ path: path.join(__dirname, "..", ".env.local") });

const RESUME_PATH = process.env.RESUME_PDF_PATH || path.join(__dirname, "..", "resume.pdf");

async function main() {
  console.log("=== Workday E2E — Claude AI Agent ===\n");

  // Create Claude client
  let aiClient: { provider: "claude" | "openai"; client: any };
  if (process.env.ANTHROPIC_API_KEY) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Anthropic = require("@anthropic-ai/sdk").default || require("@anthropic-ai/sdk");
    aiClient = { provider: "claude", client: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) };
    console.log("🤖 AI Provider: Claude");
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const OpenAI = require("openai").default || require("openai");
    aiClient = { provider: "openai", client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) };
    console.log("🤖 AI Provider: OpenAI (fallback)");
  }

  // NVIDIA Workday job
  const jobUrl = "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite";
  console.log(`📋 Testing Workday: NVIDIA\n   URL: ${jobUrl}\n`);

  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  try {
    // Import and run the AI agent
    const { runAIAgent } = await import("../src/lib/auto-apply/agent/index");

    const agentContext = {
      firstName: "Seun",
      lastName: "Johnson",
      email: "johnsonseun15@gmail.com",
      phone: "5015024609",
      linkedIn: "https://linkedin.com/in/seunjohnson",
      location: "Oakland, CA",
      currentTitle: "Software Engineer",
      yearsExp: "3",
      needsSponsorship: false,
      resumeText: "Experienced software engineer with TypeScript, React, Node.js, Python.",
      coverLetterText: "",
      resumeFilePath: fs.existsSync(RESUME_PATH) ? RESUME_PATH : undefined,
    };

    console.log("🚀 Running Claude AI agent...\n");
    const startTime = Date.now();

    const result = await runAIAgent(
      aiClient,
      page,
      agentContext,
      jobUrl,
      "Software Engineer",
      "NVIDIA",
      context,
    );

    const elapsed = Math.round((Date.now() - startTime) / 1000);

    // Save screenshot
    try {
      const ssPath = path.join(__dirname, "proof-screenshots", "claude-workday-nvidia-final.png");
      await page.screenshot({ path: ssPath, fullPage: true });
      console.log(`\n📸 Final screenshot: ${ssPath}`);
    } catch { /* */ }

    console.log("\n=== Results ===");
    console.log(`Platform:   ${result.platform}`);
    console.log(`AI:         ${aiClient.provider}`);
    console.log(`Success:    ${result.success ? "✅ YES" : "❌ NO"}`);
    console.log(`Message:    ${result.message}`);
    console.log(`Steps:      ${result.stepsCompleted?.length || 0}`);
    console.log(`Iterations: ${result.iterationsUsed || "N/A"}`);
    console.log(`Time:       ${elapsed}s`);

  } catch (err) {
    console.error("\n❌ Error:", (err as Error).message);
    try {
      const ssPath = path.join(__dirname, "proof-screenshots", "claude-workday-error.png");
      await page.screenshot({ path: ssPath, fullPage: true });
    } catch { /* */ }
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

main().catch(console.error);
