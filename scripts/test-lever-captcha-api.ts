/**
 * Test: solve hCaptcha via Anti-Captcha (no browser), then POST to Lever API.
 * Answers: does Lever accept an Anti-Captcha token on the API endpoint?
 */
import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local", override: true });

import FormData from "form-data";
import fs from "fs";
import https from "https";

const ANTICAPTCHA_API = "https://api.anti-captcha.com";
const apiKey = process.env.ANTICAPTCHA_API_KEY!;
const sitekey = "e33f87f8-88ec-4e1a-9a13-df9bbb1d8120";
const pageUrl = "https://jobs.lever.co/plaid/cdfaadbd-7cae-479c-94fc-538a610cf4f0/apply";
const postingId = "cdfaadbd-7cae-479c-94fc-538a610cf4f0";

async function solveHCaptcha(): Promise<string | null> {
  console.log("Creating Anti-Captcha task...");
  const createRes = await fetch(`${ANTICAPTCHA_API}/createTask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientKey: apiKey,
      task: {
        type: "HCaptchaTaskProxyless",
        websiteURL: pageUrl,
        websiteKey: sitekey,
        isEnterprise: false,
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      },
    }),
  });
  const createData = await createRes.json() as any;
  if (createData.errorId) { console.log("Create error:", createData.errorCode); return null; }
  const taskId = createData.taskId;
  console.log(`Task ${taskId} created — polling...`);

  for (let i = 0; i < 24; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const pollRes = await fetch(`${ANTICAPTCHA_API}/getTaskResult`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientKey: apiKey, taskId }),
    });
    const pollData = await pollRes.json() as any;
    process.stdout.write(`  [${(i + 1) * 5}s] ${pollData.status} `);
    if (pollData.status === "ready") {
      const token = pollData.solution?.gRecaptchaResponse || pollData.solution?.token;
      console.log(`\n✅ Token obtained (len=${token?.length})`);
      return token;
    }
    if (pollData.errorId) { console.log(`\n❌ Poll error: ${pollData.errorCode}`); return null; }
    console.log("...");
  }
  console.log("\n⏱ Timeout");
  return null;
}

function leverPost(fields: Record<string, string>, token: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    Object.entries(fields).forEach(([k, v]) => form.append(k, v));
    form.append("h-captcha-response", token);
    form.append("g-recaptcha-response", token);
    form.append("resume", fs.createReadStream("/Users/sjohnson45/Library/Mobile Documents/com~apple~CloudDocs/Seun_Johnson_RESUME_Intuit.pdf"), "resume.pdf");
    const req = https.request(
      `https://api.lever.co/v0/postings/${postingId}/apply`,
      { method: "POST", headers: form.getHeaders() },
      (res) => {
        let d = "";
        res.on("data", c => d += c);
        res.on("end", () => resolve({ status: res.statusCode!, body: d }));
      }
    );
    req.on("error", reject);
    form.pipe(req);
  });
}

async function main() {
  console.log("=== Lever API + Anti-Captcha Token Test ===\n");

  const token = await Promise.race([
    solveHCaptcha(),
    new Promise<null>(r => setTimeout(() => { console.log("\n⏱ Hard timeout 130s"); r(null); }, 130000)),
  ]);

  if (!token) { console.log("No token — aborting"); process.exit(1); }

  console.log("\nSubmitting to Lever API with token...");
  const result = await leverPost({
    name: "Seun Johnson",
    email: "johnsonseun15@gmail.com",
    phone: "5015024609",
    org: "Intuit",
    "urls[LinkedIn]": "https://linkedin.com/in/seunjohnson",
    "cards[ed7cf2a4-a23a-4290-83db-02a2adcb9953][field0]": "No",
    "cards[3a8b060f-5ed2-4beb-b328-2de5943895e0][field0]": "No",
    "cards[983f4ffb-dd4f-48b0-871c-05c79c3433b9][field0]": "No",
    "consent[store]": "true",
    "consent[marketing]": "false",
  }, token);

  console.log("Status:", result.status);
  console.log("Body:", result.body);
  console.log(result.status === 200 ? "\n✅ SUCCESS — token accepted!" : "\n❌ Token rejected");
  process.exit(result.status === 200 ? 0 : 1);
}

main().catch(e => { console.error(e.message); process.exit(1); });
