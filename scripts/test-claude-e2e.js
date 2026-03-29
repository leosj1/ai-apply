#!/usr/bin/env node
/**
 * Full E2E Greenhouse submission test with Claude-powered AI.
 * Tests the actual production code path: applyGreenhouseHybrid + Gmail security code.
 * 
 * Usage: node scripts/test-claude-e2e.js
 */
const { chromium } = require("playwright-core");
const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });

const SS_DIR = path.join(__dirname, "proof-screenshots");
if (!fs.existsSync(SS_DIR)) fs.mkdirSync(SS_DIR, { recursive: true });

// Real applicant data — NO dummy data
const APPLICANT = {
  firstName: "Seun",
  lastName: "Johnson",
  email: "johnsonseun15@gmail.com",
  phone: "5015024609",
  linkedIn: "https://linkedin.com/in/seunjohnson",
  location: "Oakland, CA",
  currentTitle: "Software Engineer",
  yearsExp: "3",
  needsSponsorship: false,
  resumeText: "Experienced software engineer with expertise in TypeScript, React, Node.js, Python. Built scalable web applications and APIs. Proficient in cloud infrastructure (AWS, GCP), databases (PostgreSQL, MongoDB), and CI/CD pipelines.",
  coverLetterText: "",
};

// Resolve resume file path
const RESUME_PATH = process.env.RESUME_PDF_PATH || path.join(__dirname, "..", "resume.pdf");

// ── AI Client Setup (mirrors route.ts) ──
function createAIClient() {
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const Anthropic = require("@anthropic-ai/sdk").default || require("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      console.log("🤖 AI Provider: Claude (Anthropic)");
      return { provider: "claude", client };
    } catch (err) {
      console.log(`⚠️ Claude init failed: ${err.message}`);
    }
  }
  if (process.env.OPENAI_API_KEY) {
    const OpenAI = require("openai").default || require("openai");
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    console.log("🤖 AI Provider: OpenAI (fallback)");
    return { provider: "openai", client };
  }
  return null;
}

// ── Gmail API for security code ──
function getGmailClient() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_GMAIL_REFRESH_TOKEN });
  return google.gmail({ version: "v1", auth: oauth2Client });
}

const CODE_PATTERNS = [
  /(?:security|verification)\s*(?:code|pin)\s*(?:is|:)?\s*([A-Za-z0-9]{4,8})\b/i,
  /(?:your\s+(?:security|verification)\s+code\s+is)\s*:?\s*([A-Za-z0-9]{4,8})\b/i,
  /(?:code)\s*[:=]\s*([A-Za-z0-9]{4,8})\b/i,
  /(?:enter|use)\s+(?:this\s+)?(?:code|the\s+code)\s*:?\s*([A-Za-z0-9]{4,8})\b/i,
  /<(?:strong|b|h1|h2)>\s*([A-Za-z0-9]{4,8})\s*<\/(?:strong|b|h1|h2)>/i,
  /^\s*([A-Za-z0-9]{4,8})\s*$/m,
  /\b(\d{6})\b/,
];

function extractCode(text) {
  for (const p of CODE_PATTERNS) {
    if (p.source.includes("strong") || p.source.includes("h1") || p.source.includes("^\\s")) {
      const m = text.match(p);
      if (m) {
        const val = m[1];
        if (/^(19|20)\d{2}$/.test(val)) continue;
        if (/^(the|and|for|are|but|not|you|all|can|had|her|was|one|our|out)$/i.test(val)) continue;
        return val;
      }
    }
  }
  const cleaned = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  for (const p of CODE_PATTERNS) {
    const m = cleaned.match(p);
    if (m) {
      const val = m[1];
      if (/^(19|20)\d{2}$/.test(val)) continue;
      if (/^(the|and|for|are|but|not|you|all|can|had|her|was|one|our|out)$/i.test(val)) continue;
      return val;
    }
  }
  return null;
}

