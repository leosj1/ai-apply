#!/usr/bin/env node
/**
 * Batch Greenhouse hybrid submission test across multiple companies.
 * Takes proof screenshots before each submission.
 */
const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const RESUME_PATH = process.env.RESUME_PDF_PATH;
const SS_DIR = path.join(__dirname, "proof-screenshots");

const APPLICANT = {
  firstName: "Seun", lastName: "Johnson", email: "johnsonseun15@gmail.com",
  phone: "5015024609", linkedIn: "https://linkedin.com/in/seunjohnson", location: "Oakland, CA",
};

const JOBS = [
  { company: "Figma", boardToken: "figma", jobId: "5458801004" },
  { company: "Discord", boardToken: "discord", jobId: "8174001002" },
  { company: "Databricks", boardToken: "databricks", jobId: "6918763002" },
  { company: "Stripe", boardToken: "stripe", jobId: "7532733" },
  { company: "Coinbase", boardToken: "coinbase", jobId: "7386397" },
];

const results = [];

async function callOpenAI(messages) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({ model: "gpt-4o-mini", messages, temperature: 0.3, max_tokens: 2000 }),
  });
  return (await res.json()).choices?.[0]?.message?.content || "";
}

async function applyToJob(job) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
  });
  const page = await ctx.newPage();
  const embedUrl = `https://boards.greenhouse.io/embed/job_app?for=${job.boardToken}&token=${job.jobId}`;

  try {
    // 1. Navigate
    try { await page.goto(embedUrl, { waitUntil: "networkidle", timeout: 15000 }); }
    catch { await page.goto(embedUrl, { waitUntil: "domcontentloaded", timeout: 15000 }); }

    try { await page.waitForSelector("#application_form", { timeout: 10000 }); }
    catch { return { success: false, message: "Form not found", fields: 0 }; }

    // 2. Extract questions
    const questions = await page.evaluate(`(() => {
      var r = [];
      for (var i = 0; i < 30; i++) {
        var q = document.getElementById("job_application_answers_attributes_" + i + "_question_id");
        if (!q) continue;
        var t = document.getElementById("job_application_answers_attributes_" + i + "_text_value");
        var b = document.getElementById("job_application_answers_attributes_" + i + "_boolean_value");
        var c = q.closest(".field") || (q.parentElement ? q.parentElement.parentElement : null);
        var s = c ? c.querySelector("select") : null;
        // Detect checkbox groups
        var cbs = c ? c.querySelectorAll("input[type='checkbox']") : [];
        // Boolean selects (--/Yes/No) should stay as "boolean" since the fill handler checks tagName
        var type = cbs.length > 0 ? "checkbox" : b ? "boolean" : s ? "select" : "text";
        var lbl = c && c.querySelector("label, legend") ? c.querySelector("label, legend").textContent.replace(/\\s*\\*\\s*$/, "").trim() : "Q" + i;
        var opts = []; var optIds = [];
        if (type === "checkbox") {
          for (var ci = 0; ci < cbs.length; ci++) {
            var cbParent = cbs[ci].closest("label, li, div");
            var cbText = "";
            if (cbParent && cbParent.tagName === "LABEL") cbText = cbParent.textContent.trim();
            else if (cbParent && cbParent.tagName === "LI") cbText = cbParent.textContent.trim();
            else if (cbs[ci].nextSibling && cbs[ci].nextSibling.textContent) cbText = cbs[ci].nextSibling.textContent.trim();
            opts.push(cbText.slice(0, 50) || "Option " + ci);
            optIds.push(cbs[ci].id);
          }
        } else if (s) {
          for (var j = 0; j < s.options.length; j++) { if (s.options[j].value) { opts.push(s.options[j].text.trim()); optIds.push(s.options[j].value); } }
        }
        r.push({ index: i, type, label: lbl.slice(0, 80), options: opts, optionIds: optIds,
          inputId: t ? t.id : (b ? b.id : ""), selectId: s ? s.id : "" });
      }
      return r;
    })()`);
    console.log(`  Questions: ${questions.length}`);

    // 3. AI answers
    const qPrompt = questions.map((q, i) => {
      let line = `${i + 1}. [${q.type}] "${q.label}"`;
      if (q.options.length) line += ` Options: ${q.options.join(", ")}`;
      return line;
    }).join("\n");

    const aiResp = await callOpenAI([
      { role: "system", content: `Answer job app questions for Seun Johnson, SW engineer at ${job.company}. select=EXACT option text from the provided list. boolean=Yes/No. checkbox=comma-separated list of EXACT option texts to check. For country questions, answer "United States" or "US" (match exact option). For sanctions/export/residency: "None of the above" or "Not applicable" (match exact option). EEO="Decline To Self Identify". Work auth=YES, no sponsorship. Privacy/compliance=agree/confirm/yes. LinkedIn: https://linkedin.com/in/seunjohnson. "How did you hear"=pick best match from options (prefer "Third-party website", "LinkedIn", "Career Page", or "Other"). JSON array: [{"index":0,"answer":"..."},...]` },
      { role: "user", content: qPrompt || "No custom questions" },
    ]);
    let answers = [];
    try { answers = JSON.parse(aiResp.match(/\[[\s\S]*\]/)?.[0] || "[]"); } catch {}

    // 4. Fill fields
    const fillData = {
      firstName: APPLICANT.firstName, lastName: APPLICANT.lastName,
      email: APPLICANT.email, phone: APPLICANT.phone,
      answers: answers.map(a => {
        const q = questions[a.index];
        return q ? { index: q.index, type: q.type, inputId: q.inputId, selectId: q.selectId, answer: a.answer, options: q.options, optionIds: q.optionIds } : null;
      }).filter(Boolean),
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
          // Country abbreviation mapping
          var countryMap = {"united states":"us","us":"united states","usa":"united states","united kingdom":"uk","uk":"united kingdom"};
          var altAns = countryMap[ansLow] || "";
          var matched = false;
          // Pass 1: exact match (including country aliases)
          for (var i = 0; i < s.options.length && !matched; i++) {
            var oL = s.options[i].text.trim().toLowerCase();
            if (oL === ansLow || (altAns && oL === altAns)) { sv(s, s.options[i].value); filled.push("Q"+a.index+":"+s.options[i].text.trim().slice(0,20)); matched = true; }
          }
          // Pass 2: fuzzy match (partial, contains, word overlap)
          for (var i2 = 0; i2 < s.options.length && !matched; i2++) {
            var o2 = s.options[i2].text.trim().toLowerCase();
            if (o2.startsWith(ansLow.slice(0,15)) || ansLow.startsWith(o2.slice(0,15)) || o2.includes(ansLow) || ansLow.includes(o2) ||
                (altAns && (o2 === altAns || o2.includes(altAns) || altAns.includes(o2)))) {
              sv(s, s.options[i2].value); filled.push("Q"+a.index+":"+s.options[i2].text.trim().slice(0,20)); matched = true;
            }
          }
          if (!matched) missed.push("Q"+a.index+":no-match("+a.answer.slice(0,15)+")");
        } else if (a.type === "boolean" && a.inputId) {
          var b = document.getElementById(a.inputId);
          if (b) {
            var isYes = a.answer.toLowerCase().startsWith("y") || a.answer === "true" || a.answer === "1";
            if (b.tagName === "SELECT") {
              for (var bi = 0; bi < b.options.length; bi++) {
                var bText = b.options[bi].text.trim().toLowerCase();
                if ((isYes && bText === "yes") || (!isYes && bText === "no")) {
                  sv(b, b.options[bi].value); filled.push("Q"+a.index+":bool="+bText); break;
                }
              }
            } else {
              b.checked = isYes; b.dispatchEvent(new Event("change",{bubbles:true})); filled.push("Q"+a.index+":bool");
            }
          }
        } else if (a.type === "checkbox" && a.optionIds && a.optionIds.length > 0) {
          // Check checkboxes matching the comma-separated answer
          var cbAnswers = a.answer.split(",").map(function(x) { return x.trim().toLowerCase(); });
          var cbChecked = 0;
          for (var cbi = 0; cbi < a.optionIds.length; cbi++) {
            var cbEl = document.getElementById(a.optionIds[cbi]);
            if (!cbEl) continue;
            var cbOpt = (a.options && a.options[cbi]) ? a.options[cbi].toLowerCase() : "";
            var shouldCheck = false;
            for (var ca = 0; ca < cbAnswers.length; ca++) {
              if (cbOpt.includes(cbAnswers[ca]) || cbAnswers[ca].includes(cbOpt.slice(0,15)) ||
                  cbOpt.includes(cbAnswers[ca].split(' ')[0]) || cbAnswers[ca].split(' ').some(function(w) { return w.length > 4 && cbOpt.includes(w); })) {
                shouldCheck = true; break;
              }
            }
            if (shouldCheck) {
              cbEl.checked = true;
              cbEl.dispatchEvent(new Event("change", { bubbles: true }));
              cbEl.dispatchEvent(new Event("click", { bubbles: true }));
              cbChecked++;
            }
          }
          if (cbChecked > 0) filled.push("Q"+a.index+":cb="+cbChecked);
          else missed.push("Q"+a.index+":cb-no-match("+a.answer.slice(0,20)+")");
        } else if (a.type === "text" && a.inputId) {
          var t = document.getElementById(a.inputId); if (t) { sv(t, a.answer); filled.push("Q"+a.index); }
        }
      });
      // Demographic/EEO selects — fill with "Decline" values
      var demoFields = [
        { id: "job_application_gender", prefer: ["decline", "i don't wish", "prefer not"] },
        { id: "job_application_race", prefer: ["decline", "i don't wish", "prefer not", "two or more"] },
        { id: "job_application_hispanic_ethnicity", prefer: ["decline", "i don't wish", "prefer not"] },
        { id: "job_application_veteran_status", prefer: ["i don't wish", "decline", "prefer not", "not a protected"] },
        { id: "job_application_disability_status", prefer: ["i do not want", "decline", "prefer not"] },
      ];
      for (var di = 0; di < demoFields.length; di++) {
        var dSel = document.getElementById(demoFields[di].id);
        if (dSel && dSel.tagName === "SELECT" && (!dSel.value || dSel.value === "" || dSel.selectedIndex <= 0)) {
          var dPrefs = demoFields[di].prefer;
          var dMatched = false;
          for (var dp = 0; dp < dPrefs.length && !dMatched; dp++) {
            for (var dj = 0; dj < dSel.options.length; dj++) {
              if (dSel.options[dj].text.trim().toLowerCase().includes(dPrefs[dp])) {
                dSel.value = dSel.options[dj].value;
                dSel.dispatchEvent(new Event("change", { bubbles: true }));
                filled.push("demo:" + demoFields[di].id.replace("job_application_", ""));
                dMatched = true; break;
              }
            }
          }
        }
      }
      // Education fields (degree, discipline) — handle both native selects and Select2
      function setSelect2OrNative(selId, searchText, filledName) {
        var sel = document.getElementById(selId);
        if (!sel || sel.tagName !== "SELECT") return false;
        if (sel.selectedIndex > 0) return false; // already set
        var found = false;
        for (var oi = 0; oi < sel.options.length; oi++) {
          if (sel.options[oi].text.trim().toLowerCase().includes(searchText)) {
            sel.value = sel.options[oi].value;
            sel.dispatchEvent(new Event("change", { bubbles: true }));
            // Also update Select2 display if present
            var s2span = document.getElementById("select2-chosen-" + selId.replace(/[^0-9]/g, "").slice(-1));
            if (s2span) s2span.textContent = sel.options[oi].text.trim();
            filled.push(filledName);
            found = true; break;
          }
        }
        return found;
      }
      setSelect2OrNative("education_degree_0", "bachelor", "edu:degree");
      setSelect2OrNative("education_degree", "bachelor", "edu:degree");
      setSelect2OrNative("education_discipline_0", "computer science", "edu:discipline");
      setSelect2OrNative("education_discipline", "computer science", "edu:discipline");
      // Work experience fields
      var companyInput = document.getElementById("employment_company_name_0") || document.querySelector("input[name*='employment'][name*='company']");
      if (companyInput && !companyInput.value) { sv(companyInput, "Intuit"); filled.push("work:company"); }
      var titleInput = document.getElementById("employment_title_0") || document.querySelector("input[name*='employment'][name*='title']");
      if (titleInput && !titleInput.value) { sv(titleInput, "Senior Software Engineer"); filled.push("work:title"); }
      // Employment dates (month/year)
      var empStartM = document.querySelector("input[name*='employment'][name*='start_date'][name*='month']");
      if (empStartM && !empStartM.value) { sv(empStartM, "01"); filled.push("work:startM"); }
      var empStartY = document.querySelector("input[name*='employment'][name*='start_date'][name*='year']");
      if (empStartY && !empStartY.value) { sv(empStartY, "2020"); filled.push("work:startY"); }
      // Check "Current" checkbox for employment
      var empCurrent = document.getElementById("employment_current_0");
      if (empCurrent && !empCurrent.checked) { empCurrent.checked = true; empCurrent.dispatchEvent(new Event("change", { bubbles: true })); filled.push("work:current"); }

      return { filled, missed };
    })(${JSON.stringify(fillData)})`);
    console.log(`  Filled: ${fillResult.filled.length} fields (${fillResult.filled.join(', ')})`);
    if (fillResult.missed.length > 0) console.log(`  Missed: ${fillResult.missed.join(', ')}`);

    // 4b. Education school — Select2 dropdown with search
    try {
      const schoolS2 = await page.$("#s2id_education_school_name_0 a, #s2id_education_school_name a");
      if (schoolS2) {
        await schoolS2.click({ timeout: 5000 });
        await page.waitForTimeout(800);
        // Select2 opens a dropdown with search input (rendered as sibling/overlay, not inside container)
        const searchInput = await page.$(".select2-drop-active .select2-input, .select2-search .select2-input");
        if (searchInput) {
          await searchInput.type("University of California", { delay: 30 });
          await page.waitForTimeout(2500);
          const result = await page.$(".select2-drop-active .select2-results li.select2-result");
          if (result) { await result.click(); console.log("  School selected via Select2"); }
          else { await page.keyboard.press("Enter"); console.log("  School: typed + Enter"); }
        } else {
          // Fallback: programmatic set via page.evaluate
          await page.evaluate(`(() => {
            var el = document.getElementById('education_school_name_0');
            if (el) { el.value = '1'; var span = document.getElementById('select2-chosen-1'); if (span) span.textContent = 'University of California, Berkeley'; }
          })()`);
          console.log("  School: set programmatically");
        }
      }
    } catch (e) { console.log("  School autocomplete error:", e.message.slice(0, 60)); }

    // 5. Location — type and validate autocomplete suggestion
    const locInput = await page.$("#auto_complete_input, input[name*='location']");
    if (locInput) {
      await locInput.click(); await locInput.fill("");
      await page.keyboard.type(APPLICANT.location, { delay: 60 });
      await page.waitForTimeout(3000);
      const sug = await page.$(".pac-item, [role='option'], #auto_complete_results li");
      if (sug) {
        const sugText = await sug.textContent().catch(() => "");
        const cityWord = APPLICANT.location.split(",")[0].trim().toLowerCase();
        if (sugText && sugText.toLowerCase().includes(cityWord)) {
          await sug.click();
          console.log("  Location: selected \"" + (sugText || "").trim().slice(0, 50) + "\"");
        } else {
          await page.keyboard.press("Escape");
          console.log("  Location: kept typed \"" + APPLICANT.location + "\" (bad suggestion: \"" + (sugText || "").trim().slice(0, 30) + "\")");
        }
      } else {
        console.log("  Location: no autocomplete, kept typed \"" + APPLICANT.location + "\"");
      }
    }

    // 6. Resume — paste first (safe, doesn't break CSRF), file upload as fallback
    let resumeUploaded = false;
    // Check if form is S3-enabled (filechooser breaks CSRF tokens)
    const isS3 = await page.evaluate(`(() => {
      var el = document.querySelector('#resume_fieldset [data-allow-s3]');
      return el ? el.getAttribute('data-allow-s3') === 'true' : false;
    })()`);
    // For S3 forms OR when we want safe upload: use paste
    if (isS3 || !RESUME_PATH) {
      try {
        const pasteBtn = await page.$("#resume_fieldset button[data-source='paste']");
        if (pasteBtn) { await pasteBtn.click({ force: true }); await page.waitForTimeout(500); }
        const ta = await page.$("#resume_text");
        if (ta) {
          await ta.fill("Seun Johnson\nSoftware Engineer\nSan Francisco, CA\njohnsonseun15@gmail.com | linkedin.com/in/seunjohnson\n\nSUMMARY\nExperienced software engineer with expertise in full-stack development, distributed systems, and cloud architecture. Proficient in TypeScript, Python, React, Node.js, and AWS.\n\nEXPERIENCE\nSenior Software Engineer | 2020-Present\n- Built scalable microservices handling 10M+ requests/day\n- Led migration to TypeScript, reducing bugs by 40%\n- Designed real-time data pipelines using Kafka and Redis\n\nSoftware Engineer | 2017-2020\n- Full-stack development with React, Node.js, PostgreSQL\n- Implemented CI/CD pipelines reducing deploy time by 60%\n\nEDUCATION\nBachelor of Science, Computer Science\nUniversity of California");
          console.log("  Resume text pasted");
          resumeUploaded = true;
        }
      } catch {}
    }
    // For non-S3 forms: use Attach button (creates DOM file input, safe)
    if (!resumeUploaded && RESUME_PATH && fs.existsSync(RESUME_PATH)) {
      try {
        const attachBtn = await page.$("#resume_fieldset button[data-source='attach'], button[data-source='attach']");
        if (attachBtn) {
          await attachBtn.click({ force: true });
          await page.waitForTimeout(1500);
          const fileInput = await page.$("#resume_file, #resume_fieldset input[type='file']");
          if (fileInput) {
            await fileInput.setInputFiles(RESUME_PATH);
            await page.waitForTimeout(2000);
            console.log("  Resume uploaded via file input");
            resumeUploaded = true;
          }
        }
      } catch (e) { console.log("  Resume Attach error:", e.message.slice(0, 40)); }
    }
    // Cover letter
    try {
      const clPasteBtn = await page.$("#cover_letter_fieldset button[data-source='paste']");
      if (clPasteBtn) { await clPasteBtn.click({ force: true }); await page.waitForTimeout(300); }
      const clTA = await page.$("#cover_letter_text");
      if (clTA) await clTA.fill("I am excited to apply for this role at " + job.company + ". My background in software engineering makes me a strong fit.");
    } catch {}

    // 7. PROOF SCREENSHOT
    await page.waitForTimeout(1000);
    const ss = await page.screenshot({ fullPage: true });
    if (!fs.existsSync(SS_DIR)) fs.mkdirSync(SS_DIR, { recursive: true });
    const ssFile = `greenhouse-${job.company.toLowerCase()}-pre-submit.png`;
    fs.writeFileSync(path.join(SS_DIR, ssFile), ss);
    console.log(`  📸 ${ssFile} (${Math.round(ss.length / 1024)}KB)`);

    // 8. Submit
    const submitBtn = await page.$("#submit_app");
    if (!submitBtn) return { success: false, message: "No submit button", fields: fillResult.filled.length, screenshot: ssFile };
    await submitBtn.click();
    console.log("  Submit clicked");
    await page.waitForTimeout(5000);

    // 9. Check result
    const body = await page.evaluate(`document.body.innerText`);

    if (/thank\s*you/i.test(body) || /application.*received/i.test(body) || /has been submitted/i.test(body)) {
      return { success: true, message: "Application submitted!", fields: fillResult.filled.length, screenshot: ssFile };
    }
    if (/security\s*code/i.test(body)) {
      // Take screenshot of security code page too
      const ss2 = await page.screenshot({ fullPage: true });
      fs.writeFileSync(path.join(SS_DIR, `greenhouse-${job.company.toLowerCase()}-security-code.png`), ss2);
      return { success: "security_code", message: "Form accepted — security code required", fields: fillResult.filled.length, screenshot: ssFile };
    }
    if (/required/i.test(body) || /can't be blank/i.test(body)) {
      const ss3 = await page.screenshot({ fullPage: true });
      fs.writeFileSync(path.join(SS_DIR, `greenhouse-${job.company.toLowerCase()}-errors.png`), ss3);
      // Extract errors
      const errors = await page.evaluate(`(() => {
        var e = []; document.querySelectorAll(".field_with_errors label, .error-message, [class*='error']").forEach(function(el) { var t = el.textContent.trim(); if (t && t.length < 100 && t.length > 3) e.push(t); });
        return [...new Set(e)].slice(0, 5);
      })()`);
      return { success: false, message: `Validation: ${errors.join("; ").slice(0, 150)}`, fields: fillResult.filled.length, screenshot: ssFile };
    }
    return { success: false, message: body.slice(0, 150), fields: fillResult.filled.length, screenshot: ssFile };
  } finally { await browser.close(); }
}

async function main() {
  console.log("╔═══════════════════════════════════════════════════╗");
  console.log("║  Greenhouse Hybrid — Multi-Company Batch Test     ║");
  console.log("╚═══════════════════════════════════════════════════╝\n");

  for (let i = 0; i < JOBS.length; i++) {
    const job = JOBS[i];
    console.log(`\n[${i + 1}/${JOBS.length}] ${job.company} (${job.boardToken}/${job.jobId})`);
    console.log("─".repeat(50));
    const t0 = Date.now();
    let result;
    try { result = await applyToJob(job); }
    catch (e) { result = { success: false, message: `ERROR: ${e.message.slice(0, 100)}` }; }
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const icon = result.success === true ? "✅" : result.success === "security_code" ? "🔐" : "❌";
    console.log(`  ${icon} ${result.message?.slice(0, 80)} (${elapsed}s)`);
    results.push({ ...job, ...result, elapsed });
  }

  console.log("\n\n" + "═".repeat(60));
  console.log("  RESULTS SUMMARY");
  console.log("═".repeat(60));
  for (const r of results) {
    const icon = r.success === true ? "✅" : r.success === "security_code" ? "🔐" : "❌";
    console.log(`${icon} ${r.company.padEnd(12)} ${(r.fields || 0)} fields  ${r.elapsed}s  ${(r.message || "").slice(0, 50)}`);
  }
  const ok = results.filter(r => r.success === true || r.success === "security_code").length;
  console.log(`\n${ok}/${results.length} submissions accepted by Greenhouse`);

  console.log("\n📸 Proof screenshots:");
  if (fs.existsSync(SS_DIR)) {
    fs.readdirSync(SS_DIR).filter(f => f.startsWith("greenhouse-")).forEach(f => {
      console.log(`  ${f} (${Math.round(fs.statSync(path.join(SS_DIR, f)).size / 1024)}KB)`);
    });
  }
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
