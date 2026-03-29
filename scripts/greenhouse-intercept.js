#!/usr/bin/env node
/**
 * Reverse-engineer Greenhouse form POST: use Playwright to extract tokens + form structure,
 * fill data programmatically, serialize FormData, then submit via Node.js fetch (no clicking).
 */
const { chromium } = require("playwright-core");
const { google } = require("googleapis");
const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });

const JOB = { company: "Stripe", boardToken: "stripe", jobId: "7532733" };
const embedUrl = `https://boards.greenhouse.io/embed/job_app?for=${JOB.boardToken}&token=${JOB.jobId}`;

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  });
  const page = await ctx.newPage();

  // Use page.route() to intercept the HTML form POST
  let capturedPost = null;
  await page.route("**/boards.greenhouse.io/**", async (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      capturedPost = {
        url: req.url(),
        headers: req.headers(),
        postData: req.postData(),
        postDataBuffer: req.postDataBuffer(),
      };
      console.log("\n╔══════════════════════════════════════════╗");
      console.log("║  CAPTURED FORM POST                      ║");
      console.log("╚══════════════════════════════════════════╝");
      console.log("URL:", capturedPost.url);
      console.log("Content-Type:", capturedPost.headers["content-type"]?.slice(0, 100));
      console.log("Post data length:", capturedPost.postData?.length || 0);
      // Abort — we just want to capture, not submit
      await route.abort();
    } else {
      await route.continue();
    }
  });

  // Load form
  try { await page.goto(embedUrl, { waitUntil: "networkidle", timeout: 15000 }); }
  catch { await page.goto(embedUrl, { waitUntil: "domcontentloaded", timeout: 15000 }); }
  await page.waitForSelector("#application_form", { timeout: 10000 });
  console.log("Form loaded");

  // Extract form details
  const formInfo = await page.evaluate(`(() => {
    var form = document.getElementById("application_form");
    var result = {
      action: form ? form.action : "",
      method: form ? form.method : "",
      enctype: form ? form.enctype : "",
    };

    // All hidden inputs
    result.hiddenInputs = [];
    document.querySelectorAll("#application_form input[type='hidden']").forEach(function(el) {
      result.hiddenInputs.push({ name: el.name, value: el.value, id: el.id || "" });
    });

    // All form field names (visible)
    result.visibleFields = [];
    document.querySelectorAll("#application_form input:not([type='hidden']), #application_form select, #application_form textarea").forEach(function(el) {
      result.visibleFields.push({
        tag: el.tagName,
        type: el.type || "",
        name: el.name || "",
        id: el.id || "",
        required: el.required || false,
        value: el.value || "",
      });
    });

    // Cookies
    result.cookies = document.cookie;

    return result;
  })()`);

  console.log("\n=== FORM INFO ===");
  console.log("Action:", formInfo.action);
  console.log("Method:", formInfo.method);
  console.log("Enctype:", formInfo.enctype);

  console.log("\n=== HIDDEN INPUTS ===");
  for (const h of formInfo.hiddenInputs) {
    console.log(`  ${h.name} = ${h.value.slice(0, 60)}${h.value.length > 60 ? "..." : ""}`);
  }

  console.log("\n=== VISIBLE FIELDS ===");
  for (const f of formInfo.visibleFields) {
    console.log(`  [${f.tag}:${f.type}] name="${f.name}" id="${f.id}" required=${f.required}`);
  }

  // Get cookies from Playwright context
  const cookies = await ctx.cookies();
  console.log("\n=== COOKIES ===");
  for (const c of cookies) {
    console.log(`  ${c.name} = ${c.value.slice(0, 40)}... (domain: ${c.domain})`);
  }

  // Now fill form minimally and submit to capture POST
  await page.evaluate(`(() => {
    function sv(el, v) {
      var p = el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      var s = Object.getOwnPropertyDescriptor(p, "value"); if (s && s.set) s.set.call(el, v); else el.value = v;
      el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    sv(document.getElementById("first_name"), "Test");
    sv(document.getElementById("last_name"), "User");
    sv(document.getElementById("email"), "test@example.com");
    sv(document.getElementById("phone"), "5551234567");
  })()`);

  // Paste resume
  try {
    const pasteBtn = await page.$("#resume_fieldset button[data-source='paste']");
    if (pasteBtn) { await pasteBtn.click({ force: true }); await page.waitForTimeout(500); }
    const ta = await page.$("#resume_text");
    if (ta) await ta.fill("Test resume content");
  } catch {}

  console.log("\nFilled minimal fields, submitting...");
  await page.click("#submit_app");
  await page.waitForTimeout(5000);

  // Print captured POST details
  if (capturedPost && capturedPost.postData) {
    console.log("\n=== FULL POST DATA (first 3000 chars) ===");
    console.log(capturedPost.postData.slice(0, 3000));
    
    // Parse multipart to extract field names
    const boundary = capturedPost.headers["content-type"]?.match(/boundary=(.+)/)?.[1];
    if (boundary) {
      console.log("\n=== PARSED MULTIPART FIELDS ===");
      const parts = capturedPost.postData.split("--" + boundary);
      for (const part of parts) {
        const nameMatch = part.match(/name="([^"]+)"/);
        if (nameMatch) {
          const value = part.split("\r\n\r\n")[1]?.split("\r\n")[0] || "";
          console.log(`  ${nameMatch[1]} = ${value.slice(0, 80)}`);
        }
      }
    }
  } else {
    console.log("\n⚠️  No POST captured — checking if form used regular submission");
    // Check current URL for redirect
    console.log("Current URL:", page.url());
  }

  await browser.close();
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