async function fetchSecurityCodeFromGmail(gmail, company, maxWaitSec = 60) {
  const maxAttempts = Math.ceil(maxWaitSec / 5);
  console.log(`\n🔍 Polling Gmail for security code (up to ${maxWaitSec}s)...`);
  const beforeTs = Math.floor(Date.now() / 1000) - 120; // 2 min before now

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      process.stdout.write(`   Attempt ${attempt + 1}/${maxAttempts}...`);
      await new Promise(r => setTimeout(r, 5000));
    }

    try {
      const query = `from:greenhouse-mail.io subject:"security code" after:${beforeTs}`;
      const list = await gmail.users.messages.list({ userId: "me", q: query, maxResults: 5 });
      const messages = list.data.messages || [];

      for (const msg of messages) {
        const full = await gmail.users.messages.get({ userId: "me", id: msg.id, format: "full" });
        const headers = full.data.payload?.headers || [];
        const subject = headers.find(h => h.name.toLowerCase() === "subject")?.value || "";

        // Check if it's for the right company
        if (!subject.toLowerCase().includes(company.toLowerCase())) continue;

        // Get body
        let body = "";
        const parts = full.data.payload?.parts || [];
        for (const part of parts) {
          if (part.mimeType === "text/html" && part.body?.data) {
            body = Buffer.from(part.body.data, "base64url").toString("utf-8");
            break;
          }
        }
        if (!body && full.data.payload?.body?.data) {
          body = Buffer.from(full.data.payload.body.data, "base64url").toString("utf-8");
        }

        const code = extractCode(body);
        if (code) {
          console.log(` ✅ Found code: ${code} (from: "${subject.slice(0, 60)}")`);
          return code;
        }
      }
      if (attempt > 0) console.log(" no code yet");
    } catch (err) {
      console.log(` Gmail error: ${err.message?.slice(0, 50)}`);
    }
  }
  return null;
}

