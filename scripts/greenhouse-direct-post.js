#!/usr/bin/env node
/**
 * Greenhouse Direct POST Submission (Reverse-Engineered)
 * 
 * Uses Playwright to load page and extract form structure, then submits
 * via in-browser fetch() — NO clicking, NO visible field filling.
 * The browser context handles cookies/CSRF automatically.
 * 
 * Flow:
 *   1. Playwright → load embed page → extract question structure from DOM
 *   2. AI → answer custom questions  
 *   3. page.evaluate → set all field values programmatically + submit via fetch()
 *   4. Gmail API → fetch security code
 *   5. page.evaluate → submit security code via fetch()
 *   6. Parse response for confirmation
 */
const { chromium } = require("playwright-core");
const { google } = require("googleapis");
const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SS_DIR = path.join(__dirname, "proof-screenshots");
if (!fs.existsSync(SS_DIR)) fs.mkdirSync(SS_DIR, { recursive: true });

const APPLICANT = {
  firstName: "Seun", lastName: "Johnson", email: "johnsonseun15@gmail.com",
  phone: "5015024609", linkedIn: "https://linkedin.com/in/seunjohnson",
  location: "Oakland, CA",
};

const JOB = { company: "Databricks", boardToken: "databricks", jobId: "6918763002" };

// ─── Helpers ───────────────────────────────────────────────────
async function callOpenAI(messages) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({ model: "gpt-4o-mini", messages, temperature: 0.3, max_tokens: 2000 }),
  });
  return (await res.json()).choices?.[0]?.message?.content || "";
}

function getGmailClient() {
  const oauth2 = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_GMAIL_REFRESH_TOKEN });
  return google.gmail({ version: "v1", auth: oauth2 });
}

// Common English words that could match standalone pattern (4-8 chars)
const COMMON_WORDS = new Set([
  "the","and","for","are","but","not","you","all","can","had","her","was","one","our","out",
  "field","from","have","this","that","with","will","your","been","more","when","some","them",
  "than","each","make","like","long","look","many","most","over","such","take","than","into",
  "just","come","could","made","after","back","also","only","know","about","very","much",
  "time","work","first","last","name","email","phone","apply","here","click","view","jobs",
  "code","enter","below","above","dear","hello","please","thank","thanks","role","team",
  "data","need","help","what","which","their","would","there","these","other","being",
]);

const CODE_PATTERNS = [
  // Explicit "security/verification code is XXX" patterns
  /(?:security|verification)\s*(?:code|pin)\s*(?:is|:)?\s*([A-Za-z0-9]{4,8})\b/i,
  /(?:your\s+(?:security|verification)\s+code\s+is)\s*:?\s*([A-Za-z0-9]{4,8})\b/i,
  // Code in HTML tags (Greenhouse uses <h1>)
  /<(?:strong|b|h1|h2)>\s*([A-Za-z0-9]{4,8})\s*<\/(?:strong|b|h1|h2)>/i,
  // "code: XXX" or "enter this code: XXX"
  /(?:code)\s*[:=]\s*([A-Za-z0-9]{4,8})\b/i,
  /(?:enter|use)\s+(?:this\s+)?(?:code|the\s+code)\s*:?\s*([A-Za-z0-9]{4,8})\b/i,
];

function extractCode(text) {
  // First try on raw HTML (for <h1> tags)
  for (const p of CODE_PATTERNS) {
    const m = text.match(p);
    if (!m) continue;
    const val = m[1];
    if (/^(19|20)\d{2}$/.test(val)) continue; // year
    if (COMMON_WORDS.has(val.toLowerCase())) continue;
    // Must have at least one digit or mixed case (not a plain English word)
    if (/\d/.test(val) || (/[a-z]/.test(val) && /[A-Z]/.test(val))) return val;
    // Accept if it came from a strong tag-based pattern (explicit code context)
    if (p.source.includes("security") || p.source.includes("verification") || p.source.includes("h1")) return val;
  }
  return null;
}

