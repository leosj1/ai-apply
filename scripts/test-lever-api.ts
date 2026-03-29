/**
 * Test Lever direct API submission (no browser, no hCaptcha).
 * Uses applyLeverViaAPI which scrapes card fields and POSTs to api.lever.co.
 */
import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local", override: true });

import { applyLeverViaAPI } from "../src/lib/auto-apply/api/lever";

const TEST_URL = process.argv[2] || "https://jobs.lever.co/plaid/cdfaadbd-7cae-479c-94fc-538a610cf4f0";

async function main() {
  console.log("=== Lever Direct API Test (no browser, no hCaptcha) ===\n");
  console.log("URL:", TEST_URL);

  const result = await Promise.race([
    applyLeverViaAPI(TEST_URL, {
      firstName: "Seun",
      lastName: "Johnson",
      email: "johnsonseun15@gmail.com",
      phone: "5015024609",
      currentTitle: "Senior Software Engineer",
      linkedIn: "https://linkedin.com/in/seunjohnson",
      resumeFilePath: "/Users/sjohnson45/Library/Mobile Documents/com~apple~CloudDocs/Seun_Johnson_RESUME_Intuit.pdf",
    }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Timeout after 30s")), 30000)),
  ]);

  console.log("\nResult:", JSON.stringify(result, null, 2));
  console.log(result.success ? "\n✅ SUCCESS" : "\n❌ FAILED");
  process.exit(result.success ? 0 : 1);
}

main().catch(e => { console.error(e.message); process.exit(1); });