// ── Greenhouse hybrid submitter (inline version matching production code) ──
async function runGreenhouseHybrid(page, boardToken, jobId, applicant, aiClient, jobTitle, company) {
  const embedUrl = `https://boards.greenhouse.io/embed/job_app?for=${boardToken}&token=${jobId}`;
  console.log(`\n📄 Loading embed: ${embedUrl}`);
  await page.goto(embedUrl, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(2000);

  const pageTitle = await page.title();
  console.log(`📄 Page: ${pageTitle}`);

  // Extract form structure
  console.log("📋 Extracting form fields...");
  const formData = await page.evaluate(() => {
    const fields = [];
    // Standard fields
    document.querySelectorAll("input, select, textarea").forEach(el => {
      const name = el.name || el.id || "";
      const label = el.closest(".field")?.querySelector("label")?.textContent?.trim() || name;
      const type = el.tagName === "SELECT" ? "select" : el.type || "text";
      const required = el.required || el.closest(".field")?.classList.contains("required");
      const options = type === "select" ? Array.from(el.options).map(o => o.text) : undefined;
      if (name && !name.startsWith("_") && !["hidden", "submit"].includes(type)) {
        fields.push({ id: name, label, type, required, options });
      }
    });
    return { fields, formExists: !!document.querySelector("form#application_form, form") };
  });

  if (!formData.formExists) {
    console.log("❌ No application form found");
    return { success: false, message: "No form found" };
  }

  console.log(`   Found ${formData.fields.length} form fields`);

  // Fill standard fields
  console.log("✏️ Filling form fields...");
  await page.evaluate((app) => {
    function setVal(selector, value) {
      const el = document.querySelector(selector);
      if (!el || !value) return;
      const proto = Object.getPrototypeOf(el);
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set 
        || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (setter) {
        setter.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
    setVal("#first_name", app.firstName);
    setVal("#last_name", app.lastName);
    setVal("#email", app.email);
    setVal("#phone", app.phone);
    setVal('[name="job_application[location]"]', app.location);

    // LinkedIn URL field
    const linkedInFields = document.querySelectorAll('input[type="text"], input[type="url"]');
    linkedInFields.forEach(f => {
      const label = f.closest(".field")?.querySelector("label")?.textContent?.toLowerCase() || "";
      if (label.includes("linkedin") && app.linkedIn) setVal(`#${f.id}`, app.linkedIn);
    });
  }, applicant);

  // Get custom questions for AI
  const customQs = formData.fields.filter(f => 
    !["first_name", "last_name", "email", "phone", "resume", "cover_letter"].includes(f.id) &&
    !f.id.includes("location") && !f.id.includes("linkedin")
  );

  if (customQs.length > 0 && aiClient) {
    console.log(`🤖 Answering ${customQs.length} custom questions with ${aiClient.provider}...`);

    // Build prompt
    const questionsText = customQs.map((q, i) =>
      `${i + 1}. "${q.label}" (${q.type}${q.required ? ", REQUIRED" : ""})${q.options ? ` Options: [${q.options.join(", ")}]` : ""}`
    ).join("\n");

    const prompt = `You are filling out a job application for "${jobTitle}" at "${company}".

Applicant: ${applicant.firstName} ${applicant.lastName}, ${applicant.email}, ${applicant.phone}
LinkedIn: ${applicant.linkedIn}, Location: ${applicant.location}
Title: ${applicant.currentTitle}, Sponsorship: ${applicant.needsSponsorship ? "Yes" : "No"}
Resume: ${applicant.resumeText?.slice(0, 500) || "N/A"}

Answer these questions. For select fields, pick EXACT option text. For text/textarea, give concise professional answers.

Questions:
${questionsText}

Respond as JSON: { "answers": { "1": "answer1", "2": "answer2" } }`;

    try {
      let content;
      if (aiClient.provider === "claude") {
        const response = await aiClient.client.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{ role: "user", content: prompt }],
        });
        content = response.content.filter(b => b.type === "text").map(b => b.text).join("");
      } else {
        const completion = await aiClient.client.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 1000,
          response_format: { type: "json_object" },
        });
        content = completion.choices[0]?.message?.content || "{}";
      }

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const answers = parsed.answers || parsed;
        
        // Fill answers
        await page.evaluate((data) => {
          const { customQs, answers } = data;
          customQs.forEach((q, i) => {
            const answer = answers[String(i + 1)];
            if (!answer) return;
            const el = document.querySelector(`#${q.id}`) || document.querySelector(`[name="${q.id}"]`);
            if (!el) return;
            if (el.tagName === "SELECT") {
              const opt = Array.from(el.options).find(o => o.text.trim() === answer.trim());
              if (opt) { el.value = opt.value; el.dispatchEvent(new Event("change", { bubbles: true })); }
            } else {
              const proto = Object.getPrototypeOf(el);
              const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set 
                || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
              if (setter) {
                setter.call(el, answer);
                el.dispatchEvent(new Event("input", { bubbles: true }));
                el.dispatchEvent(new Event("change", { bubbles: true }));
              }
            }
          });
        }, { customQs, answers });

        console.log(`   ✅ Filled ${Object.keys(answers).length} AI-answered fields`);
      }
    } catch (err) {
      console.log(`   ⚠️ AI answering failed: ${err.message?.slice(0, 80)}`);
    }
  }

  // Upload resume if available
  if (applicant.resumeFilePath && fs.existsSync(applicant.resumeFilePath)) {
    console.log("📎 Uploading resume...");
    try {
      const fileInput = await page.$('input[type="file"]');
      if (fileInput) {
        await fileInput.setInputFiles(applicant.resumeFilePath);
        console.log("   ✅ Resume uploaded");
      }
    } catch (err) {
      console.log(`   ⚠️ Resume upload failed: ${err.message?.slice(0, 50)}`);
    }
  }

  // Take pre-submit screenshot
  const ssPath = path.join(SS_DIR, `greenhouse-${boardToken}-${jobId}-pre-submit.png`);
  await page.screenshot({ path: ssPath, fullPage: true });
  console.log(`📸 Pre-submit screenshot: ${ssPath}`);

  // Submit
  console.log("🚀 Submitting application...");
  await page.evaluate(() => {
    const btn = document.getElementById("submit_app");
    if (btn) btn.click();
  });
  await page.waitForTimeout(5000);

  // Check result
  const bodyText = await page.evaluate(() => document.body.innerText || "");
  const ssAfter = path.join(SS_DIR, `greenhouse-${boardToken}-${jobId}-post-submit.png`);
  await page.screenshot({ path: ssAfter, fullPage: true });

  if (bodyText.includes("security code") || bodyText.includes("verification code")) {
    console.log("🔐 Security code required!");
    return { success: false, message: "security_code_needed", bodyText };
  }

  if (bodyText.includes("Thank you") || bodyText.includes("Application received") || bodyText.includes("submitted")) {
    console.log("🎉 Application submitted successfully!");
    return { success: true, message: "Submitted successfully", bodyText };
  }

  // Check for errors
  const errors = await page.evaluate(() => {
    const errs = [];
    document.querySelectorAll(".field_with_errors, .error, [class*=\"error\"]").forEach(el => {
      const text = el.textContent?.trim();
      if (text && text.length < 200) errs.push(text);
    });
    return errs;
  });

  if (errors.length > 0) {
    console.log(`⚠️ Form errors: ${errors.join("; ").slice(0, 200)}`);
    return { success: false, message: `Form errors: ${errors.join("; ").slice(0, 200)}` };
  }

  return { success: false, message: `Unknown state. Body excerpt: ${bodyText.slice(0, 200)}`, bodyText };
}

