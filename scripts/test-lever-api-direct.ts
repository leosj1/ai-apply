#!/usr/bin/env npx tsx
import "dotenv/config";
import { applyLeverViaAPI } from "../src/lib/auto-apply/api/lever";

async function main() {
  const fs = await import("fs");
  const path = await import("path");
  const resumePath = "/Users/sjohnson45/Library/Mobile Documents/com~apple~CloudDocs/Seun_Johnson_RESUME_Intuit.pdf";
  const buf = fs.readFileSync(resumePath);

  // Find a Lever job without hCaptcha enabled to test API path works at all
  // Search for a small company on Lever
  const testJobs = [
    { name: "Plaid PM", id: "9c7b4342-de57-4a74-8ada-9741a07c7b5f" },
  ];

  for (const job of testJobs) {
    console.log(`\nTesting: ${job.name} (${job.id})`);
    
    // Check if captcha is required
    const captchaCheck = await fetch(`https://api.lever.co/v0/postings/${job.id}`).then(r => r.json()) as any;
    console.log(`  hasValidCaptcha: ${captchaCheck.hasValidCaptcha}`);
    console.log(`  urls:`, captchaCheck.urls);
    
    const fd = new FormData();
    fd.append("name", "Seun Johnson");
    fd.append("email", "johnsonseun15@gmail.com");
    fd.append("phone", "5015024609");
    fd.append("consent[store]", "true");
    const blob = new Blob([new Uint8Array(buf)], { type: "application/pdf" });
    fd.append("resume", blob, path.basename(resumePath));

    const res = await fetch(`https://api.lever.co/v0/postings/${job.id}/apply`, {
      method: "POST",
      body: fd,
    });
    const text = await res.text();
    console.log(`  POST status: ${res.status}`);
    console.log(`  Response: ${text.slice(0, 300)}`);
  }
}

main().catch(console.error);