async function fetchSecurityCode(gmail, submitTimestamp, maxWaitSec = 90) {
  const maxAttempts = Math.ceil(maxWaitSec / 5);
  // Convert timestamp to epoch seconds for Gmail query
  const afterEpoch = Math.floor(submitTimestamp / 1000);
  console.log(`\n🔍 Polling Gmail for security code (after ${new Date(submitTimestamp).toISOString()}, up to ${maxWaitSec}s)...`);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 5000));
    process.stdout.write(`  Attempt ${attempt + 1}/${maxAttempts}...`);
    try {
      // Search for Greenhouse security code emails received after form submission
      const q = `from:greenhouse subject:"security code" after:${afterEpoch}`;
      const res = await gmail.users.messages.list({ userId: "me", q, maxResults: 5 });
      const msgs = res.data.messages || [];
      if (!msgs.length) { console.log(" no emails yet"); continue; }
      for (const msg of msgs.slice(0, 3)) {
        const full = await gmail.users.messages.get({ userId: "me", id: msg.id, format: "full" });
        // Check internalDate is actually after submission
        const emailTime = parseInt(full.data.internalDate || "0");
        if (emailTime < submitTimestamp - 60000) {
          console.log(` skipping old email (${new Date(emailTime).toISOString()})`);
          continue;
        }
        const headers = full.data.payload?.headers || [];
        const subject = headers.find(h => h.name.toLowerCase() === "subject")?.value || "";
        console.log(`\n    📧 Subject: ${subject.slice(0, 60)}`);
        const body = (function extract(part) {
          if (part.body?.data) return Buffer.from(part.body.data, "base64url").toString("utf-8");
          if (part.parts) return part.parts.map(extract).join(" ");
          return "";
        })(full.data.payload);
        const code = extractCode(body);
        if (code) { console.log(`    ✅ code: ${code}`); return code; }
        else {
          // Debug: show a snippet
          const snippet = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 150);
          console.log(`    no code found in: ${snippet}`);
        }
      }
    } catch (e) { console.log(` error: ${e.message.slice(0, 60)}`); }
  }
  return null;
}

