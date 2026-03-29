#!/usr/bin/env node
/**
 * Real end-to-end test: submit Airbnb Greenhouse application via hybrid submitter
 * and verify confirmation email.
 */
const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");

// Load env vars
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const RESUME_PATH = process.env.RESUME_PDF_PATH;
const GMAIL_REFRESH_TOKEN = process.env.GOOGLE_GMAIL_REFRESH_TOKEN;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

const BOARD_TOKEN = "airbnb";
const JOB_ID = "7572491";
const EMBED_URL = `https://boards.greenhouse.io/embed/job_app?for=${BOARD_TOKEN}&token=${JOB_ID}`;

// Real user data
const APPLICANT = {
  firstName: "Seun",
  lastName: "Johnson",
  email: "johnsonseun15@gmail.com",
  phone: "5551234567",
  linkedIn: "",
  location: "San Francisco, CA",
};

async function callOpenAI(messages) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.3,
      max_tokens: 2000,
    }),
  });
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

async function fetchGmailVerificationCode() {
  if (!GMAIL_REFRESH_TOKEN || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    console.log("[Gmail] Missing credentials — cannot fetch verification code");
    return null;
  }
  // Get access token
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: GMAIL_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    console.log("[Gmail] Failed to get access token:", tokenData.error);
    return null;
  }

  // Poll for verification code email (up to 60 seconds)
  for (let attempt = 0; attempt < 12; attempt++) {
    console.log(`[Gmail] Polling for verification code (attempt ${attempt + 1}/12)...`);
    await new Promise((r) => setTimeout(r, 5000));

    const query = encodeURIComponent("from:greenhouse newer_than:10m");
    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=3`,
      { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
    );
    const listData = await listRes.json();
    if (!listData.messages?.length) continue;

    for (const msg of listData.messages) {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
        { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
      );
      const msgData = await msgRes.json();

      // Get email body
      let body = "";
      const parts = msgData.payload?.parts || [msgData.payload];
      for (const part of parts) {
        if (part?.mimeType === "text/plain" && part?.body?.data) {
          body += Buffer.from(part.body.data, "base64url").toString("utf-8");
        } else if (part?.mimeType === "text/html" && part?.body?.data) {
          body += Buffer.from(part.body.data, "base64url").toString("utf-8");
        }
      }

      // Greenhouse puts the code in <h1>CODE</h1> in HTML email
      const h1Match = body.match(/<h1>\s*([A-Za-z0-9]{6,10})\s*<\/h1>/i);
      if (h1Match) {
        console.log(`[Gmail] Found verification code in <h1>: ${h1Match[1]}`);
        return h1Match[1];
      }
      // Fallback patterns
      const patterns = [
        /security\s*code[:\s]+([A-Za-z0-9]{6,10})/i,
        /code[:\s]+([A-Za-z0-9]{8})/i,
      ];
      for (const pat of patterns) {
        const m = body.match(pat);
        if (m && !['overflow', 'position', 'absolute', 'relative'].includes(m[1].toLowerCase())) {
          console.log(`[Gmail] Found verification code: ${m[1]}`);
          return m[1];
        }
      }
    }
  }
  console.log("[Gmail] No verification code found after 60 seconds");
  return null;
}

async function main() {
  console.log("=== REAL Greenhouse Hybrid Submission Test ===");
  console.log(`Job: Airbnb (${EMBED_URL})`);
  console.log(`Applicant: ${APPLICANT.firstName} ${APPLICANT.lastName} <${APPLICANT.email}>`);
  console.log(`Resume: ${RESUME_PATH}`);
  console.log();

  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");
  if (!RESUME_PATH || !fs.existsSync(RESUME_PATH)) throw new Error(`Resume not found: ${RESUME_PATH}`);

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
  });
  const page = await ctx.newPage();

  try {
    // 1. Navigate
    console.log("[1/7] Navigating to embed form...");
    try {
      await page.goto(EMBED_URL, { waitUntil: "networkidle", timeout: 15000 });
    } catch {
      await page.goto(EMBED_URL, { waitUntil: "domcontentloaded", timeout: 15000 });
    }
    await page.waitForSelector("#application_form", { timeout: 10000 });
    console.log("  ✅ Form loaded");

    // 2. Extract question structure
    console.log("[2/7] Extracting questions...");
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
        var opts = [];
        var optIds = [];
        if (s) {
          for (var j = 0; j < s.options.length; j++) {
            if (s.options[j].value) {
              opts.push(s.options[j].text.trim());
              optIds.push(s.options[j].value);
            }
          }
        }
        r.push({
          index: i,
          questionId: q.value,
          type: type,
          label: lbl.slice(0, 80),
          options: opts,
          optionIds: optIds,
          inputId: t ? t.id : (b ? b.id : (s ? s.id : "")),
          selectId: s ? s.id : "",
        });
      }
      return r;
    })()`);
    console.log(`  ✅ Found ${questions.length} questions`);

    // 3. Use AI to answer questions
    console.log("[3/7] Answering questions with AI...");
    const qPrompt = questions.map((q, i) => {
      let line = `${i + 1}. [${q.type}] "${q.label}"`;
      if (q.options.length > 0) line += ` Options: ${q.options.join(", ")}`;
      return line;
    }).join("\n");

    const aiResponse = await callOpenAI([
      {
        role: "system",
        content: `You are filling out a job application for ${APPLICANT.firstName} ${APPLICANT.lastName}, a software engineer applying to Airbnb. Answer each question concisely. For select questions, respond with the EXACT option text. For boolean, respond Yes or No. For EEO questions, respond "Decline To Self Identify" or "Decline to Self Identify". For work authorization, the applicant IS authorized to work in the US and does NOT need sponsorship. For the privacy policy acknowledgment, select the agreement option. For non-compete/non-solicitation, answer No. For former Airbnb employee, answer No. For LinkedIn, use: https://linkedin.com/in/seunjohnson. For "How did you hear about this job", say "Third-party website or search engine". Respond as JSON array: [{"index":0,"answer":"..."},...]`,
      },
      { role: "user", content: `Answer these questions:\n${qPrompt}` },
    ]);

    let answers;
    try {
      const jsonMatch = aiResponse.match(/\[[\s\S]*\]/);
      answers = JSON.parse(jsonMatch[0]);
    } catch {
      console.log("  ⚠️ AI response parse failed:", aiResponse.slice(0, 200));
      answers = [];
    }
    console.log(`  ✅ Got ${answers.length} answers`);

    // 4. Fill all fields
    console.log("[4/7] Filling form fields...");

    // Build fill data
    const fillData = {
      firstName: APPLICANT.firstName,
      lastName: APPLICANT.lastName,
      email: APPLICANT.email,
      phone: APPLICANT.phone,
      answers: [],
    };

    for (const ans of answers) {
      const q = questions[ans.index];
      if (!q) continue;
      fillData.answers.push({
        index: q.index,
        type: q.type,
        inputId: q.inputId,
        selectId: q.selectId,
        answer: ans.answer,
        options: q.options,
        optionIds: q.optionIds,
      });
    }

    const fillResult = await page.evaluate(`((data) => {
      var filled = [];
      var missed = [];

      function setValue(el, val) {
        var proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype :
                    el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        var setter = Object.getOwnPropertyDescriptor(proto, "value");
        if (setter && setter.set) setter.set.call(el, val);
        else el.value = val;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }

      // Standard fields
      var stdFields = [["first_name", data.firstName], ["last_name", data.lastName], ["email", data.email], ["phone", data.phone]];
      for (var i = 0; i < stdFields.length; i++) {
        var el = document.getElementById(stdFields[i][0]);
        if (el) { setValue(el, stdFields[i][1]); filled.push(stdFields[i][0]); }
        else missed.push(stdFields[i][0]);
      }

      // Custom questions
      for (var j = 0; j < data.answers.length; j++) {
        var a = data.answers[j];
        if (a.type === "select" && a.selectId) {
          var sel = document.getElementById(a.selectId);
          if (sel) {
            // Find matching option
            var bestVal = "";
            var ansLower = a.answer.toLowerCase().trim();
            for (var k = 0; k < sel.options.length; k++) {
              if (sel.options[k].text.trim().toLowerCase() === ansLower ||
                  sel.options[k].text.trim().toLowerCase().startsWith(ansLower.slice(0, 20))) {
                bestVal = sel.options[k].value;
                break;
              }
            }
            if (!bestVal && a.optionIds.length > 0) {
              // Fuzzy match
              for (var k2 = 0; k2 < a.options.length; k2++) {
                if (a.options[k2].toLowerCase().includes(ansLower.slice(0, 15)) ||
                    ansLower.includes(a.options[k2].toLowerCase().slice(0, 15))) {
                  bestVal = a.optionIds[k2];
                  break;
                }
              }
            }
            if (bestVal) {
              setValue(sel, bestVal);
              filled.push("Q" + a.index + "(select)=" + a.answer.slice(0, 30));
            } else {
              missed.push("Q" + a.index + "(select)=" + a.answer.slice(0, 30) + " [no match]");
            }
          }
        } else if (a.type === "boolean") {
          var boolEl = document.getElementById(a.inputId);
          if (boolEl) {
            var boolVal = a.answer.toLowerCase().startsWith("y") ? "1" : "0";
            setValue(boolEl, boolVal);
            filled.push("Q" + a.index + "(bool)=" + a.answer);
          }
        } else if (a.type === "text") {
          var textEl = document.getElementById(a.inputId);
          if (textEl) {
            setValue(textEl, a.answer);
            filled.push("Q" + a.index + "(text)=" + a.answer.slice(0, 30));
          }
        }
      }

      return { filled: filled, missed: missed };
    })(${JSON.stringify(fillData)})`);

    console.log(`  ✅ Filled ${fillResult.filled.length} fields: ${fillResult.filled.join(", ")}`);
    if (fillResult.missed.length > 0) console.log(`  ⚠️ Missed: ${fillResult.missed.join(", ")}`);

    // 4b. Location autocomplete
    console.log("[4b/7] Setting location...");
    const locInput = await page.$("#auto_complete_input, input[name*='location']");
    if (locInput) {
      await locInput.click();
      await locInput.fill("");
      await page.keyboard.type(APPLICANT.location, { delay: 50 });
      await page.waitForTimeout(2000);
      // Try to select from autocomplete dropdown
      const suggestion = await page.$(".pac-item, [role='option'], #auto_complete_results li");
      if (suggestion) {
        await suggestion.click();
        console.log("  ✅ Location selected from autocomplete");
      } else {
        await page.keyboard.press("ArrowDown");
        await page.waitForTimeout(300);
        await page.keyboard.press("Enter");
        console.log("  ✅ Location typed + Enter pressed");
      }
    } else {
      console.log("  ⚠️ No location field found");
    }

    // 5. Upload resume via Attach button
    console.log("[5/7] Uploading resume...");
    let resumeUploaded = false;
    try {
      // Click Attach to create the dynamic file input
      const attachBtn = await page.$("button[data-source='attach']");
      if (attachBtn) {
        await attachBtn.click({ force: true });
        await page.waitForTimeout(1000);
      }
      const fileInput = await page.$("#resume_file, #resume_fieldset input[type='file']");
      if (fileInput) {
        await fileInput.setInputFiles(RESUME_PATH);
        await page.waitForTimeout(2000);
        const fname = await page.evaluate(`(() => {
          var fn = document.getElementById('resume_filename');
          return fn ? fn.textContent.trim() : 'N/A';
        })()`);
        console.log(`  ✅ Resume: ${fname || path.basename(RESUME_PATH)} (${fs.statSync(RESUME_PATH).size} bytes)`);
        resumeUploaded = true;
      }
    } catch (e) {
      console.log(`  ⚠️ Attach failed: ${e.message.slice(0, 60)}`);
    }
    if (!resumeUploaded) {
      // Fallback: paste resume text
      console.log("  Falling back to paste...");
      const pasteBtn = await page.$("#resume_fieldset button[data-source='paste']");
      if (pasteBtn) await pasteBtn.click({ force: true });
      await page.waitForTimeout(500);
      const resumeTextarea = await page.$("#resume_text");
      if (resumeTextarea) {
        await resumeTextarea.fill("Seun Johnson - Software Engineer - See attached PDF resume");
        console.log("  ✅ Resume text pasted as fallback");
      }
    }

    // 6. Click submit
    console.log("[6/7] Submitting form...");
    await page.waitForTimeout(1000);
    const submitBtn = await page.$('#submit_app, input[type="submit"], button[type="submit"]');
    if (!submitBtn) throw new Error("Submit button not found");
    await submitBtn.click();
    console.log("  ✅ Submit clicked");

    // 7. Wait for result
    console.log("[7/7] Waiting for result...");
    await page.waitForTimeout(5000);

    // Check for confirmation
    const bodyText = await page.evaluate(`document.body.innerText`);

    const isConfirmation =
      /thank\s*you/i.test(bodyText) ||
      /application.*received/i.test(bodyText) ||
      /successfully.*submitted/i.test(bodyText) ||
      /we.*received.*application/i.test(bodyText);

    const isSecurityCode =
      /security\s*code/i.test(bodyText) ||
      /verification\s*code/i.test(bodyText) ||
      /enter.*code/i.test(bodyText);

    const hasValidationErrors =
      /please\s+complete/i.test(bodyText) ||
      /is\s+required/i.test(bodyText) ||
      /can't\s+be\s+blank/i.test(bodyText);

    if (isConfirmation) {
      console.log("\n🎉 APPLICATION SUBMITTED SUCCESSFULLY!");
      console.log("Confirmation text found on page.");
      console.log("Page text (first 500 chars):", bodyText.slice(0, 500));
    } else if (isSecurityCode) {
      console.log("\n🔐 Security code required — checking Gmail...");
      const code = await fetchGmailVerificationCode();
      if (code) {
        console.log(`  Entering code: ${code}`);
        // Make #security_code visible
        await page.evaluate(`(() => {
          var el = document.getElementById("security_code");
          if (el) {
            el.style.cssText = "display:inline-block !important;visibility:visible !important;opacity:1 !important;width:200px !important;height:30px !important;";
            el.removeAttribute("hidden");
            if (el.parentElement) el.parentElement.style.display = "block";
          }
        })()`);
        await page.waitForTimeout(500);
        // Fill the security code
        const codeInput = await page.$("#security_code");
        if (codeInput) {
          await codeInput.evaluate((el, val) => {
            el.value = val;
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
          }, code);
          console.log("  ✅ Code entered");
          // Click Submit Application
          await page.waitForTimeout(500);
          const submitAppBtn = await page.$("#submit_app");
          if (submitAppBtn) {
            await submitAppBtn.click();
            console.log("  ✅ Submit clicked after code entry");
            await page.waitForTimeout(8000);
            const finalText = await page.evaluate(`document.body.innerText`);
            if (/thank\s*you/i.test(finalText) || /application.*received/i.test(finalText) || /successfully/i.test(finalText)) {
              console.log("\n🎉 APPLICATION SUBMITTED SUCCESSFULLY (after security code)!");
              console.log("Confirmation text:", finalText.slice(0, 500));
            } else {
              console.log("\n⚠️ Code entered + submitted but unclear result");
              console.log("Page text:", finalText.slice(0, 500));
              const ssPath2 = path.join(__dirname, "greenhouse-after-code.png");
              await page.screenshot({ path: ssPath2, fullPage: true });
              console.log("Screenshot:", ssPath2);
            }
          } else {
            console.log("  ⚠️ No submit button found after code entry");
          }
        } else {
          console.log("  ⚠️ #security_code input not found");
        }
      } else {
        console.log("  ❌ Could not fetch verification code from Gmail");
      }
    } else if (hasValidationErrors) {
      console.log("\n❌ VALIDATION ERRORS on form:");
      const errors = await page.evaluate(`(() => {
        var errs = [];
        document.querySelectorAll(".field-error, .error, [class*='error'], [class*='invalid']").forEach(function(el) {
          var t = el.textContent.trim();
          if (t && t.length < 200) errs.push(t);
        });
        return errs;
      })()`);
      console.log("  Errors:", errors.join("; ") || bodyText.slice(0, 500));
    } else {
      console.log("\n⚠️ UNCLEAR RESULT — page text:");
      console.log(bodyText.slice(0, 800));
      const ssPath = path.join(__dirname, "greenhouse-result.png");
      await page.screenshot({ path: ssPath, fullPage: true });
      console.log("Screenshot saved:", ssPath);
    }
  } catch (err) {
    console.error("\n❌ ERROR:", err.message);
    const ssPath = path.join(__dirname, "greenhouse-error.png");
    await page.screenshot({ path: ssPath, fullPage: true }).catch(() => {});
    console.log("Error screenshot:", ssPath);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
