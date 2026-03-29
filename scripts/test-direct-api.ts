/**
 * Test direct API submission — no browser needed.
 * Calls the platform-specific API submitters directly.
 *
 * Usage:
 *   npx tsx scripts/test-direct-api.ts --platform greenhouse --url <url>
 *   npx tsx scripts/test-direct-api.ts --platform ashby --url <url>
 *   npx tsx scripts/test-direct-api.ts --platform greenhouse --schema-only --url <url>
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import OpenAI from "openai";
import { applyGreenhouseViaAPI, parseGreenhouseUrl, fetchGreenhouseFormSchema } from "../src/lib/auto-apply/api/greenhouse";
import { applyAshbyViaAPI, parseAshbyUrl, fetchAshbyFormSchema } from "../src/lib/auto-apply/api/ashby";
import { applyAshbyHybrid } from "../src/lib/auto-apply/api/ashby-hybrid";
import { applyLeverViaAPI, parseLeverUrl, fetchLeverFormSchema } from "../src/lib/auto-apply/api/lever";
import type { ApplicantData } from "../src/lib/auto-apply/api/types";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const TEST_APPLICANT: ApplicantData = {
  firstName: "Seun",
  lastName: "Johnson",
  email: "johnsonseun15@gmail.com",
  phone: "501-502-4609",
  linkedIn: "https://linkedin.com/in/sjohnson45",
  location: "San Francisco, CA",
  currentTitle: "Software Engineer",
  yearsExp: "2",
  needsSponsorship: false,
  resumeFilePath: process.env.HOME + "/Library/Mobile Documents/com~apple~CloudDocs/Seun_Johnson_RESUME_Intuit.pdf",
  resumeText: "Software Engineer with experience in full-stack development, React, Node.js, Python, and cloud services.",
};

async function main() {
  const args = process.argv.slice(2);
  const platformIdx = args.indexOf("--platform");
  const urlIdx = args.indexOf("--url");
  const schemaOnly = args.includes("--schema-only");

  const platform = platformIdx >= 0 ? args[platformIdx + 1] : null;
  const url = urlIdx >= 0 ? args[urlIdx + 1] : null;

  if (!platform || !url) {
    console.error("Usage: npx tsx scripts/test-direct-api.ts --platform <greenhouse|ashby> --url <url>");
    process.exit(1);
  }

  console.log(`\n🧪 Direct API Test`);
  console.log(`Platform: ${platform}`);
  console.log(`URL: ${url}`);
  console.log(`Schema only: ${schemaOnly}`);
  console.log(`OpenAI: ✅`);
  console.log(`Resume: ${TEST_APPLICANT.resumeFilePath}\n`);

  const startTime = Date.now();

  try {
    if (platform === "greenhouse") {
      const parsed = parseGreenhouseUrl(url);
      if (!parsed) { console.error("❌ Could not parse Greenhouse URL"); process.exit(1); }

      if (schemaOnly) {
        const schema = await fetchGreenhouseFormSchema(parsed.boardToken, parsed.jobId);
        console.log("\n📋 Form Schema:");
        console.log(`   Board: ${parsed.boardToken}`);
        console.log(`   Job ID: ${parsed.jobId}`);
        console.log(`\n   Standard Fields (${schema.fields.length}):`);
        for (const f of schema.fields) {
          console.log(`     - ${f.id}: "${f.label}" (${f.type}${f.required ? ", required" : ""})`);
        }
        console.log(`\n   Custom Questions (${schema.customQuestions.length}):`);
        for (const q of schema.customQuestions) {
          console.log(`     - ${q.id}: "${q.label}" (${q.type}${q.required ? ", required" : ""})${q.options ? ` [${q.options.join(", ")}]` : ""}`);
        }
        return;
      }

      const result = await applyGreenhouseViaAPI(url, TEST_APPLICANT, openai, "Software Engineer", parsed.boardToken);
      printResult(result, startTime);

    } else if (platform === "ashby") {
      const parsed = parseAshbyUrl(url);
      if (!parsed) { console.error("❌ Could not parse Ashby URL"); process.exit(1); }

      if (schemaOnly) {
        const schema = await fetchAshbyFormSchema(parsed.orgSlug, parsed.jobPostingId);
        console.log("\n📋 Form Schema:");
        console.log(`   Org: ${parsed.orgSlug}`);
        console.log(`   Job ID: ${parsed.jobPostingId}`);
        console.log(`   Ashby Internal ID: ${schema.ashbyJobPostingId}`);
        console.log(`\n   Standard Fields (${schema.fields.length}):`);
        for (const f of schema.fields) {
          console.log(`     - ${f.id}: "${f.label}" (${f.type}${f.required ? ", required" : ""})`);
        }
        console.log(`\n   Custom Questions (${schema.customQuestions.length}):`);
        for (const q of schema.customQuestions) {
          console.log(`     - ${q.id}: "${q.label}" (${q.type}${q.required ? ", required" : ""})${q.options ? ` [${q.options.join(", ")}]` : ""}`);
        }
        return;
      }

      const result = await applyAshbyViaAPI(url, TEST_APPLICANT, openai, "Software Engineer", parsed.orgSlug);
      printResult(result, startTime);

    } else if (platform === "ashby-hybrid") {
      const result = await applyAshbyHybrid(url, TEST_APPLICANT, openai, "Software Engineer", "Replit");
      printResult(result, startTime);

    } else if (platform === "lever") {
      const parsed = parseLeverUrl(url);
      if (!parsed) { console.error("❌ Could not parse Lever URL"); process.exit(1); }

      if (schemaOnly) {
        const schema = await fetchLeverFormSchema(parsed.company, parsed.postingId);
        console.log("\n📋 Form Schema:");
        console.log(`   Company: ${parsed.company}`);
        console.log(`   Posting ID: ${parsed.postingId}`);
        console.log(`\n   Standard Fields (${schema.fields.length}):`);
        for (const f of schema.fields) {
          console.log(`     - ${f.id}: "${f.label}" (${f.type}${f.required ? ", required" : ""})`);
        }
        console.log(`\n   Custom Questions (${schema.customQuestions.length}):`);
        for (const q of schema.customQuestions) {
          console.log(`     - ${q.id}: "${q.label}" (${q.type}${q.required ? ", required" : ""})${q.options ? ` [${q.options.join(", ")}]` : ""}`);
        }
        return;
      }

      const result = await applyLeverViaAPI(url, TEST_APPLICANT, openai, "Software Engineer", parsed.company);
      printResult(result, startTime);

    } else if (platform === "ashby-browser") {
      // Test the schema-driven Ashby browser handler via autoApply (hardcoded path, no AI agent)
      const { autoApply } = await import("../src/lib/auto-apply/index");
      const result = await autoApply(url, {
        firstName: TEST_APPLICANT.firstName,
        lastName: TEST_APPLICANT.lastName,
        email: TEST_APPLICANT.email,
        phone: TEST_APPLICANT.phone,
        linkedIn: TEST_APPLICANT.linkedIn,
        location: TEST_APPLICANT.location,
        currentTitle: TEST_APPLICANT.currentTitle,
        resumeText: TEST_APPLICANT.resumeText || "",
        coverLetterText: "",
        resumeFilePath: TEST_APPLICANT.resumeFilePath,
        jobTitle: "Software Engineer",
        company: "Replit",
      });
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`\n${"=".repeat(60)}`);
      console.log(`📊 RESULT (${elapsed}s):`);
      console.log(`   Success: ${result.success ? "✅ YES" : "❌ NO"}`);
      console.log(`   Platform: ${result.platform}`);
      console.log(`   Message: ${result.message}`);
      console.log(`   Confirmation: ${result.confirmationDetected || false}`);
      if (result.stepsCompleted?.length) {
        console.log(`   Steps:`);
        for (const s of result.stepsCompleted) { console.log(`     - ${s}`); }
      }
      console.log(`${"=".repeat(60)}\n`);

    } else {
      console.error(`❌ Unknown platform: ${platform}. Supported: greenhouse, ashby, ashby-hybrid, ashby-browser, lever`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`\n❌ Error: ${(err as Error).message}`);
    process.exit(1);
  }
}

function printResult(result: any, startTime: number) {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n${"=".repeat(60)}`);
  console.log(`📊 RESULT (${elapsed}s):`);
  console.log(`   Success: ${result.success ? "✅ YES" : "❌ NO"}`);
  console.log(`   Method: ${result.method}`);
  console.log(`   Platform: ${result.platform}`);
  console.log(`   Message: ${result.message}`);
  console.log(`   HTTP Status: ${result.httpStatus || "N/A"}`);
  console.log(`   Fields Submitted: ${result.fieldsSubmitted}`);
  if (result.stepsCompleted?.length > 0) {
    console.log(`   Steps:`);
    for (const s of result.stepsCompleted) {
      console.log(`     - ${s}`);
    }
  }
  if (result.responseBody) {
    console.log(`   Response: ${result.responseBody.slice(0, 300)}`);
  }
  console.log(`${"=".repeat(60)}\n`);
}

main().catch(console.error);
