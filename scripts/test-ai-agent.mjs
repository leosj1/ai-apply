#!/usr/bin/env node
/**
 * End-to-end test for the AI Agent auto-apply.
 * Tests the agent against real job URLs using Playwright + OpenAI GPT-4o.
 * 
 * Usage:
 *   node scripts/test-ai-agent.mjs [--url <url>] [--job-id <id>] [--dry-run]
 * 
 * Options:
 *   --url <url>      Test a specific URL
 *   --job-id <id>    Test a specific job from the database
 *   --dry-run        Only load the page and take a screenshot, don't run the AI agent
 *   --all            Test all 6 platforms
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { chromium } from "playwright-core";

// Test URLs covering different platforms
const TEST_JOBS = [
  {
    name: "Airbnb (Greenhouse embedded)",
    url: "https://careers.airbnb.com/positions/7609564?gh_jid=7609564",
    company: "Airbnb",
    role: "Senior Software Engineer, Network Infrastructure",
    id: "cmlsxx5vo008jyj2dc0bqnec3",
  },
  {
    name: "Mercury (Greenhouse direct)",
    url: "https://job-boards.greenhouse.io/mercury/jobs/5520964004",
    company: "Mercury",
    role: "Senior Backend Engineer - Product",
  },
  {
    name: "Plaid (Lever)",
    url: "https://jobs.lever.co/plaid/9c7b4342-de57-4a74-8ada-9741a07c7b5f",
    company: "Plaid",
    role: "Product Manager",
  },
  {
    name: "Instacart (Greenhouse embedded)",
    url: "https://instacart.careers/job/?gh_jid=7559018",
    company: "Instacart",
    role: "Software Engineering Manager, Database Platform",
  },
  {
    name: "Stripe (Greenhouse embedded)",
    url: "https://stripe.com/jobs/search?gh_jid=6567253",
    company: "Stripe",
    role: "Backend Engineer, Core Tech, Canada",
  },
  {
    name: "Postman (Greenhouse direct)",
    url: "https://job-boards.greenhouse.io/postman/jobs/7528077003",
    company: "Postman",
    role: "Strategic Solutions Engineering",
  },
];

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const testAll = args.includes("--all");
const urlIdx = args.indexOf("--url");
const jobIdIdx = args.indexOf("--job-id");

async function loadPage(url) {
  console.log(`\n🌐 Loading: ${url}`);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  } catch {
    try { await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 }); } catch { /* */ }
  }
  await page.waitForTimeout(3000);
  
  return { browser, context, page };
}

async function getSimplifiedHtml(page) {
  return await page.evaluate(() => {
    const elements = [];
    // Inputs
    document.querySelectorAll("input:not([type='hidden']), textarea, select").forEach(el => {
      const tag = el.tagName.toLowerCase();
      const type = el.getAttribute("type") || (tag === "textarea" ? "textarea" : tag === "select" ? "select" : "text");
      const name = el.getAttribute("name") || "";
      const id = el.getAttribute("id") || "";
      const label = el.getAttribute("aria-label") || el.getAttribute("placeholder") || "";
      elements.push(`<${tag} type="${type}" name="${name}" id="${id}" label="${label}"/>`);
    });
    // Buttons and links
    document.querySelectorAll("button, a[href], input[type='submit']").forEach(el => {
      const tag = el.tagName.toLowerCase();
      const text = el.textContent?.trim().slice(0, 60) || "";
      if (!text) return;
      const href = el.getAttribute("href") || "";
      elements.push(`<${tag} text="${text}" href="${href}"/>`);
    });
    return elements.join("\n");
  });
}

