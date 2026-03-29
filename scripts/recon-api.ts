/**
 * API Recon Script — Intercepts all network requests during a browser session
 * to reverse-engineer the API endpoints each ATS platform uses.
 *
 * Usage: npx tsx scripts/recon-api.ts --url <job_url>
 *
 * Outputs:
 *  - All XHR/fetch requests with method, URL, headers, body
 *  - Cookies set during the session
 *  - Auth tokens (Bearer, CSRF, etc.)
 */

import { config } from "dotenv";
config({ path: ".env.local" });

interface CapturedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  postData?: string;
  resourceType: string;
  timestamp: number;
}

interface CapturedResponse {
  url: string;
  status: number;
  headers: Record<string, string>;
  body?: string;
  timestamp: number;
}

async function main() {
  const args = process.argv.slice(2);
  const urlIdx = args.indexOf("--url");
  const url = urlIdx >= 0 ? args[urlIdx + 1] : null;

  if (!url) {
    console.error("Usage: npx tsx scripts/recon-api.ts --url <job_url>");
    process.exit(1);
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { chromium } = require("playwright-core");

  console.log(`\n🔍 API Recon for: ${url}\n`);

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
  });

  const page = await context.newPage();

  const capturedRequests: CapturedRequest[] = [];
  const capturedResponses: CapturedResponse[] = [];
  const authTokens: Record<string, string> = {};

  // Intercept all requests
  page.on("request", (req: any) => {
    const reqUrl = req.url();
    const method = req.method();
    const resourceType = req.resourceType();

    // Skip static assets
    if (["image", "font", "stylesheet", "media"].includes(resourceType)) return;

    const headers = req.headers();
    const captured: CapturedRequest = {
      method,
      url: reqUrl,
      headers,
      resourceType,
      timestamp: Date.now(),
    };

    // Capture POST/PUT/PATCH body
    if (["POST", "PUT", "PATCH"].includes(method)) {
      try {
        captured.postData = req.postData()?.slice(0, 5000);
      } catch { /* */ }
    }

    // Extract auth tokens
    if (headers["authorization"]) {
      authTokens["Authorization"] = headers["authorization"];
    }
    if (headers["x-csrf-token"]) {
      authTokens["X-CSRF-Token"] = headers["x-csrf-token"];
    }
    if (headers["x-xsrf-token"]) {
      authTokens["X-XSRF-Token"] = headers["x-xsrf-token"];
    }

    capturedRequests.push(captured);
  });

  // Intercept responses for API calls
  page.on("response", async (res: any) => {
    const resUrl = res.url();
    const status = res.status();

    // Only capture API-like responses (JSON, not static)
    const contentType = res.headers()["content-type"] || "";
    if (!contentType.includes("json") && !contentType.includes("graphql")) return;

    const captured: CapturedResponse = {
      url: resUrl,
      status,
      headers: res.headers(),
      timestamp: Date.now(),
    };

    try {
      const body = await res.text();
      captured.body = body?.slice(0, 3000);
    } catch { /* */ }

    capturedResponses.push(captured);
  });

  // Navigate to the page
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  } catch {
    try { await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 }); } catch { /* */ }
  }

  // Wait for SPA to render
  await page.waitForTimeout(5000);

  // Try clicking "Apply" button if visible
  const applyBtn = await page.$('a:has-text("Apply"), button:has-text("Apply"), a:has-text("Apply Now"), button:has-text("Apply Now")');
  if (applyBtn) {
    console.log("📌 Found Apply button — clicking...");
    await applyBtn.click().catch(() => {});
    await page.waitForTimeout(5000);
  }

  // Capture cookies
  const cookies = await context.cookies();

  // Get page title and URL
  const pageTitle = await page.title().catch(() => "");
  const pageUrl = page.url();

  await browser.close();

  // ── Output Results ──

  console.log(`\n📄 Page: ${pageTitle}`);
  console.log(`🔗 Final URL: ${pageUrl}`);

  // Auth tokens
  console.log(`\n🔑 Auth Tokens Found: ${Object.keys(authTokens).length}`);
  for (const [key, val] of Object.entries(authTokens)) {
    console.log(`   ${key}: ${val.slice(0, 80)}...`);
  }

  // Cookies (filter to relevant ones)
  const relevantCookies = cookies.filter((c: any) =>
    c.name.match(/token|session|csrf|auth|xsrf|jwt|sid|_at/i)
  );
  console.log(`\n🍪 Relevant Cookies: ${relevantCookies.length}`);
  for (const c of relevantCookies) {
    console.log(`   ${c.name} = ${String(c.value).slice(0, 60)}... (domain: ${c.domain})`);
  }

  // API requests (POST/PUT/PATCH only — these are the submission endpoints)
  const apiRequests = capturedRequests.filter(r =>
    ["POST", "PUT", "PATCH"].includes(r.method) ||
    (r.resourceType === "xhr" || r.resourceType === "fetch")
  );

  console.log(`\n📡 API Requests: ${apiRequests.length}`);
  const uniqueEndpoints = new Map<string, CapturedRequest[]>();
  for (const req of apiRequests) {
    const key = `${req.method} ${new URL(req.url).pathname}`;
    if (!uniqueEndpoints.has(key)) uniqueEndpoints.set(key, []);
    uniqueEndpoints.get(key)!.push(req);
  }

  for (const [endpoint, reqs] of uniqueEndpoints) {
    const first = reqs[0];
    console.log(`\n   ── ${endpoint} (${reqs.length}x) ──`);
    console.log(`   Full URL: ${first.url.slice(0, 200)}`);
    console.log(`   Content-Type: ${first.headers["content-type"] || "none"}`);
    if (first.postData) {
      console.log(`   Body: ${first.postData.slice(0, 500)}`);
    }
  }

  // JSON API responses
  const apiResponses = capturedResponses.filter(r => r.status >= 200 && r.status < 400);
  console.log(`\n📥 API Responses (2xx/3xx): ${apiResponses.length}`);
  const uniqueRespEndpoints = new Map<string, CapturedResponse>();
  for (const res of apiResponses) {
    const key = new URL(res.url).pathname;
    if (!uniqueRespEndpoints.has(key)) uniqueRespEndpoints.set(key, res);
  }

  for (const [path, res] of uniqueRespEndpoints) {
    console.log(`\n   ── ${res.status} ${path} ──`);
    if (res.body) {
      // Try to parse and pretty-print JSON
      try {
        const json = JSON.parse(res.body);
        const keys = Object.keys(json);
        console.log(`   Keys: ${keys.join(", ")}`);
        // Show structure for arrays
        if (Array.isArray(json)) {
          console.log(`   Array of ${json.length} items`);
          if (json[0]) console.log(`   First item keys: ${Object.keys(json[0]).join(", ")}`);
        }
      } catch {
        console.log(`   Body (raw): ${res.body.slice(0, 300)}`);
      }
    }
  }

  console.log("\n✅ Recon complete.\n");
}

main().catch(console.error);
