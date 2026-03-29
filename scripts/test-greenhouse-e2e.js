#!/usr/bin/env node
/**
 * End-to-end Greenhouse submission with Gmail security code retrieval.
 * Submits form → polls Gmail API → enters security code → confirms application.
 */
const { chromium } = require("playwright-core");
const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const RESUME_PATH = process.env.RESUME_PDF_PATH;
const SS_DIR = path.join(__dirname, "proof-screenshots");
if (!fs.existsSync(SS_DIR)) fs.mkdirSync(SS_DIR, { recursive: true });

const APPLICANT = {
  firstName: "Seun", lastName: "Johnson", email: "johnsonseun15@gmail.com",
  phone: "5015024609", linkedIn: "https://linkedin.com/in/seunjohnson", location: "Oakland, CA",
};

// Pick a single company to do the full e2e flow
const JOB = { company: "Discord", boardToken: "discord", jobId: "8174001002" };

// ─── Gmail API Setup ───────────────────────────────────────────
function getGmailClient() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_GMAIL_REFRESH_TOKEN });
  return google.gmail({ version: "v1", auth: oauth2Client });
}

// Code extraction patterns (same as production verification.ts)
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
  // Try on raw HTML first (for <h1> tags)
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
  // Then try on cleaned text
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

async function fetchSecurityCodeFromGmail(gmail, maxWaitSec = 60) {
  const maxAttempts = Math.ceil(maxWaitSec / 5);
  console.log(`\n🔍 Polling Gmail for security code (up to ${maxWaitSec}s, ${maxAttempts} attempts)...`);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      process.stdout.write(`  Attempt ${attempt + 1}/${maxAttempts} — waiting 5s...`);
      await new Promise(r => setTimeout(r, 5000));
      console.log(" checking");
    } else {
      console.log(`  Attempt 1/${maxAttempts}`);
    }

    try {
      // Search specifically for Greenhouse emails first
      const targetedQuery = "newer_than:5m from:greenhouse";
      const targetedRes = await gmail.users.messages.list({
        userId: "me", q: targetedQuery, maxResults: 5,
      });
      let messages = targetedRes.data.messages || [];

      // Broader fallback
      if (messages.length === 0) {
        const broadQuery = `newer_than:10m to:${APPLICANT.email} (subject:"security code" OR subject:"verification" OR "security code")`;
        const broadRes = await gmail.users.messages.list({
          userId: "me", q: broadQuery, maxResults: 5,
        });
        messages = broadRes.data.messages || [];
      }

      if (messages.length === 0) {
        console.log("  No matching emails yet");
        continue;
      }

      console.log(`  Found ${messages.length} candidate email(s)`);

      for (const msg of messages.slice(0, 3)) {
        const fullMsg = await gmail.users.messages.get({
          userId: "me", id: msg.id, format: "full",
        });
        const payload = fullMsg.data.payload;
        const headers = (payload?.headers || []);
        const from = headers.find(h => h.name.toLowerCase() === "from")?.value || "";
        const subject = headers.find(h => h.name.toLowerCase() === "subject")?.value || "";

        // Extract text from all parts
        function extractText(part) {
          if (part.body?.data) return Buffer.from(part.body.data, "base64url").toString("utf-8");
          if (part.parts) return part.parts.map(extractText).join(" ");
          return "";
        }
        const body = extractText(payload);

        console.log(`  📧 From: ${from.slice(0, 60)}`);
        console.log(`     Subject: ${subject.slice(0, 80)}`);

        const code = extractCode(body);
        if (code) {
          console.log(`  ✅ Found security code: ${code}`);
          return code;
        } else {
          // Show snippet for debugging
          const snippet = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 200);
          console.log(`     Body preview: ${snippet}`);
        }
      }
    } catch (err) {
      console.log(`  Gmail API error: ${err.message.slice(0, 80)}`);
    }
  }

  console.log("  ❌ No security code found after all attempts");
  return null;
}