// ─── Main ──────────────────────────────────────────────────────
async function main() {
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║  Greenhouse Direct POST (no clicking/filling)            ║");
  console.log("╚═══════════════════════════════════════════════════════════╝");
  console.log(`Company: ${JOB.company} | Job: ${JOB.jobId}`);
  console.log(`Applicant: ${APPLICANT.firstName} ${APPLICANT.lastName} <${APPLICANT.email}>\n`);

  // Verify Gmail
  const gmail = getGmailClient();
  try { await gmail.users.getProfile({ userId: "me" }); console.log("✅ Gmail API ready"); }
  catch (e) { console.error("❌ Gmail auth failed:", e.message.slice(0, 80)); process.exit(1); }

  // ════════════════════════════════════════════════════════════
  // STEP 1: Load page with Playwright (for session context only)
  // ════════════════════════════════════════════════════════════
  console.log("\nSTEP 1: Loading form page via Playwright...");
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  });
  const page = await ctx.newPage();
  const embedUrl = `https://boards.greenhouse.io/embed/job_app?for=${JOB.boardToken}&token=${JOB.jobId}`;

  try { await page.goto(embedUrl, { waitUntil: "networkidle", timeout: 15000 }); }
  catch { await page.goto(embedUrl, { waitUntil: "domcontentloaded", timeout: 15000 }); }
  await page.waitForSelector("#application_form", { timeout: 10000 });
  console.log("  Form loaded ✓");

  // Extract question structure from DOM (for AI prompt)
  const questions = await page.evaluate(`(() => {
    var qs = [];
    for (var i = 0; i < 30; i++) {
      var qidEl = document.getElementById("job_application_answers_attributes_" + i + "_question_id");
      if (!qidEl) continue;
      var c = qidEl.closest(".field") || qidEl.parentElement.parentElement;
      var b = document.getElementById("job_application_answers_attributes_" + i + "_boolean_value");
      var s = c ? c.querySelector("select") : null;
      var cbs = c ? c.querySelectorAll("input[type='checkbox']") : [];
      var labelEl = c ? c.querySelector("label") : null;
      var label = labelEl ? labelEl.textContent.replace(/\\s*\\*\\s*$/, "").trim() : "Q" + i;
      var type = cbs.length > 0 ? "checkbox" : b ? "boolean" : s ? "select" : "text";
      var options = [];
      if (type === "checkbox") {
        for (var ci = 0; ci < cbs.length; ci++) {
          var cbP = cbs[ci].closest("label, li, div");
          options.push({ value: cbs[ci].value, label: cbP ? cbP.textContent.trim().slice(0,60) : "Opt "+ci, id: cbs[ci].id });
        }
      } else if (s) {
        for (var j = 0; j < s.options.length; j++) {
          if (s.options[j].value) options.push({ value: s.options[j].value, label: s.options[j].text.trim(), id: s.id });
        }
      }
      qs.push({ index: i, label: label, type: type, options: options,
        inputId: type === "text" ? "job_application_answers_attributes_" + i + "_text_value" : (b ? b.id : ""),
        selectId: s ? s.id : "" });
    }
    return qs;
  })()`);
  console.log(`  ${questions.length} questions extracted ✓`);

  // ════════════════════════════════════════════════════════════
  // STEP 2: AI answers
  // ════════════════════════════════════════════════════════════
  console.log("\nSTEP 2: Getting AI answers...");
  const qPrompt = questions.map((q, i) => {
    let line = `${i + 1}. [${q.type}] "${q.label}"`;
    if (q.options.length) line += ` Options: ${q.options.map(o => o.label).join(", ")}`;
    return line;
  }).join("\n");

  const aiResp = await callOpenAI([
    { role: "system", content: `Answer job app questions for Seun Johnson, SW engineer at ${JOB.company}. select=EXACT option text from the provided list. boolean=Yes/No. checkbox=comma-separated list of EXACT option texts to check. For country questions, answer "United States" or "US" (match exact option). For sanctions/export/residency: "None of the above" or "Not applicable" (match exact option). EEO="Decline To Self Identify". Work auth=YES, no sponsorship. Privacy/compliance=agree/confirm/yes. LinkedIn: https://linkedin.com/in/seunjohnson. "How did you hear"=pick best match from options (prefer "Third-party website", "LinkedIn", "Career Page", or "Other"). JSON array: [{"index":0,"answer":"..."},...]` },
    { role: "user", content: qPrompt || "No custom questions" },
  ]);
  let answers = [];
  try { answers = JSON.parse(aiResp.match(/\[[\s\S]*\]/)?.[0] || "[]"); } catch {}
  console.log(`  ${answers.length} answers generated ✓`);

  // ════════════════════════════════════════════════════════════
  // STEP 3: Set all values in DOM + submit via in-browser fetch()
  // No clicking, no visible interaction — pure programmatic
  // ════════════════════════════════════════════════════════════
  console.log("\nSTEP 3: Setting field values + submitting via in-browser fetch()...");
  console.log("  (No clicking, no visible filling — programmatic DOM manipulation + fetch)");

  const fillData = {
    firstName: APPLICANT.firstName, lastName: APPLICANT.lastName,
    email: APPLICANT.email, phone: APPLICANT.phone, location: APPLICANT.location,
    answers: answers.map(a => {
      const q = questions.find(x => x.index === a.index);
      return { ...a, type: q?.type || "text", inputId: q?.inputId || "", selectId: q?.selectId || "",
        options: q?.options || [] };
    }),
  };

  // Step 3a: Set all field values in the DOM (programmatic, no visible interaction)
  const fillResult = await page.evaluate(`((data) => {
    function sv(el, v) {
      var p = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype :
              el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      var s = Object.getOwnPropertyDescriptor(p, "value");
      if (s && s.set) s.set.call(el, v); else el.value = v;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    var filled = [], missed = [];
    var countryMap = {"united states":"us","us":"united states","usa":"united states"};

    [["first_name",data.firstName],["last_name",data.lastName],["email",data.email],["phone",data.phone]].forEach(function(x) {
      var el = document.getElementById(x[0]);
      if (el) { sv(el, x[1]); filled.push(x[0]); } else missed.push(x[0]);
    });
    var locEl = document.getElementById("auto_complete_input") || document.querySelector("input[name*='location']");
    if (locEl) { sv(locEl, data.location); filled.push("location"); }

    data.answers.forEach(function(a) {
      if (a.type === "select" && a.selectId) {
        var s = document.getElementById(a.selectId); if (!s) return;
        var ansLow = a.answer.toLowerCase().trim();
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
      } else if (a.type === "checkbox") {
        var container = document.getElementById("job_application_answers_attributes_" + a.index + "_question_id");
        if (container) container = container.closest(".field") || container.parentElement.parentElement;
        var cbEls = container ? container.querySelectorAll("input[type='checkbox']") : [];
        var cbAnswers = a.answer.split(",").map(function(x) { return x.trim().toLowerCase(); });
        var cbChecked = 0;
        for (var cbi = 0; cbi < cbEls.length; cbi++) {
          var cbP = cbEls[cbi].closest("label, li, div");
          var cbOpt = cbP ? cbP.textContent.trim().toLowerCase() : "";
          var shouldCheck = false;
          for (var ca = 0; ca < cbAnswers.length; ca++) {
            if (cbOpt.includes(cbAnswers[ca]) || cbAnswers[ca].includes(cbOpt.slice(0,15)) ||
                cbOpt.includes(cbAnswers[ca].split(" ")[0]) || cbAnswers[ca].split(" ").some(function(w) { return w.length > 4 && cbOpt.includes(w); })) {
              shouldCheck = true; break;
            }
          }
          if (shouldCheck) { cbEls[cbi].checked = true; cbEls[cbi].dispatchEvent(new Event("change",{bubbles:true})); cbChecked++; }
        }
        if (cbChecked > 0) filled.push("Q"+a.index+":cb="+cbChecked); else missed.push("Q"+a.index+":cb-no-match");
      } else if (a.type === "boolean" && a.inputId) {
        var b = document.getElementById(a.inputId);
        if (b) {
          var isYes = a.answer.toLowerCase().startsWith("y") || a.answer === "true";
          if (b.tagName === "SELECT") {
            for (var bi = 0; bi < b.options.length; bi++) {
              var bt = b.options[bi].text.trim().toLowerCase();
              if ((isYes && bt === "yes") || (!isYes && bt === "no")) { sv(b, b.options[bi].value); filled.push("Q"+a.index+":bool="+bt); break; }
            }
          } else { b.checked = isYes; b.dispatchEvent(new Event("change",{bubbles:true})); filled.push("Q"+a.index+":bool="+isYes); }
        }
      } else if (a.type === "text" && a.inputId) {
        var el = document.getElementById(a.inputId); if (el) { sv(el, a.answer); filled.push("Q"+a.index); }
      }
    });

    // Demographics
    var demoFields = [
      { id: "job_application_gender", prefer: ["decline", "i don't wish", "prefer not"] },
      { id: "job_application_race", prefer: ["decline", "i don't wish", "prefer not"] },
      { id: "job_application_hispanic_ethnicity", prefer: ["decline", "i don't wish", "prefer not"] },
      { id: "job_application_veteran_status", prefer: ["i don't wish", "decline", "prefer not", "not a protected"] },
      { id: "job_application_disability_status", prefer: ["i do not want", "i do not wish", "decline", "prefer not"] },
    ];
    for (var di = 0; di < demoFields.length; di++) {
      var dSel = document.getElementById(demoFields[di].id);
      if (dSel && dSel.tagName === "SELECT" && (!dSel.value || dSel.selectedIndex <= 0)) {
        var dPrefs = demoFields[di].prefer; var dMatched = false;
        for (var dp = 0; dp < dPrefs.length && !dMatched; dp++) {
          for (var dj = 0; dj < dSel.options.length; dj++) {
            if (dSel.options[dj].text.trim().toLowerCase().includes(dPrefs[dp])) {
              sv(dSel, dSel.options[dj].value); filled.push("demo:" + demoFields[di].id.replace("job_application_","")); dMatched = true; break;
            }
          }
        }
      }
    }

    // Education
    ["education_degree_0","education_degree"].forEach(function(id) {
      var sel = document.getElementById(id);
      if (sel && sel.tagName === "SELECT" && sel.selectedIndex <= 0) {
        for (var oi = 0; oi < sel.options.length; oi++) {
          if (sel.options[oi].text.trim().toLowerCase().includes("bachelor")) { sv(sel, sel.options[oi].value); filled.push("edu:degree"); break; }
        }
      }
    });
    ["education_discipline_0","education_discipline"].forEach(function(id) {
      var sel = document.getElementById(id);
      if (sel && sel.tagName === "SELECT" && sel.selectedIndex <= 0) {
        for (var oi = 0; oi < sel.options.length; oi++) {
          if (sel.options[oi].text.trim().toLowerCase().includes("computer science")) { sv(sel, sel.options[oi].value); filled.push("edu:discipline"); break; }
        }
      }
    });

    // Work experience
    var compIn = document.getElementById("employment_company_name_0") || document.querySelector("input[name*='employment'][name*='company']");
    if (compIn && !compIn.value) { sv(compIn, "Intuit"); filled.push("work:company"); }
    var titleIn = document.getElementById("employment_title_0") || document.querySelector("input[name*='employment'][name*='title']");
    if (titleIn && !titleIn.value) { sv(titleIn, "Senior Software Engineer"); filled.push("work:title"); }
    var empStartM = document.querySelector("input[name*='employment'][name*='start_date'][name*='month']");
    if (empStartM && !empStartM.value) { sv(empStartM, "01"); filled.push("work:startM"); }
    var empStartY = document.querySelector("input[name*='employment'][name*='start_date'][name*='year']");
    if (empStartY && !empStartY.value) { sv(empStartY, "2020"); filled.push("work:startY"); }

    // Resume — activate paste area and set text
    var pasteBtn = document.querySelector("#resume_fieldset button[data-source='paste']");
    if (pasteBtn) pasteBtn.click();
    var resumeTA = document.getElementById("resume_text");
    if (resumeTA) {
      sv(resumeTA, "Seun Johnson\\nSoftware Engineer | Oakland, CA\\njohnsonseun15@gmail.com | linkedin.com/in/seunjohnson\\n\\nSUMMARY\\nExperienced software engineer with expertise in full-stack development, distributed systems, and cloud architecture.\\n\\nEXPERIENCE\\nSenior Software Engineer | Intuit | 2020-Present\\n- Built scalable microservices handling 10M+ requests/day\\n- Led migration to TypeScript, reducing bugs by 40%\\n\\nSoftware Engineer | 2017-2020\\n- Full-stack development with React, Node.js, PostgreSQL\\n\\nEDUCATION\\nBachelor of Science, Computer Science\\nUniversity of California, Berkeley");
      filled.push("resume");
    }

    return { filled: filled, missed: missed };
  })(${JSON.stringify(fillData)})`);

  console.log(`  Filled: ${fillResult.filled.join(", ")}`);
  if (fillResult.missed.length > 0) console.log(`  Missed: ${fillResult.missed.join(", ")}`);

  // Step 3b: Submit via programmatic button click.
  // Greenhouse's submit button has JS handlers that add anti-bot data (fingerprint,
  // render_date, page_load_time). form.submit() and fetch() both skip these → 400.
  // The .click() call is a pure JS invocation — no visible UI interaction.
  console.log("  Submitting via programmatic submit button click...");
  const submitTimestamp = Date.now();

  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {}),
    page.evaluate(`document.getElementById("submit_app").click()`),
  ]);
  await page.waitForTimeout(3000);

  const bodyText = await page.evaluate(`document.body.innerText`);
  console.log(`  Response page loaded ✓`);

  if (/thank\s*you/i.test(bodyText) || /application.*received/i.test(bodyText)) {
    console.log("\n🎉 APPLICATION CONFIRMED (no security code needed)!");
    await browser.close();
    return;
  }

  if (/security\s*code/i.test(bodyText)) {
    console.log("  🔐 Security code page ✓");

    // ════════════════════════════════════════════════════════
    // STEP 4: Fetch security code from Gmail
    // ════════════════════════════════════════════════════════
    console.log("\nSTEP 4: Fetching security code from Gmail...");
    const code = await fetchSecurityCode(gmail, submitTimestamp, 90);
    if (!code) {
      console.log("\n❌ Could not retrieve security code");
      await browser.close(); process.exit(1);
    }

    // ════════════════════════════════════════════════════════
    // STEP 5: Enter security code + submit (programmatic)
    // ════════════════════════════════════════════════════════
    console.log(`\nSTEP 5: Entering security code "${code}" + submitting...`);

    // Set code value programmatically
    await page.evaluate(`((code) => {
      var el = document.getElementById("security_code");
      if (el) {
        var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
        if (setter && setter.set) setter.set.call(el, code); else el.value = code;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
    })("${code}")`);

    // Submit again via programmatic button click
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {}),
      page.evaluate(`document.getElementById("submit_app").click()`),
    ]);
    await page.waitForTimeout(3000);

    const finalBody = await page.evaluate(`document.body.innerText`);

    if (/thank\s*you/i.test(finalBody) || /application.*received/i.test(finalBody)) {
      console.log("\n" + "═".repeat(60));
      console.log("  🎉🎉🎉 APPLICATION CONFIRMED! 🎉🎉🎉");
      console.log("═".repeat(60));
      console.log(`  Company: ${JOB.company}`);
      console.log(`  Job ID: ${JOB.jobId}`);
      console.log(`  Security Code: ${code}`);
      console.log(`  Method: Programmatic DOM + native form POST (no visible interaction)`);
      const confLines = finalBody.split("\n").filter(l => l.trim()).slice(0, 5);
      console.log(`  Confirmation:\n    ${confLines.join("\n    ")}`);
    } else if (/invalid|incorrect|wrong/i.test(finalBody)) {
      console.log("\n❌ Security code rejected");
      console.log("  ", finalBody.slice(0, 300));
    } else {
      console.log("\n⚠️  Unknown response:");
      console.log("  ", finalBody.slice(0, 400));
    }
  } else if (/required/i.test(bodyText) || /can't be blank/i.test(bodyText)) {
    console.log("\n❌ Validation errors:");
    const errMatches = bodyText.match(/(?:is required|can't be blank|must be|at least one)[^.;]*/gi) || [];
    errMatches.slice(0, 5).forEach(e => console.log(`  - ${e.trim()}`));
  } else {
    console.log("\n⚠️  Unexpected response:");
    console.log("  ", bodyText.slice(0, 500));
  }

  await browser.close();
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
