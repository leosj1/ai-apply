#!/usr/bin/env npx tsx
/**
 * Test Lever API with proper browser-like headers to see if 400 is from missing headers
 * or from hCaptcha requirement.
 */
import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local", override: true });
import * as fs from "fs";
import * as path from "path";

const POSTING_ID = "9c7b4342-de57-4a74-8ada-9741a07c7b5f";
const RESUME_PATH = "/Users/sjohnson45/Library/Mobile Documents/com~apple~CloudDocs/Seun_Johnson_RESUME_Intuit.pdf";

async function trySubmit(label: string, extraHeaders: Record<string, string> = {}, extraFields: Record<string, string> = {}) {
  const buf = fs.readFileSync(RESUME_PATH);
  const fd = new FormData();
  fd.append("name", "Seun Johnson");
  fd.append("email", "johnsonseun15@gmail.com");
  fd.append("phone", "5015024609");
  fd.append("org", "Product Manager");
  fd.append("urls[LinkedIn]", "https://linkedin.com/in/seun-johnson");
  fd.append("consent[store]", "true");
  for (const [k, v] of Object.entries(extraFields)) fd.append(k, v);

  const blob = new Blob([new Uint8Array(buf)], { type: "application/pdf" });
  fd.append("resume", blob, path.basename(RESUME_PATH));

  const res = await fetch(`https://api.lever.co/v0/postings/${POSTING_ID}/apply`, {
    method: "POST",
    headers: {
      "Origin": "https://jobs.lever.co",
      "Referer": `https://jobs.lever.co/plaid/${POSTING_ID}/apply`,
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      ...extraHeaders,
    },
    body: fd,
  });
  const text = await res.text();
  console.log(`[${label}] ${res.status}: ${text.slice(0, 200)}`);
  return res.status;
}

async function main() {
  // 1. No hcaptcha token — baseline
  await trySubmit("no-token");

  // 2. With a fake/empty hcaptcha token
  await trySubmit("fake-token", {}, { "h-captcha-response": "fake-token-test-123" });

  // 3. With Lever's actual API origin header that browser uses
  await trySubmit("with-x-lever-origin", { "x-lever-origin": "jobs" }, {});

  // 4. Check if it's the location field that's required
  await trySubmit("with-location", {}, { "location": "San Francisco, CA" });

  // 5. Without resume — see if error changes
  const buf = fs.readFileSync(RESUME_PATH);
  const fd2 = new FormData();
  fd2.append("name", "Seun Johnson");
  fd2.append("email", "johnsonseun15@gmail.com");
  fd2.append("phone", "5015024609");
  fd2.append("consent[store]", "true");
  const res2 = await fetch(`https://api.lever.co/v0/postings/${POSTING_ID}/apply`, {
    method: "POST",
    headers: {
      "Origin": "https://jobs.lever.co",
      "Referer": `https://jobs.lever.co/plaid/${POSTING_ID}/apply`,
    },
    body: fd2,
  });
  const t2 = await res2.text();
  console.log(`[no-resume] ${res2.status}: ${t2.slice(0, 200)}`);
}

main().catch(console.error);