// ─── OpenAI Helper ─────────────────────────────────────────────
async function callOpenAI(messages) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({ model: "gpt-4o-mini", messages, temperature: 0.3, max_tokens: 2000 }),
  });
  return (await res.json()).choices?.[0]?.message?.content || "";
}

// ─── Main Flow ─────────────────────────────────────────────────
async function main() {
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║  Greenhouse E2E: Submit → Gmail Code → Confirm           ║");
  console.log("╚═══════════════════════════════════════════════════════════╝");
  console.log(`\nCompany: ${JOB.company} (${JOB.boardToken}/${JOB.jobId})`);
  console.log(`Applicant: ${APPLICANT.firstName} ${APPLICANT.lastName} <${APPLICANT.email}>`);

  // Init Gmail API
  const gmail = getGmailClient();
  // Verify Gmail access
  try {
    await gmail.users.getProfile({ userId: "me" });
    console.log("✅ Gmail API authenticated\n");
  } catch (err) {
    console.error("❌ Gmail API auth failed:", err.message.slice(0, 100));
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
  });
  const page = await ctx.newPage();
  const embedUrl = `https://boards.greenhouse.io/embed/job_app?for=${JOB.boardToken}&token=${JOB.jobId}`;

  try {
    // ══════════════════════════════════════════════════════
    // STEP 1: Navigate to form
    // ══════════════════════════════════════════════════════
    console.log("━".repeat(60));
    console.log("STEP 1: Loading form...");
    try { await page.goto(embedUrl, { waitUntil: "networkidle", timeout: 15000 }); }
    catch { await page.goto(embedUrl, { waitUntil: "domcontentloaded", timeout: 15000 }); }
    try { await page.waitForSelector("#application_form", { timeout: 10000 }); }
    catch { console.error("Form not found"); await browser.close(); process.exit(1); }
    console.log("  Form loaded ✓");

    // ══════════════════════════════════════════════════════
    // STEP 2: Extract questions
    // ══════════════════════════════════════════════════════
    console.log("\nSTEP 2: Extracting questions...");
    const questions = await page.evaluate(`(() => {
      var qs = [];
      for (var i = 0; i < 30; i++) {
        var q = document.getElementById("job_application_answers_attributes_" + i + "_question_id");
        if (!q) continue;
        var c = q.closest(".field") || (q.parentElement ? q.parentElement.parentElement : null);
        var b = document.getElementById("job_application_answers_attributes_" + i + "_boolean_value");
        var s = c ? c.querySelector("select") : null;
        var cbs = c ? c.querySelectorAll("input[type='checkbox']") : [];
        var type = cbs.length > 0 ? "checkbox" : b ? "boolean" : s ? "select" : "text";
        var label = ""; var lbl = c ? c.querySelector("label") : null;
        if (lbl) label = lbl.textContent.replace(/\\s*\\*\\s*$/, "").trim();
        var opts = [];
        if (type === "checkbox") {
          for (var ci = 0; ci < cbs.length; ci++) {
            var cbP = cbs[ci].closest("label, li, div");
            var cbT = cbP ? cbP.textContent.trim() : "Option " + ci;
            opts.push(cbT.slice(0, 50));
          }
        } else if (s) {
          for (var j = 0; j < s.options.length; j++) { if (s.options[j].value) opts.push(s.options[j].text.trim()); }
        }
        qs.push({ index: i, label: label || "Question " + i, type: type, options: opts,
          inputId: type === "text" ? "job_application_answers_attributes_" + i + "_text_value" : (b ? b.id : ""),
          selectId: s ? s.id : "" });
      }
      return qs;
    })()`);
    console.log(`  ${questions.length} questions found ✓`);

    // ══════════════════════════════════════════════════════
    // STEP 3: AI answers
    // ══════════════════════════════════════════════════════
    console.log("\nSTEP 3: Getting AI answers...");
    const qPrompt = questions.map((q, i) => {
      let line = `${i + 1}. [${q.type}] "${q.label}"`;
      if (q.options.length) line += ` Options: ${q.options.join(", ")}`;
      return line;
    }).join("\n");

    const aiResp = await callOpenAI([
      { role: "system", content: `Answer job app questions for Seun Johnson, SW engineer at ${JOB.company}. select=EXACT option text from the provided list. boolean=Yes/No. checkbox=comma-separated list of EXACT option texts to check. For country questions, answer "United States" or "US" (match exact option). EEO="Decline To Self Identify". Work auth=YES, no sponsorship. Privacy/compliance=agree/confirm/yes. LinkedIn: https://linkedin.com/in/seunjohnson. "How did you hear"=pick best match from options (prefer "Third-party website", "LinkedIn", "Career Page", or "Other"). JSON array: [{"index":0,"answer":"..."},...]` },
      { role: "user", content: qPrompt || "No custom questions" },
    ]);
    let answers = [];
    try { answers = JSON.parse(aiResp.match(/\[[\s\S]*\]/)?.[0] || "[]"); } catch {}
    console.log(`  ${answers.length} answers generated ✓`);

    // ══════════════════════════════════════════════════════
    // STEP 4: Fill all fields
    // ══════════════════════════════════════════════════════
    console.log("\nSTEP 4: Filling form fields...");
    const fillData = {
      firstName: APPLICANT.firstName, lastName: APPLICANT.lastName,
      email: APPLICANT.email, phone: APPLICANT.phone,
      answers: answers.map(a => {
        const q = questions.find(x => x.index === a.index);
        return { ...a, type: q?.type || "text", inputId: q?.inputId || "", selectId: q?.selectId || "",
          options: q?.type === "checkbox" ? questions.find(x => x.index === a.index)?.options || [] : [] };
      }),
    };

    const fillResult = await page.evaluate(`((data) => {
      var filled = [], missed = [];
      function sv(el, v) {
        var p = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        var s = Object.getOwnPropertyDescriptor(p, "value"); if (s && s.set) s.set.call(el, v); else el.value = v;
        el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
      }
      [["first_name",data.firstName],["last_name",data.lastName],["email",data.email],["phone",data.phone]].forEach(function(x) {
        var el = document.getElementById(x[0]); if (el) { sv(el, x[1]); filled.push(x[0]); } else missed.push(x[0]);
      });
      data.answers.forEach(function(a) {
        if (a.type === "select" && a.selectId) {
          var s = document.getElementById(a.selectId); if (!s) return;
          var ansLow = a.answer.toLowerCase().trim();
          var countryMap = {"united states":"us","us":"united states","usa":"united states","united kingdom":"uk","uk":"united kingdom"};
          var altAns = countryMap[ansLow] || "";
          var matched = false;
          for (var i = 0; i < s.options.length && !matched; i++) {
            var oL = s.options[i].text.trim().toLowerCase();
            if (oL === ansLow || (altAns && oL === altAns)) { sv(s, s.options[i].value); filled.push("Q"+a.index+":"+s.options[i].text.trim().slice(0,20)); matched = true; }
          }
          for (var i2 = 0; i2 < s.options.length && !matched; i2++) {
            var o2 = s.options[i2].text.trim().toLowerCase();
            if (o2.startsWith(ansLow.slice(0,15)) || ansLow.startsWith(o2.slice(0,15)) || o2.includes(ansLow) || ansLow.includes(o2) ||
                (altAns && (o2 === altAns || o2.includes(altAns) || altAns.includes(o2)))) {
              sv(s, s.options[i2].value); filled.push("Q"+a.index+":"+s.options[i2].text.trim().slice(0,20)); matched = true;
            }
          }
          if (!matched) missed.push("Q"+a.index+":no-match("+a.answer.slice(0,15)+")");
        } else if (a.type === "checkbox" && a.options && a.options.length > 0) {
          var cbEls = [];
          var container = document.getElementById("job_application_answers_attributes_" + a.index + "_question_id");
          if (container) container = container.closest(".field") || container.parentElement.parentElement;
          if (container) cbEls = container.querySelectorAll("input[type='checkbox']");
          var cbAnswers = a.answer.split(",").map(function(x) { return x.trim().toLowerCase(); });
          var cbChecked = 0;
          for (var cbi = 0; cbi < cbEls.length; cbi++) {
            var cbParent = cbEls[cbi].closest("label, li, div");
            var cbOpt = cbParent ? cbParent.textContent.trim().toLowerCase() : "";
            var shouldCheck = false;
            for (var ca = 0; ca < cbAnswers.length; ca++) {
              if (cbOpt.includes(cbAnswers[ca]) || cbAnswers[ca].includes(cbOpt.slice(0,15)) ||
                  cbOpt.includes(cbAnswers[ca].split(" ")[0]) || cbAnswers[ca].split(" ").some(function(w) { return w.length > 4 && cbOpt.includes(w); })) {
                shouldCheck = true; break;
              }
            }
            if (shouldCheck) { cbEls[cbi].checked = true; cbEls[cbi].dispatchEvent(new Event("change", { bubbles: true })); cbChecked++; }
          }
          if (cbChecked > 0) filled.push("Q"+a.index+":cb="+cbChecked);
          else missed.push("Q"+a.index+":cb-no-match("+a.answer.slice(0,20)+")");
        } else if (a.type === "boolean" && a.inputId) {
          var b = document.getElementById(a.inputId);
          if (b) {
            var isYes = a.answer.toLowerCase().startsWith("y") || a.answer === "true" || a.answer === "1";
            if (b.tagName === "SELECT") {
              for (var bi = 0; bi < b.options.length; bi++) {
                var bOptText = b.options[bi].text.trim().toLowerCase();
                if ((isYes && bOptText === "yes") || (!isYes && bOptText === "no")) {
                  sv(b, b.options[bi].value); filled.push("Q"+a.index+":bool="+bOptText); break;
                }
              }
            } else { b.checked = isYes; b.dispatchEvent(new Event("change", { bubbles: true })); filled.push("Q"+a.index+":bool="+isYes); }
          }
        } else if (a.type === "text" && a.inputId) {
          var el = document.getElementById(a.inputId); if (el) { sv(el, a.answer); filled.push("Q"+a.index); }
        }
      });
      // Demographics — use preference arrays per field (options vary by company)
      var demoFields = [
        { id: "job_application_gender", prefer: ["decline", "i don't wish", "prefer not"] },
        { id: "job_application_race", prefer: ["decline", "i don't wish", "prefer not", "two or more"] },
        { id: "job_application_hispanic_ethnicity", prefer: ["decline", "i don't wish", "prefer not"] },
        { id: "job_application_veteran_status", prefer: ["i don't wish", "decline", "prefer not", "not a protected"] },
        { id: "job_application_disability_status", prefer: ["i do not want", "i do not wish", "decline", "prefer not"] },
      ];
      for (var di = 0; di < demoFields.length; di++) {
        var dSel = document.getElementById(demoFields[di].id);
        if (dSel && dSel.tagName === "SELECT" && (!dSel.value || dSel.value === "" || dSel.selectedIndex <= 0)) {
          var dPrefs = demoFields[di].prefer;
          var dMatched = false;
          for (var dp = 0; dp < dPrefs.length && !dMatched; dp++) {
            for (var dj = 0; dj < dSel.options.length; dj++) {
              if (dSel.options[dj].text.trim().toLowerCase().includes(dPrefs[dp])) {
                sv(dSel, dSel.options[dj].value);
                filled.push("demo:" + demoFields[di].id.replace("job_application_", ""));
                dMatched = true; break;
              }
            }
          }
        }
      }
      return { filled: filled, missed: missed };
    })(${JSON.stringify(fillData)})`);

    console.log(`  Filled: ${fillResult.filled.join(", ")}`);
    if (fillResult.missed.length > 0) console.log(`  Missed: ${fillResult.missed.join(", ")}`);

    // Location — type and select from Google Places autocomplete
    const locInput = await page.$("#auto_complete_input, input[name*='location']");
    if (locInput) {
      await locInput.click(); await locInput.fill("");
      await page.keyboard.type(APPLICANT.location, { delay: 60 });
      await page.waitForTimeout(3000);
      // Try to find and validate the autocomplete suggestion
      const sug = await page.$(".pac-item, [role='option'], #auto_complete_results li");
      if (sug) {
        const sugText = await sug.textContent().catch(() => "");
        // Only click if suggestion looks right (contains our city name)
        if (sugText && sugText.toLowerCase().includes("oakland")) {
          await sug.click();
          console.log(`  Location: selected "${sugText.trim().slice(0, 50)}" ✓`);
        } else {
          // Don't click wrong suggestions — just press Escape and leave typed text
          await page.keyboard.press("Escape");
          console.log(`  Location: kept typed text "${APPLICANT.location}" (suggestion was "${(sugText || '').trim().slice(0, 30)}")`);
        }
      } else {
        // No autocomplete appeared — the typed text stays
        console.log(`  Location: no autocomplete, kept typed text "${APPLICANT.location}" ✓`);
      }
    }

    // Resume — paste
    try {
      const pasteBtn = await page.$("#resume_fieldset button[data-source='paste']");
      if (pasteBtn) { await pasteBtn.click({ force: true }); await page.waitForTimeout(500); }
      const ta = await page.$("#resume_text");
      if (ta) {
        await ta.fill("Seun Johnson\nSoftware Engineer\nSan Francisco, CA\njohnsonseun15@gmail.com | linkedin.com/in/seunjohnson\n\nSUMMARY\nExperienced software engineer with expertise in full-stack development, distributed systems, and cloud architecture. Proficient in TypeScript, Python, React, Node.js, and AWS.\n\nEXPERIENCE\nSenior Software Engineer | Intuit | 2020-Present\n- Built scalable microservices handling 10M+ requests/day\n- Led migration to TypeScript, reducing bugs by 40%\n- Designed real-time data pipelines using Kafka and Redis\n\nSoftware Engineer | 2017-2020\n- Full-stack development with React, Node.js, PostgreSQL\n- Implemented CI/CD pipelines reducing deploy time by 60%\n\nEDUCATION\nBachelor of Science, Computer Science\nUniversity of California");
        console.log("  Resume pasted ✓");
      }
    } catch {}

    // Pre-submit screenshot
    await page.waitForTimeout(1000);
    const ss1 = await page.screenshot({ fullPage: true });
    fs.writeFileSync(path.join(SS_DIR, "e2e-pre-submit.png"), ss1);
    console.log(`  📸 Pre-submit screenshot (${Math.round(ss1.length / 1024)}KB) ✓`);

    // ══════════════════════════════════════════════════════
    // STEP 5: Submit form
    // ══════════════════════════════════════════════════════
    console.log("\nSTEP 5: Submitting form...");
    const submitBtn = await page.$("#submit_app");
    if (!submitBtn) { console.error("No submit button found!"); await browser.close(); process.exit(1); }
    await submitBtn.click();
    console.log("  Submit clicked — waiting for response...");
    await page.waitForTimeout(5000);

    const bodyAfterSubmit = await page.evaluate(`document.body.innerText`);

    // Check if we got instant confirmation (no security code needed)
    if (/thank\s*you/i.test(bodyAfterSubmit) || /application.*received/i.test(bodyAfterSubmit)) {
      console.log("\n🎉 APPLICATION CONFIRMED (no security code needed)!");
      const ss2 = await page.screenshot({ fullPage: true });
      fs.writeFileSync(path.join(SS_DIR, "e2e-confirmed.png"), ss2);
      console.log(`📸 Confirmation screenshot saved`);
      await browser.close();
      return;
    }

    // Check for validation errors
    if (!/security\s*code/i.test(bodyAfterSubmit)) {
      console.log("  ❌ Unexpected result (not security code page):");
      const errors = await page.evaluate(`(() => {
        var e = []; document.querySelectorAll(".field_with_errors label, .error-message, [class*='error']").forEach(function(el) { var t = el.textContent.trim(); if (t && t.length < 100 && t.length > 3) e.push(t); });
        return [...new Set(e)].slice(0, 5);
      })()`);
      if (errors.length > 0) console.log("  Errors:", errors.join("; "));
      else console.log("  Page text:", bodyAfterSubmit.slice(0, 200));
      const ss3 = await page.screenshot({ fullPage: true });
      fs.writeFileSync(path.join(SS_DIR, "e2e-error.png"), ss3);
      await browser.close();
      process.exit(1);
    }

    console.log("  🔐 Security code page detected ✓");
    const ss4 = await page.screenshot({ fullPage: true });
    fs.writeFileSync(path.join(SS_DIR, "e2e-security-code-page.png"), ss4);

    // ══════════════════════════════════════════════════════
    // STEP 6: Fetch security code from Gmail
    // ══════════════════════════════════════════════════════
    console.log("\nSTEP 6: Fetching security code from Gmail...");
    const securityCode = await fetchSecurityCodeFromGmail(gmail, 90);

    if (!securityCode) {
      console.log("\n❌ FAILED: Could not retrieve security code from Gmail");
      await browser.close();
      process.exit(1);
    }

    // ══════════════════════════════════════════════════════
    // STEP 7: Enter security code and re-submit
    // ══════════════════════════════════════════════════════
    console.log(`\nSTEP 7: Entering security code "${securityCode}" and re-submitting...`);

    const codeInput = await page.$("#security_code");
    if (!codeInput) {
      console.log("  ❌ #security_code input not found on page!");
      await browser.close();
      process.exit(1);
    }

    await codeInput.click();
    await codeInput.fill(securityCode);
    console.log(`  Code entered: ${securityCode} ✓`);

    // Screenshot with code filled in
    const ss5 = await page.screenshot({ fullPage: true });
    fs.writeFileSync(path.join(SS_DIR, "e2e-code-entered.png"), ss5);
    console.log(`  📸 Code entered screenshot ✓`);

    // Click submit again
    const submitBtn2 = await page.$("#submit_app");
    if (submitBtn2) {
      await submitBtn2.click();
      console.log("  Submit clicked (with security code) — waiting...");
    } else {
      console.log("  No submit button found — trying Enter key");
      await page.keyboard.press("Enter");
    }

    await page.waitForTimeout(8000);

    // ══════════════════════════════════════════════════════
    // STEP 8: Verify confirmation
    // ══════════════════════════════════════════════════════
    console.log("\nSTEP 8: Checking for confirmation...");
    const finalBody = await page.evaluate(`document.body.innerText`);
    const ss6 = await page.screenshot({ fullPage: true });
    fs.writeFileSync(path.join(SS_DIR, "e2e-final.png"), ss6);

    if (/thank\s*you/i.test(finalBody) || /application.*received/i.test(finalBody) || /has been submitted/i.test(finalBody)) {
      console.log("\n" + "═".repeat(60));
      console.log("  🎉🎉🎉 APPLICATION CONFIRMED! 🎉🎉🎉");
      console.log("═".repeat(60));
      console.log(`  Company: ${JOB.company}`);
      console.log(`  Job ID: ${JOB.jobId}`);
      console.log(`  Applicant: ${APPLICANT.firstName} ${APPLICANT.lastName}`);
      console.log(`  Security Code: ${securityCode}`);
      // Extract confirmation text
      const confirmation = finalBody.split("\n").filter(l => l.trim()).slice(0, 5).join("\n  ");
      console.log(`  Confirmation text:\n  ${confirmation}`);
      console.log(`\n  📸 Proof: e2e-final.png (${Math.round(ss6.length / 1024)}KB)`);
    } else if (/security\s*code/i.test(finalBody) && /invalid|incorrect|wrong/i.test(finalBody)) {
      console.log("\n❌ Security code was REJECTED — invalid code");
      console.log("  Page text:", finalBody.slice(0, 300));
    } else if (/security\s*code/i.test(finalBody)) {
      console.log("\n⚠️  Still on security code page — code may not have been accepted");
      console.log("  Page text:", finalBody.slice(0, 300));
    } else {
      console.log("\n⚠️  Unknown final state:");
      console.log("  Page text:", finalBody.slice(0, 300));
    }

  } finally {
    await browser.close();
  }
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
