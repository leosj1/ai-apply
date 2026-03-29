#!/usr/bin/env npx tsx
/**
 * Debug script: Intercept Lever form POST to diagnose CAPTCHA rejection
 * 
 * 1. Fills form programmatically
 * 2. Solves hCaptcha via Anti-Captcha
 * 3. Intercepts POST request/response
 * 4. Logs everything for diagnosis
 */

import "dotenv/config";
import { chromium } from "playwright-extra";

const URL = "https://jobs.lever.co/plaid/9c7b4342-de57-4a74-8ada-9741a07c7b5f/apply";

async function main() {
  const browser = await chromium.launch({ headless: false, channel: "chrome" });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  // Intercept POST requests to lever.co (not analytics/hcaptcha)
  page.on("request", (req: any) => {
    if (req.url().includes("jobs.lever.co") && req.method() === "POST" && !req.url().includes("cdn-cgi")) {
      console.log(`\n📤 POST ${req.url()}`);
      console.log(`   Content-Type: ${req.headers()["content-type"]}`);
      const body = req.postData();
      if (body) {
        // Log form data, truncating captcha tokens
        const lines = body.split("&").map((p: string) => {
          const decoded = decodeURIComponent(p);
          if (decoded.includes("captcha") || decoded.includes("h-captcha")) {
            return decoded.slice(0, 80) + "...";
          }
          return decoded.slice(0, 120);
        });
        console.log(`   Body fields:\n     ${lines.join("\n     ")}`);
      }
    }
  });

  page.on("response", async (res: any) => {
    if (res.url().includes("jobs.lever.co") && res.request().method() === "POST" && !res.url().includes("cdn-cgi")) {
      console.log(`\n📥 Response ${res.status()} ${res.url()}`);
      try {
        const text = await res.text();
        console.log(`   Body (first 500): ${text.slice(0, 500)}`);
      } catch { /* */ }
    }
  });

  console.log("Loading page...");
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(5000);
  console.log("Page loaded");

  // Check hCaptcha configuration
  const hcaptchaInfo = await page.evaluate(() => {
    const el = document.querySelector(".h-captcha, [data-sitekey]") as any;
    if (!el) return { found: false };
    const scripts = Array.from(document.querySelectorAll("script")).map((s: any) => s.src).filter((s: string) => s.includes("hcaptcha"));
    return {
      found: true,
      sitekey: el.getAttribute("data-sitekey"),
      size: el.getAttribute("data-size"),
      theme: el.getAttribute("data-theme"),
      tabindex: el.getAttribute("data-tabindex"),
      allAttrs: el.getAttributeNames().reduce((acc: any, n: string) => { acc[n] = el.getAttribute(n); return acc; }, {}),
      scripts,
      hcaptchaExists: !!(window as any).hcaptcha,
      hcaptchaMethods: (window as any).hcaptcha ? Object.keys((window as any).hcaptcha) : [],
    };
  });
  console.log("\n🔍 hCaptcha config:", JSON.stringify(hcaptchaInfo, null, 2));

  // Fill form programmatically
  console.log("\nFilling form...");
  await page.evaluate(() => {
    const set = (sel: string, val: string) => {
      const el = document.querySelector(sel) as any;
      if (el) {
        const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set ||
                      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
        if (proto) proto.call(el, val);
        else el.value = val;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
    };
    set("input[name='name']", "Seun Johnson");
    set("input[name='email']", "johnsonseun15@gmail.com");
    set("input[name='phone']", "5015024609");
    set("#location-input", "California");
    set("input[name='urls[LinkedIn]']", "https://linkedin.com/in/sjohnson");
    set("#additional-information", "Excited to apply for this role.");
    
    // Select location
    const locSelect = document.querySelector("select[name='opportunityLocationId']") as any;
    if (locSelect && locSelect.options.length > 1) {
      locSelect.selectedIndex = 1;
      locSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }

    // EEO selects
    ["eeo[gender]", "eeo[race]", "eeo[veteran]"].forEach(name => {
      const sel = document.querySelector(`select[name='${name}']`) as any;
      if (sel) {
        // Find "Decline" option
        for (let i = 0; i < sel.options.length; i++) {
          if (sel.options[i].text.includes("Decline")) { sel.selectedIndex = i; break; }
        }
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    // Click all radio buttons (pick first option for each card group)
    const radiosByCard: Record<string, HTMLInputElement[]> = {};
    document.querySelectorAll<HTMLInputElement>("input[type='radio']").forEach(r => {
      if (r.offsetParent === null) return;
      const match = r.name.match(/^(cards\[[^\]]+\])/);
      if (match) {
        const key = match[1];
        if (!radiosByCard[key]) radiosByCard[key] = [];
        radiosByCard[key].push(r);
      }
    });
    Object.values(radiosByCard).forEach(radios => {
      const anyChecked = radios.some(r => r.checked);
      if (!anyChecked && radios.length > 0) {
        radios[0].checked = true;
        radios[0].dispatchEvent(new Event("change", { bubbles: true }));
        radios[0].dispatchEvent(new Event("input", { bubbles: true }));
      }
    });

    // Check first checkbox in each group
    const sections = document.querySelectorAll(".application-question, .custom-question, div[class*='card']");
    sections.forEach(section => {
      const cbs = section.querySelectorAll<HTMLInputElement>("input[type='checkbox']");
      if (cbs.length > 1) {
        const anyChecked = Array.from(cbs).some(cb => cb.checked);
        if (!anyChecked) {
          cbs[0].checked = true;
          cbs[0].dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
    });

    // Survey checkboxes
    document.querySelectorAll<HTMLInputElement>("input[type='checkbox'][name*='survey']").forEach(cb => {
      if (!cb.checked && cb.offsetParent !== null) {
        cb.checked = true;
        cb.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
  });
  console.log("Form filled");

  // Upload resume
  const resumePath = process.env.RESUME_PATH || 
    "/Users/sjohnson45/Library/Mobile Documents/com~apple~CloudDocs/Seun_Johnson_RESUME_Intuit.pdf";
  try {
    const fileInput = page.locator("input[type='file']").first();
    await fileInput.setInputFiles(resumePath);
    console.log("Resume uploaded");
  } catch (e) {
    console.log("Resume upload failed:", (e as Error).message?.slice(0, 80));
  }

  await page.waitForTimeout(2000);

  // Now solve CAPTCHA
  console.log("\n🔐 Solving hCaptcha via Anti-Captcha...");
  const { solveCaptcha, detectCaptcha } = await import("../src/lib/auto-apply/captcha/solver");
  
  const captchaInfo = await detectCaptcha(page);
  console.log("Detected CAPTCHA:", JSON.stringify(captchaInfo, null, 2));

  const solution = await solveCaptcha(page);
  console.log("Solution:", { success: solution.success, type: solution.type, error: solution.error, tokenLen: solution.token?.length });

  if (!solution.success) {
    console.log("❌ CAPTCHA solve failed");
    await browser.close();
    return;
  }

  // Verify injection
  const injectionCheck = await page.evaluate(() => {
    const textarea = document.querySelector("textarea[name='h-captcha-response']") as any;
    const hiddenInput = document.querySelector("input[name='h-captcha-response']") as any;
    const hc = (window as any).hcaptcha;
    return {
      textareaValue: textarea?.value?.slice(0, 40) + "...",
      hiddenInputValue: hiddenInput?.value?.slice(0, 40) + "...",
      getResponseResult: hc?.getResponse?.()?.slice(0, 40) + "...",
      hcaptchaType: typeof hc,
      hcaptchaMethods: hc ? Object.keys(hc) : [],
      iframesRemaining: document.querySelectorAll("iframe[src*='hcaptcha']").length,
    };
  });
  console.log("\n🔍 Injection check:", JSON.stringify(injectionCheck, null, 2));

  // Wait a bit then click submit
  console.log("\n📝 Clicking submit in 2 seconds...");
  await page.waitForTimeout(2000);

  // Click the submit button
  await page.evaluate(() => {
    const btn = document.querySelector("button[type='submit']") as HTMLElement;
    if (btn) btn.click();
  });

  // Wait for response
  console.log("Waiting for submission response...");
  await page.waitForTimeout(8000);

  // Check final state
  const finalUrl = page.url();
  const finalTitle = await page.title();
  const errorBanner = await page.evaluate(() => {
    const banner = document.querySelector(".application-error, .error-message, [class*='error']") as any;
    return banner?.textContent?.trim()?.slice(0, 200) || null;
  });

  console.log(`\n📊 Final state:`);
  console.log(`   URL: ${finalUrl}`);
  console.log(`   Title: ${finalTitle}`);
  console.log(`   Error: ${errorBanner || "none"}`);

  // Check if we got redirected to a thank-you page
  if (finalUrl.includes("thank") || finalUrl.includes("confirm") || finalUrl.includes("success")) {
    console.log("\n✅ SUCCESS — redirected to confirmation page!");
  } else {
    console.log("\n❌ STILL ON FORM — submission failed");
  }

  await page.waitForTimeout(5000);
  await browser.close();
}

main().catch(console.error);
