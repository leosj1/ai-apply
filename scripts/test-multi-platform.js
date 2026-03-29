#!/usr/bin/env node
/**
 * Multi-platform auto-apply test script
 * Tests: Greenhouse (hybrid), Lever (API), Ashby, Workday, SmartRecruiters (AI agent)
 * Takes proof screenshots before each submission attempt
 */
const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const RESUME_PATH = process.env.RESUME_PDF_PATH;
const SCREENSHOTS_DIR = path.join(__dirname, "proof-screenshots");

const APPLICANT = {
  firstName: "Seun",
  lastName: "Johnson",
  email: "johnsonseun15@gmail.com",
  phone: "4155551234",
  linkedIn: "https://linkedin.com/in/seunjohnson",
  location: "San Francisco, CA",
};

const JOBS = [
  { platform: "greenhouse", company: "Anthropic", url: "https://boards.greenhouse.io/anthropic/jobs/5074975008", boardToken: "anthropic", jobId: "5074975008" },
  { platform: "lever", company: "Spotify", url: "https://jobs.lever.co/spotify/d33ef090-2e71-43a2-ac10-cb81dfb13489" },
  { platform: "lever", company: "Plaid", url: "https://jobs.lever.co/plaid/f783a8c4-8ae2-4646-b4f3-a194940ff3b2" },
  { platform: "ashby", company: "Ramp", url: "https://jobs.ashbyhq.com/ramp/4e64ab86-4e30-403b-b1b9-41dc052570ce" },
  { platform: "workday", company: "NVIDIA", url: "https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/Israel-Raanana/Senior-Software-Engineer_JR1998124" },
  { platform: "smartrecruiters", company: "Visa", url: "https://jobs.smartrecruiters.com/Visa/744000111008755" },
];

const results = [];

async function callOpenAI(messages) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({ model: "gpt-4o-mini", messages, temperature: 0.3, max_tokens: 2000 }),
  });
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

function saveScreenshot(buffer, platform, company, suffix = "pre-submit") {
  if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  const filename = `${platform}-${company.toLowerCase()}-${suffix}.png`;
  const filepath = path.join(SCREENSHOTS_DIR, filename);
  fs.writeFileSync(filepath, buffer);
  console.log(`  📸 Screenshot: ${filename}`);
  return filepath;
}

