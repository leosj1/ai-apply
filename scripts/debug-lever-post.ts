// Debug: Intercept Lever form POST to check h-captcha-response token + server response
import "dotenv/config";
import { chromium } from "playwright-core";
import { detectCaptcha, solveCaptcha } from "../src/lib/auto-apply/captcha/solver";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Intercept ALL requests to see what's being submitted
  const posts: Array<{ url: string; body: string; status: number; response: string }> = [];
  await page.route("**/*", async (route: any) => {
    const req = route.request();
    if (req.method() === "POST" && req.url().includes("lever.co")) {
      const body = req.postData() || "";
      console.log(`\n📤 POST ${req.url().slice(0, 80)}`);
      console.log(`   Body length: ${body.length}`);
      console.log(`   Has h-captcha-response: ${body.includes("h-captcha-response")}`);
      console.log(`   Has g-recaptcha-response: ${body.includes("g-recaptcha-response")}`);
      // Log first 500 chars of body
      console.log(`   Body preview: ${body.slice(0, 500)}`);

      const response = await route.fetch();
      const respBody = await response.text().catch(() => "(no body)");
      const status = response.status();
      console.log(`📥 Response: ${status}`);
      console.log(`   Body: ${respBody.slice(0, 500)}`);
      posts.push({ url: req.url(), body: body.slice(0, 200), status, response: respBody.slice(0, 300) });
      await route.fulfill({ response });
    } else {
      await route.continue();
    }
  });

  console.log("Loading Plaid apply page...");
  await page.goto("https://jobs.lever.co/plaid/9c7b4342-de57-4a74-8ada-9741a07c7b5f/apply", {
    waitUntil: "domcontentloaded", timeout: 20000
  });
  await page.waitForTimeout(3000);
  console.log("Page loaded:", page.url());

  // Fill form
  console.log("\nFilling form...");
  await page.fill('input[name="name"]', "Test User").catch(() => {});
  await page.fill('input[name="email"]', "test@example.com").catch(() => {});
  await page.fill('input[name="phone"]', "5555555555").catch(() => {});

  // Select location
  await page.selectOption('select[name="opportunityLocationId"]', { index: 1 }).catch(() => {});

  // Click radio buttons via JS
  await page.evaluate(() => {
    document.querySelectorAll("input[type='radio']").forEach((r: any) => {
      if (!r.checked && r.value === "No") {
        r.checked = true;
        r.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
  });

  // Upload resume
  const fileInput = await page.$('input[type="file"]');
  if (fileInput) {
    await fileInput.setInputFiles("/Users/sjohnson45/Library/Mobile Documents/com~apple~CloudDocs/Seun_Johnson_RESUME.pdf").catch(() =>
      console.log("  Resume upload failed")
    );
    await page.waitForTimeout(2000);
  }

  // Check hCaptcha config before solving
  const hcConfig = await page.evaluate(() => {
    const containers = document.querySelectorAll(".h-captcha, [data-sitekey]");
    const info: any[] = [];
    containers.forEach((c: any) => {
      info.push({
        tag: c.tagName,
        sitekey: c.getAttribute("data-sitekey"),
        size: c.getAttribute("data-size"),
        callback: c.getAttribute("data-callback"),
        insideForm: !!c.closest("form"),
        allAttrs: Array.from(c.attributes).map((a: any) => `${a.name}=${a.value}`)
      });
    });
    // Check textareas
    const textareas: any[] = [];
    document.querySelectorAll("textarea").forEach((t: any) => {
      if (t.name.includes("captcha") || t.name.includes("response")) {
        textareas.push({ name: t.name, insideForm: !!t.closest("form") });
      }
    });
    return { containers: info, textareas };
  });
  console.log("\nhCaptcha config:", JSON.stringify(hcConfig, null, 2));

  // Solve hCaptcha
  console.log("\nSolving hCaptcha...");
  const result = await solveCaptcha(page);
  console.log("Solve result:", { success: result.success, type: result.type, solveTimeMs: result.solveTimeMs, tokenLen: result.token?.length, error: result.error });

  if (!result.success) {
    console.log("❌ Solve failed");
    await browser.close();
    return;
  }

  // Check what's in the form before submit
  const preSubmit = await page.evaluate(() => {
    const form = document.querySelector("form");
    if (!form) return { formFound: false };
    const formData = new FormData(form);
    const fields: Record<string, string> = {};
    formData.forEach((v, k) => {
      fields[k] = String(v).slice(0, 60);
    });
    return { formFound: true, fields, fieldCount: Object.keys(fields).length };
  });
  console.log("\nPre-submit form data:", JSON.stringify(preSubmit, null, 2));

  // Submit via button click
  console.log("\nSubmitting via button click...");
  await page.click('button[type="submit"]').catch(async () => {
    console.log("  Button click failed, trying JS submit...");
    await page.evaluate(() => {
      const form = document.querySelector("form") as HTMLFormElement;
      if (form) HTMLFormElement.prototype.submit.call(form);
    });
  });

  await page.waitForTimeout(8000);

  console.log("\n=== INTERCEPTED POSTS ===");
  posts.forEach((p, i) => console.log(`${i}: ${p.status} ${p.url.slice(0, 80)} | body has token: ${p.body.includes("captcha")}`));

  const currentUrl = page.url();
  const pageText = await page.evaluate(() => document.body?.innerText?.slice(0, 300) || "");
  console.log("\nFinal URL:", currentUrl);
  console.log("Page text:", pageText.slice(0, 200));

  await page.screenshot({ path: "/tmp/debug-lever-post.png", fullPage: true });
  console.log("Screenshot: /tmp/debug-lever-post.png");
  await browser.close();
}

main().catch(console.error);