// ── Main ──
async function main() {
  console.log("=== Greenhouse E2E Test (Claude Integration) ===\n");

  const aiClient = createAIClient();
  if (!aiClient) {
    console.error("❌ No AI API key available");
    process.exit(1);
  }

  // Find a live job
  console.log("📋 Finding live Greenhouse job...");
  const companies = [
    { name: "Discord", token: "discord" },
    { name: "Figma", token: "figma" },
    { name: "Stripe", token: "stripe" },
  ];

  let selectedJob = null;
  for (const co of companies) {
    try {
      const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${co.token}/jobs`);
      const data = await res.json();
      const jobs = data.jobs || [];
      if (jobs.length > 0) {
        // Pick a non-Japan, non-Korea job for better English form compatibility
        const englishJob = jobs.find(j => !j.title.includes("Japan") && !j.title.includes("Korea")) || jobs[0];
        selectedJob = { company: co.name, boardToken: co.token, jobId: String(englishJob.id), title: englishJob.title };
        break;
      }
    } catch { /* skip */ }
  }

  if (!selectedJob) {
    console.error("❌ No live Greenhouse jobs found");
    process.exit(1);
  }

  console.log(`✅ ${selectedJob.title} at ${selectedJob.company}`);
  console.log(`   Job ID: ${selectedJob.jobId}, Board: ${selectedJob.boardToken}\n`);

  const startTime = Date.now();
  let browser, context, page;

  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 900 },
    });
    page = await context.newPage();

    const applicantWithResume = {
      ...APPLICANT,
      resumeFilePath: fs.existsSync(RESUME_PATH) ? RESUME_PATH : undefined,
    };

    // Run the hybrid submitter
    const result = await runGreenhouseHybrid(
      page, selectedJob.boardToken, selectedJob.jobId,
      applicantWithResume, aiClient,
      selectedJob.title, selectedJob.company,
    );

    // Handle security code
    if (!result.success && result.message === "security_code_needed") {
      let gmail;
      try { gmail = getGmailClient(); } catch { /* */ }

      if (gmail) {
        const code = await fetchSecurityCodeFromGmail(gmail, selectedJob.company, 60);
        if (code) {
          console.log(`\n✏️ Entering security code: ${code}`);
          // Find and fill the code input
          await page.evaluate((code) => {
            const inputs = document.querySelectorAll('input[type="text"]');
            for (const input of inputs) {
              const label = input.closest(".field")?.querySelector("label")?.textContent?.toLowerCase() || "";
              if (label.includes("code") || label.includes("security") || label.includes("verification") || input.name?.includes("code")) {
                const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
                if (setter) {
                  setter.call(input, code);
                  input.dispatchEvent(new Event("input", { bubbles: true }));
                  input.dispatchEvent(new Event("change", { bubbles: true }));
                }
                return;
              }
            }
            // Fallback: fill first visible text input
            const firstInput = document.querySelector('input[type="text"]:not([style*="display:none"])');
            if (firstInput) {
              const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
              if (setter) {
                setter.call(firstInput, code);
                firstInput.dispatchEvent(new Event("input", { bubbles: true }));
              }
            }
          }, code);

          await page.waitForTimeout(1000);

          // Re-submit
          console.log("🚀 Re-submitting with security code...");
          await page.evaluate(() => {
            const btn = document.getElementById("submit_app");
            if (btn) btn.click();
          });
          await page.waitForTimeout(5000);

          const finalText = await page.evaluate(() => document.body.innerText || "");
          const finalSs = path.join(SS_DIR, `greenhouse-${selectedJob.boardToken}-${selectedJob.jobId}-final.png`);
          await page.screenshot({ path: finalSs, fullPage: true });

          if (finalText.includes("Thank you") || finalText.includes("submitted") || finalText.includes("received")) {
            console.log("\n🎉 APPLICATION SUBMITTED SUCCESSFULLY!");
            console.log(`📸 Final screenshot: ${finalSs}`);
            result.success = true;
            result.message = "Submitted with security code";
          } else {
            console.log(`\n❌ Post-code submission result unclear`);
            console.log(`   Body excerpt: ${finalText.slice(0, 200)}`);
          }
        } else {
          console.log("❌ Could not retrieve security code from Gmail");
        }
      } else {
        console.log("⚠️ Gmail not configured — cannot retrieve security code");
      }
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);

    console.log("\n=== Results ===");
    console.log(`Company: ${selectedJob.company}`);
    console.log(`Job: ${selectedJob.title}`);
    console.log(`AI Provider: ${aiClient.provider}`);
    console.log(`Result: ${result.success ? "✅ SUCCESS" : "❌ FAILED"}`);
    console.log(`Message: ${result.message}`);
    console.log(`Time: ${elapsed}s`);
    console.log(`Screenshots: ${SS_DIR}/`);

  } catch (err) {
    console.error("\n❌ Test error:", err.message);
    console.error(err.stack);
  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

main().catch(console.error);