// ── GREENHOUSE HYBRID ──
async function testGreenhouse(job) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36", viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  try {
    const embedUrl = `https://boards.greenhouse.io/embed/job_app?for=${job.boardToken}&token=${job.jobId}`;
    try { await page.goto(embedUrl, { waitUntil: "networkidle", timeout: 15000 }); }
    catch { await page.goto(embedUrl, { waitUntil: "domcontentloaded", timeout: 15000 }); }

    const hasForm = await page.$("#application_form").catch(() => null);
    if (!hasForm) {
      await page.waitForSelector("#application_form", { timeout: 10000 }).catch(() => null);
    }
    if (!await page.$("#application_form")) {
      return { success: false, message: "Form not found" };
    }

    // Extract questions
    const questions = await page.evaluate(`(() => {
      var r = [];
      for (var i = 0; i < 30; i++) {
        var q = document.getElementById("job_application_answers_attributes_" + i + "_question_id");
        if (!q) break;
        var t = document.getElementById("job_application_answers_attributes_" + i + "_text_value");
        var b = document.getElementById("job_application_answers_attributes_" + i + "_boolean_value");
        var c = q.closest(".field") || (q.parentElement ? q.parentElement.parentElement : null);
        var s = c ? c.querySelector("select") : null;
        var type = b ? "boolean" : s ? "select" : "text";
        var lbl = c && c.querySelector("label") ? c.querySelector("label").textContent.replace(/\\s*\\*\\s*$/, "").trim() : "Q" + i;
        var opts = []; var optIds = [];
        if (s) { for (var j = 0; j < s.options.length; j++) { if (s.options[j].value) { opts.push(s.options[j].text.trim()); optIds.push(s.options[j].value); } } }
        r.push({ index: i, questionId: q.value, type: type, label: lbl.slice(0, 80), options: opts, optionIds: optIds, inputId: t ? t.id : (b ? b.id : ""), selectId: s ? s.id : "" });
      }
      return r;
    })()`);

    // AI answers
    const qPrompt = questions.map((q, i) => {
      let line = `${i + 1}. [${q.type}] "${q.label}"`;
      if (q.options.length) line += ` Options: ${q.options.join(", ")}`;
      return line;
    }).join("\n");

    const aiResp = await callOpenAI([
      { role: "system", content: `Answer job application questions for Seun Johnson, software engineer applying to ${job.company}. For select: use EXACT option text. For boolean: Yes/No. For EEO: "Decline To Self Identify". Work auth: YES, no sponsorship. Privacy: agree. LinkedIn: https://linkedin.com/in/seunjohnson. Respond as JSON array: [{"index":0,"answer":"..."},...]` },
      { role: "user", content: `Answer:\n${qPrompt}` },
    ]);
    let answers = [];
    try { answers = JSON.parse(aiResp.match(/\[[\s\S]*\]/)[0]); } catch {}

    // Fill fields
    const fillData = { firstName: APPLICANT.firstName, lastName: APPLICANT.lastName, email: APPLICANT.email, phone: APPLICANT.phone, answers: answers.map(a => { const q = questions[a.index]; return q ? { index: q.index, type: q.type, inputId: q.inputId, selectId: q.selectId, answer: a.answer, options: q.options, optionIds: q.optionIds } : null; }).filter(Boolean) };

    await page.evaluate(`((data) => {
      function sv(el, v) { var p = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype; var s = Object.getOwnPropertyDescriptor(p, "value"); if (s && s.set) s.set.call(el, v); else el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }
      [["first_name", data.firstName], ["last_name", data.lastName], ["email", data.email], ["phone", data.phone]].forEach(function(x) { var el = document.getElementById(x[0]); if (el) sv(el, x[1]); });
      data.answers.forEach(function(a) {
        if (a.type === "select" && a.selectId) { var s = document.getElementById(a.selectId); if (s) { for (var i = 0; i < s.options.length; i++) { if (s.options[i].text.trim().toLowerCase() === a.answer.toLowerCase().trim() || s.options[i].text.trim().toLowerCase().startsWith(a.answer.toLowerCase().trim().slice(0, 20))) { sv(s, s.options[i].value); break; } } } }
        else if (a.type === "boolean" && a.inputId) { var b = document.getElementById(a.inputId); if (b) { b.checked = a.answer.toLowerCase().startsWith("y"); b.dispatchEvent(new Event("change", { bubbles: true })); } }
        else if (a.type === "text" && a.inputId) { var t = document.getElementById(a.inputId); if (t) sv(t, a.answer); }
      });
    })(${JSON.stringify(fillData)})`);

    // Location
    const locInput = await page.$("#auto_complete_input, input[name*='location']");
    if (locInput) {
      await locInput.click(); await locInput.fill(""); await page.keyboard.type(APPLICANT.location, { delay: 50 });
      await page.waitForTimeout(2000);
      const sug = await page.$(".pac-item, [role='option'], #auto_complete_results li");
      if (sug) await sug.click();
      else { await page.keyboard.press("ArrowDown"); await page.waitForTimeout(300); await page.keyboard.press("Enter"); }
    }

    // Resume
    const attachBtn = await page.$("button[data-source='attach']");
    if (attachBtn) { await attachBtn.click({ force: true }); await page.waitForTimeout(1000); }
    const fileInput = await page.$("#resume_file, #resume_fieldset input[type='file']");
    if (fileInput && RESUME_PATH && fs.existsSync(RESUME_PATH)) {
      await fileInput.setInputFiles(RESUME_PATH);
      await page.waitForTimeout(2000);
    }

    // Screenshot before submit
    await page.waitForTimeout(1000);
    const ss = await page.screenshot({ fullPage: true });
    saveScreenshot(ss, "greenhouse", job.company);

    // Submit
    const submitBtn = await page.$("#submit_app");
    if (submitBtn) {
      await submitBtn.click();
      await page.waitForTimeout(5000);
      const body = await page.evaluate(`document.body.innerText`);
      if (/security\s*code/i.test(body)) return { success: "security_code", message: "Form accepted, security code required", fields: questions.length + 4 };
      if (/thank\s*you/i.test(body) || /application.*received/i.test(body)) return { success: true, message: "Application submitted!", fields: questions.length + 4 };
      return { success: false, message: body.slice(0, 200) };
    }
    return { success: false, message: "No submit button" };
  } finally { await browser.close(); }
}

