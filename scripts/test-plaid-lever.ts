/**
 * Focused test: Fill Plaid's Lever form + inject hCaptcha token + submit
 * Fills ALL required fields including custom card questions before solving CAPTCHA.
 */
import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local", override: true });

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chromium } = require("playwright-extra");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
chromium.use(StealthPlugin());

import { detectCaptcha, solveCaptcha, installHCaptchaCapture } from "../src/lib/auto-apply/captcha/solver";

const urlArg = process.argv.find(a => a.startsWith("--url="))?.slice(6) || process.argv[process.argv.indexOf("--url") + 1];
const TEST_URL = (urlArg && !urlArg.startsWith("--")) ? (urlArg.endsWith("/apply") ? urlArg : urlArg + "/apply") : "https://jobs.lever.co/plaid/9c7b4342-de57-4a74-8ada-9741a07c7b5f/apply";
const RESUME_PATH = "/Users/sjohnson45/Library/Mobile Documents/com~apple~CloudDocs/Seun_Johnson_RESUME_Intuit.pdf";

async function main() {
  console.log("=== Plaid Lever Full Form + hCaptcha Test ===\n");

  const browser = await chromium.launch({
    headless: false,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });
  const page = await ctx.newPage();

  // Install rqdata capture BEFORE goto() so checksiteconfig response is captured during load
  installHCaptchaCapture(page);

  // Intercept POST to capture what Lever sees
  page.on("request", (req: any) => {
    if (req.url().includes("jobs.lever.co") && req.method() === "POST" && !req.url().includes("cdn-cgi")) {
      const body = req.postData() || "";
      const fields = body.split("&").filter((f: string) => !f.includes("captcha") && !f.includes("resume")).map((f: string) => decodeURIComponent(f).slice(0, 80));
      console.log(`\n📤 POST ${req.url().slice(-40)}`);
      console.log(`   Fields: ${fields.join(", ")}`);
    }
  });
  page.on("response", async (res: any) => {
    if (res.url().includes("jobs.lever.co") && res.request().method() === "POST" && !res.url().includes("cdn-cgi")) {
      const text = await res.text().catch(() => "");
      console.log(`📥 ${res.status()} ${text.slice(0, 200)}`);
    }
  });

  try {
    console.log("Loading page...");
    await page.goto(TEST_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(4000);
    console.log("Loaded:", await page.title());

    // Step 1: Fill standard fields via Playwright fill()
    console.log("\nFilling standard fields...");
    const fillField = async (sel: string, val: string) => {
      try { await page.fill(sel, val); } catch { /* field may not exist */ }
    };
    await fillField("input[name='name']", "Seun Johnson");
    await fillField("input[name='email']", "johnsonseun15@gmail.com");
    await fillField("input[name='phone']", "5015024609");
    await fillField("input[name='org']", "Product Manager");
    await fillField("input[name='urls[LinkedIn]']", "https://linkedin.com/in/sjohnson");
    await fillField("#additional-information", "I am excited to apply for this Product Manager role at Plaid.");

    // Location + EEO via evaluate string (no TypeScript inside)
    await page.evaluate(`(function() {
      var locSel = document.querySelector("select[name='opportunityLocationId']");
      if (locSel && locSel.options.length > 1) {
        locSel.selectedIndex = 1;
        locSel.dispatchEvent(new Event('change', {bubbles:true}));
      }
      ['eeo[gender]','eeo[race]','eeo[veteran]','eeo[disability]'].forEach(function(nm) {
        var sel = document.querySelector("select[name='" + nm + "']");
        if (!sel) return;
        for (var i = 0; i < sel.options.length; i++) {
          if (sel.options[i].text.toLowerCase().indexOf('decline') >= 0) { sel.selectedIndex = i; break; }
        }
        sel.dispatchEvent(new Event('change', {bubbles:true}));
      });
    })()`);

    // Step 2: Upload resume
    const fileInput = await page.$("input[type='file']");
    if (fileInput) {
      await (fileInput as any).setInputFiles(RESUME_PATH);
      console.log("Resume uploaded");
      await page.waitForTimeout(2000);
    }

    // Step 3: Fill all custom card fields (radio groups + checkboxes)
    console.log("\nFilling custom card fields...");
    const cardResult = await page.evaluate(`(function() {
      var results = [];
      var radiosByName = {};
      document.querySelectorAll("input[type='radio'][name*='cards']").forEach(function(r) {
        if (!radiosByName[r.name]) radiosByName[r.name] = [];
        radiosByName[r.name].push(r);
      });
      Object.keys(radiosByName).forEach(function(name) {
        var radios = radiosByName[name];
        var anyChecked = radios.some(function(r) { return r.checked; });
        if (!anyChecked) {
          var target = radios[radios.length - 1];
          target.checked = true;
          target.dispatchEvent(new MouseEvent('click', {bubbles:true}));
          target.dispatchEvent(new Event('change', {bubbles:true}));
          results.push('Radio ' + name + ': ' + target.value);
        }
      });
      var cbByKey = {};
      document.querySelectorAll("input[type='checkbox'][name*='cards']").forEach(function(cb) {
        var m = cb.name.match(/^(cards\\[[^\\]]+\\]\\[field\\d+\\])/);
        var key = m ? m[1] : cb.name;
        if (!cbByKey[key]) cbByKey[key] = [];
        cbByKey[key].push(cb);
      });
      Object.keys(cbByKey).forEach(function(key) {
        var cbs = cbByKey[key];
        var anyChecked = cbs.some(function(cb) { return cb.checked; });
        if (!anyChecked) {
          cbs[0].checked = true;
          cbs[0].dispatchEvent(new MouseEvent('click', {bubbles:true}));
          cbs[0].dispatchEvent(new Event('change', {bubbles:true}));
          results.push('Checkbox ' + key + ': ' + cbs[0].value);
        }
      });
      return results;
    })()`);
    (cardResult as string[]).forEach((r: string) => console.log(" ", r));

    await page.waitForTimeout(1000);

    // Step 4: Solve hCaptcha
    const info = await detectCaptcha(page);
    console.log(`\nCAPTCHA: ${info ? `${info.type} enterprise=${info.isEnterprise} invisible=${info.isInvisible}` : "NONE"}`);

    if (!info || info.type !== "hcaptcha") {
      console.log("No hCaptcha — submitting directly");
    } else {
      // Log all hcaptcha network requests to confirm context-level intercept
      page.on("request", (req: any) => {
        if (req.url().includes("hcaptcha.com")) {
          console.log(`  [hcaptcha req] ${req.method()} ${req.url().slice(0, 100)}`);
        }
      });
      page.on("response", async (res: any) => {
        if (res.url().includes("hcaptcha.com")) {
          console.log(`  [hcaptcha res] ${res.status()} ${res.url().slice(0, 100)}`);
        }
      });

      // Enumerate all frames to find the right hCaptcha checkbox frame
      await page.waitForTimeout(3000);
      const allFrames = page.frames();
      console.log("All frames:");
      allFrames.forEach((f: any) => console.log(" ", f.url().slice(0, 120)));

      // The hCaptcha widget checkbox is in the enclave frame — find and click it
      let clickSuccess = false;
      for (const frame of allFrames) {
        const furl = frame.url();
        if (!furl.includes("hcaptcha")) continue;
        console.log("  Trying frame:", furl.slice(0, 100));
        try {
          // Try #checkbox, .checkbox, [aria-checked], or just the first clickable element
          for (const sel of ["#checkbox", ".checkbox", "[aria-checked]", "body"]) {
            try {
              await frame.waitForSelector(sel, { timeout: 2000 });
              await frame.click(sel);
              console.log(`  Clicked ${sel} in hcaptcha frame`);
              clickSuccess = true;
              break;
            } catch { continue; }
          }
          if (clickSuccess) break;
        } catch (e: any) {
          console.log("  frame click err:", e.message?.slice(0, 60));
        }
      }

      if (!clickSuccess) {
        console.log("  No frame click worked — relying on execute() trigger only");
      }

      // Wait for getcaptcha to fire after click
      await page.waitForTimeout(3000);
      console.log("Solving (intercept should have fired by now)...");
      const result = await solveCaptcha(page);
      console.log(`Solve: success=${result.success} time=${result.solveTimeMs}ms tokenLen=${result.token?.length}`);
      if (!result.success) {
        console.log("❌ Solve failed:", result.error);
        await browser.close();
        return;
      }
      console.log("✅ Token injected");
    }

    await page.screenshot({ path: "/tmp/plaid-prefill.png", fullPage: true });

    // Step 5: Submit
    console.log("\nSubmitting...");
    const submitResult = await page.evaluate(() => {
      // Final check — fill any remaining required selects
      document.querySelectorAll<HTMLSelectElement>("select").forEach(s => {
        if (!s.value && s.options.length > 1) {
          s.selectedIndex = 1;
          s.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });

      const btn = document.querySelector('button[type="submit"]') as HTMLButtonElement;
      if (!btn) return { found: false };
      btn.scrollIntoView({ block: "center" });
      btn.click();
      return { found: true, text: btn.textContent?.trim() };
    });
    console.log("Submit clicked:", submitResult);

    await page.waitForTimeout(8000);

    const url = page.url();
    const text = await page.evaluate(() => document.body.innerText.slice(0, 600));
    console.log(`\nFinal URL: ${url}`);
    console.log(`Page text: ${text.slice(0, 300)}`);

    const success = url.includes("/thanks") || text.toLowerCase().includes("thank") || text.toLowerCase().includes("submitted");
    console.log(success ? "\n✅ SUCCESS!" : "\n❌ FAILED — see /tmp/plaid-result.png");
    await page.screenshot({ path: "/tmp/plaid-result.png", fullPage: true });

  } finally {
    await browser.close();
  }
}

main().catch(console.error);