async function testPage(job) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`🧪 Testing: ${job.name}`);
  console.log(`   URL: ${job.url}`);
  console.log(`${"=".repeat(60)}`);
  
  const { browser, context, page } = await loadPage(job.url);
  
  try {
    const title = await page.title();
    const url = page.url();
    console.log(`📄 Title: ${title}`);
    console.log(`📍 Final URL: ${url}`);
    
    // Get page elements
    const html = await getSimplifiedHtml(page);
    const elementCount = html.split("\n").length;
    console.log(`🔍 Found ${elementCount} interactive elements`);
    
    // Check for Apply button
    const applyButton = await page.$('a:has-text("Apply"), button:has-text("Apply"), a:has-text("Apply Now"), button:has-text("Apply Now"), a:has-text("Apply for this"), button:has-text("Apply for this")');
    if (applyButton) {
      const applyText = await applyButton.textContent();
      const applyHref = await applyButton.getAttribute("href");
      console.log(`✅ Found Apply button: "${applyText?.trim()}" → ${applyHref || "(no href)"}`);
      
      // Check if it's visible
      const isVisible = await applyButton.isVisible();
      console.log(`   Visible: ${isVisible}`);
      
      if (!isVisible) {
        // Try scrolling
        try {
          await applyButton.scrollIntoViewIfNeeded();
          await page.waitForTimeout(500);
          const nowVisible = await applyButton.isVisible();
          console.log(`   After scroll: ${nowVisible}`);
        } catch (e) {
          console.log(`   Scroll failed: ${e.message}`);
        }
      }
    } else {
      console.log(`❌ No Apply button found on page`);
      // Check for Greenhouse/Lever links in the HTML
      const ghLinks = await page.$$('a[href*="greenhouse"], a[href*="lever"], a[href*="apply"]');
      if (ghLinks.length > 0) {
        for (const link of ghLinks.slice(0, 3)) {
          const href = await link.getAttribute("href");
          const text = await link.textContent();
          console.log(`   📎 Found link: "${text?.trim()}" → ${href}`);
        }
      }
    }
    
    // Check for iframes
    const iframes = await page.$$("iframe");
    if (iframes.length > 0) {
      console.log(`📦 Found ${iframes.length} iframe(s)`);
      for (const iframe of iframes.slice(0, 3)) {
        const src = await iframe.getAttribute("src");
        console.log(`   src: ${src}`);
      }
    }
    
    // Check for form fields
    const inputs = await page.$$("input:not([type='hidden']), textarea, select");
    console.log(`📝 Form fields: ${inputs.length}`);
    
    // Take screenshot
    const fs = await import("fs");
    const path = await import("path");
    const screenshotDir = path.join(process.cwd(), ".test-screenshots");
    if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
    const safeName = job.name.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
    const ssPath = path.join(screenshotDir, `${safeName}.png`);
    await page.screenshot({ path: ssPath, fullPage: false });
    console.log(`📸 Screenshot saved: ${ssPath}`);
    
    if (dryRun) {
      console.log(`\n⏭️  Dry run — skipping AI agent`);
      return { name: job.name, status: "dry-run", title, elements: elementCount, applyFound: !!applyButton };
    }
    
    // Run the AI agent
    console.log(`\n🤖 Running AI Agent...`);
    const startTime = Date.now();
    
    // Dynamic import of OpenAI
    const { default: OpenAI } = await import("openai");
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    // Dynamic import of AI agent
    // We need to use the compiled version, so let's call the API instead
    // Actually, let's test through the running API server
    console.log(`   Calling API: POST /api/ai/auto-apply { action: "autoApply", jobId: "${job.id || "test"}" }`);
    
    if (!job.id) {
      console.log(`   ⚠️  No job ID — testing page analysis only (not full auto-apply)`);
      
      // Test the page analysis part manually
      const { runAIAgent } = await import("../src/lib/auto-apply/ai-agent.ts");
      // This won't work directly since it's TypeScript, so let's use the API
      console.log(`   ℹ️  Use the API endpoint to test full auto-apply. Add the job first.`);
      return { name: job.name, status: "no-job-id", title, elements: elementCount, applyFound: !!applyButton };
    }
    
    // Test via the running API
    const apiUrl = "http://localhost:3003/api/ai/auto-apply";
    try {
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "autoApply", jobId: job.id }),
      });
      const data = await res.json();
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      
      console.log(`\n📊 Result (${elapsed}s):`);
      console.log(`   Success: ${data.success}`);
      console.log(`   Platform: ${data.platform}`);
      console.log(`   Message: ${data.message?.slice(0, 200)}`);
      console.log(`   Steps: ${data.stepsCompleted?.length || 0}`);
      if (data.stepsCompleted) {
        data.stepsCompleted.forEach((s, i) => console.log(`     ${i + 1}. ${s}`));
      }
      console.log(`   Screenshots: ${data.screenshotSteps?.length || 0}`);
      console.log(`   Confirmation: ${data.confirmationDetected}`);
      
      return { name: job.name, status: data.success ? "success" : "failed", message: data.message, steps: data.stepsCompleted?.length || 0, elapsed };
    } catch (apiErr) {
      console.log(`   ❌ API call failed: ${apiErr.message}`);
      console.log(`   Make sure the dev server is running on port 3003 and you're authenticated.`);
      return { name: job.name, status: "api-error", message: apiErr.message };
    }
    
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log("🧪 AI Agent End-to-End Test");
  console.log(`Mode: ${dryRun ? "DRY RUN (page analysis only)" : "FULL TEST (AI agent)"}`);
  console.log(`Time: ${new Date().toISOString()}\n`);
  
  let jobsToTest = [];
  
  if (urlIdx >= 0 && args[urlIdx + 1]) {
    jobsToTest = [{ name: "Custom URL", url: args[urlIdx + 1], company: "Test", role: "Test" }];
  } else if (jobIdIdx >= 0 && args[jobIdIdx + 1]) {
    const targetId = args[jobIdIdx + 1];
    const found = TEST_JOBS.find(j => j.id === targetId);
    if (found) {
      jobsToTest = [found];
    } else {
      console.log(`Job ID ${targetId} not in test list. Testing via API...`);
      jobsToTest = [{ name: `Job ${targetId}`, url: "", company: "Unknown", role: "Unknown", id: targetId }];
    }
  } else if (testAll) {
    jobsToTest = TEST_JOBS;
  } else {
    // Default: test the Airbnb job (the one that failed)
    jobsToTest = [TEST_JOBS[0]];
  }
  
  const results = [];
  for (const job of jobsToTest) {
    if (!job.url && !job.id) {
      console.log(`⚠️  Skipping ${job.name} — no URL or ID`);
      continue;
    }
    try {
      const result = await testPage(job);
      results.push(result);
    } catch (err) {
      console.error(`❌ Error testing ${job.name}: ${err.message}`);
      results.push({ name: job.name, status: "error", message: err.message });
    }
  }
  
  // Summary
  console.log(`\n${"=".repeat(60)}`);
  console.log("📊 TEST SUMMARY");
  console.log(`${"=".repeat(60)}`);
  results.forEach(r => {
    const icon = r.status === "success" ? "✅" : r.status === "dry-run" ? "⏭️" : "❌";
    console.log(`${icon} ${r.name}: ${r.status}${r.message ? ` — ${r.message?.slice(0, 100)}` : ""}`);
  });
  console.log();
}

main().catch(console.error);