// ── LEVER API ──
async function testLever(job) {
  // Parse posting ID from URL
  const postingId = job.url.split("/").pop();
  const company = job.url.match(/lever\.co\/([^/]+)/)?.[1];
  if (!company || !postingId) return { success: false, message: "Could not parse Lever URL" };

  // Fetch job details for context
  let jobTitle = "";
  try {
    const detailRes = await fetch(`https://api.lever.co/v0/postings/${company}/${postingId}`);
    if (detailRes.ok) { const d = await detailRes.json(); jobTitle = d.text || ""; }
  } catch {}

  // Build form data
  const formData = new URLSearchParams();
  formData.append("name", `${APPLICANT.firstName} ${APPLICANT.lastName}`);
  formData.append("email", APPLICANT.email);
  formData.append("phone", APPLICANT.phone);
  formData.append("org", "");
  formData.append("urls[LinkedIn]", APPLICANT.linkedIn);
  formData.append("comments", `I am excited to apply for this ${jobTitle} role. My background in software engineering makes me a strong fit.`);
  formData.append("silent", "true");
  formData.append("source", "");

  // Take screenshot of the job page first
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36", viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  try {
    await page.goto(job.url, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(3000);
    // Click Apply if there's an apply button to show the form
    const applyBtn = await page.$("a[href*='apply'], button:has-text('Apply'), .posting-btn-submit");
    if (applyBtn) { await applyBtn.click().catch(() => {}); await page.waitForTimeout(2000); }
    const ss = await page.screenshot({ fullPage: true });
    saveScreenshot(ss, "lever", job.company);
  } finally { await browser.close(); }

  // Submit via API
  const apiUrl = `https://api.lever.co/v0/postings/${company}/${postingId}?key=`;
  console.log(`  Submitting via Lever API: ${apiUrl.slice(0, 60)}`);

  // Lever API accepts multipart form data with resume
  const FormData = (await import("node:buffer")).Buffer ? null : null; // node-fetch compatibility
  const boundary = "----WebKitFormBoundary" + Date.now();
  const parts = [];
  const fields = { name: `${APPLICANT.firstName} ${APPLICANT.lastName}`, email: APPLICANT.email, phone: APPLICANT.phone, "urls[LinkedIn]": APPLICANT.linkedIn, comments: `Excited to apply for this role at ${job.company}.`, silent: "true" };
  for (const [key, val] of Object.entries(fields)) {
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${val}`);
  }
  if (RESUME_PATH && fs.existsSync(RESUME_PATH)) {
    const fileBytes = fs.readFileSync(RESUME_PATH);
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="resume"; filename="${path.basename(RESUME_PATH)}"\r\nContent-Type: application/pdf\r\n\r\n`);
    const bodyParts = [Buffer.from(parts.join("\r\n") + "\r\n"), fileBytes, Buffer.from(`\r\n--${boundary}--\r\n`)];
    // Remove last part entry (it's incomplete) and rebuild
    parts.pop();
  }

  // Simple URL-encoded submission
  const res = await fetch(`https://api.lever.co/v0/postings/${company}/${postingId}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formData.toString(),
  });
  const resText = await res.text();
  if (res.ok || res.status === 200 || res.status === 201) {
    return { success: true, message: `Lever API ${res.status}: ${resText.slice(0, 100)}`, fields: 6 };
  }
  return { success: false, message: `Lever API ${res.status}: ${resText.slice(0, 200)}` };
}

// ── GENERIC BROWSER TEST (Ashby, Workday, SmartRecruiters) ──
async function testBrowserGeneric(job) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36", viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  try {
    console.log(`  Navigating to ${job.url.slice(0, 80)}...`);
    await page.goto(job.url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(3000);

    // Take screenshot of landing page
    let ss = await page.screenshot({ fullPage: true });
    saveScreenshot(ss, job.platform, job.company, "landing");

    // Try to find and click Apply button
    const applySelectors = [
      "a:has-text('Apply')", "button:has-text('Apply')", "[data-testid*='apply']",
      ".posting-btn-submit", "a[href*='apply']", "button[class*='apply']",
      "#apply-button", ".apply-button", "[aria-label*='Apply']",
    ];
    let clicked = false;
    for (const sel of applySelectors) {
      try {
        const btn = await page.$(sel);
        if (btn) {
          const visible = await btn.isVisible().catch(() => false);
          if (visible) {
            await btn.click();
            clicked = true;
            console.log(`  Clicked Apply button: ${sel}`);
            await page.waitForTimeout(3000);
            break;
          }
        }
      } catch {}
    }

    // Take screenshot after clicking apply
    ss = await page.screenshot({ fullPage: true });
    saveScreenshot(ss, job.platform, job.company, clicked ? "apply-form" : "page");

    // Try to find and fill common form fields
    const fieldsFilled = [];
    const fieldMap = [
      { selectors: ["#first_name", "input[name*='firstName']", "input[name*='first_name']", "[data-automation-id='firstName']", "input[placeholder*='First']"], value: APPLICANT.firstName },
      { selectors: ["#last_name", "input[name*='lastName']", "input[name*='last_name']", "[data-automation-id='lastName']", "input[placeholder*='Last']"], value: APPLICANT.lastName },
      { selectors: ["#email", "input[name*='email']", "input[type='email']", "[data-automation-id='email']"], value: APPLICANT.email },
      { selectors: ["#phone", "input[name*='phone']", "input[type='tel']", "[data-automation-id='phone']"], value: APPLICANT.phone },
      { selectors: ["input[name*='linkedin']", "input[placeholder*='LinkedIn']", "[data-automation-id*='linkedin']"], value: APPLICANT.linkedIn },
    ];

    for (const field of fieldMap) {
      for (const sel of field.selectors) {
        try {
          const el = await page.$(sel);
          if (el) {
            const visible = await el.isVisible().catch(() => false);
            if (visible) {
              await el.fill(field.value);
              fieldsFilled.push(sel.split(",")[0]);
              break;
            }
          }
        } catch {}
      }
    }

    if (fieldsFilled.length > 0) {
      console.log(`  Filled ${fieldsFilled.length} fields: ${fieldsFilled.join(", ")}`);
      // Take final screenshot
      ss = await page.screenshot({ fullPage: true });
      saveScreenshot(ss, job.platform, job.company, "pre-submit");
    }

    const pageText = await page.evaluate(`document.body.innerText`).catch(() => "");
    const hasCaptcha = /captcha|recaptcha|hcaptcha|challenge/i.test(pageText) ||
      await page.$("iframe[src*='captcha'], iframe[src*='recaptcha'], iframe[src*='hcaptcha'], .captcha").then(el => !!el).catch(() => false);

    return {
      success: fieldsFilled.length > 0 ? "partial" : false,
      message: hasCaptcha ? `Page loaded, ${fieldsFilled.length} fields filled, CAPTCHA detected` : `Page loaded, ${fieldsFilled.length} fields filled`,
      fields: fieldsFilled.length,
      captcha: hasCaptcha,
      applyClicked: clicked,
    };
  } finally { await browser.close(); }
}

// ── MAIN ──
async function main() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║    Multi-Platform Auto-Apply Test Suite          ║");
  console.log("╚══════════════════════════════════════════════════╝\n");
  console.log(`Applicant: ${APPLICANT.firstName} ${APPLICANT.lastName} <${APPLICANT.email}>`);
  console.log(`Resume: ${RESUME_PATH}`);
  console.log(`Screenshots: ${SCREENSHOTS_DIR}\n`);

  if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  for (let i = 0; i < JOBS.length; i++) {
    const job = JOBS[i];
    console.log(`\n${"─".repeat(60)}`);
    console.log(`[${i + 1}/${JOBS.length}] ${job.platform.toUpperCase()} — ${job.company}`);
    console.log(`URL: ${job.url.slice(0, 80)}`);
    console.log("─".repeat(60));

    let result;
    const startTime = Date.now();
    try {
      if (job.platform === "greenhouse") {
        result = await testGreenhouse(job);
      } else if (job.platform === "lever") {
        result = await testLever(job);
      } else {
        result = await testBrowserGeneric(job);
      }
    } catch (err) {
      result = { success: false, message: `ERROR: ${err.message.slice(0, 150)}` };
    }
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    const status = result.success === true ? "✅ SUCCESS" :
                   result.success === "security_code" ? "🔐 SECURITY CODE" :
                   result.success === "partial" ? "⚠️ PARTIAL" : "❌ FAILED";
    console.log(`\n  Result: ${status} (${elapsed}s)`);
    console.log(`  Message: ${(result.message || "").slice(0, 120)}`);
    if (result.fields) console.log(`  Fields: ${result.fields}`);
    if (result.captcha) console.log(`  ⚠️ CAPTCHA detected — blocks full submission`);

    results.push({ ...job, ...result, elapsed });
  }

  // Summary
  console.log("\n\n" + "═".repeat(60));
  console.log("  SUMMARY");
  console.log("═".repeat(60));
  console.log(`\n${"Platform".padEnd(18)} ${"Company".padEnd(12)} ${"Status".padEnd(16)} ${"Time".padEnd(8)} Details`);
  console.log("─".repeat(80));
  for (const r of results) {
    const status = r.success === true ? "✅ SUCCESS" :
                   r.success === "security_code" ? "🔐 SEC CODE" :
                   r.success === "partial" ? "⚠️ PARTIAL" : "❌ FAILED";
    console.log(`${r.platform.padEnd(18)} ${r.company.padEnd(12)} ${status.padEnd(16)} ${(r.elapsed + "s").padEnd(8)} ${(r.message || "").slice(0, 40)}`);
  }

  // List screenshots
  console.log("\n📸 Proof Screenshots:");
  const files = fs.readdirSync(SCREENSHOTS_DIR).filter(f => f.endsWith(".png"));
  for (const f of files) {
    const size = Math.round(fs.statSync(path.join(SCREENSHOTS_DIR, f)).size / 1024);
    console.log(`  ${f} (${size}KB)`);
  }
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
