// Greenhouse Direct API Submission
// Uses the public Job Board API to submit applications without a browser.
// Docs: https://developers.greenhouse.io/job-board.html
//
// Flow:
// 1. Fetch job details + form questions from boards-api.greenhouse.io
// 2. Extract board_token from the job URL
// 3. Use AI to answer custom questions
// 4. POST multipart/form-data to boards-api.greenhouse.io/v1/boards/{token}/jobs/{id}

/* eslint-disable @typescript-eslint/no-explicit-any */

import * as fs from "fs";
import * as path from "path";
import type { ApplicantData, FormField, FormSchema, DirectSubmitResult } from "./types";
import { answerQuestions } from "./ai-client";

const GREENHOUSE_API = "https://boards-api.greenhouse.io/v1/boards";

// ── URL Parsing ──

/** Extract board_token and job_id from a Greenhouse URL */
export function parseGreenhouseUrl(url: string): { boardToken: string; jobId: string } | null {
  // Format 1: https://job-boards.greenhouse.io/{board_token}/jobs/{job_id}
  let match = url.match(/job-boards\.greenhouse\.io\/([^/]+)\/jobs\/(\d+)/);
  if (match) return { boardToken: match[1], jobId: match[2] };

  // Format 2: https://boards.greenhouse.io/{board_token}/jobs/{job_id}
  match = url.match(/boards\.greenhouse\.io\/([^/]+)\/jobs\/(\d+)/);
  if (match) return { boardToken: match[1], jobId: match[2] };

  // Format 3: https://boards.greenhouse.io/embed/job_app?for={board_token}&token={job_id}
  match = url.match(/boards\.greenhouse\.io\/embed\/job_app\?.*for=([^&]+).*token=(\d+)/);
  if (match) return { boardToken: match[1], jobId: match[2] };

  // Format 4: Company career pages with gh_jid param (e.g. careers.airbnb.com/positions/123?gh_jid=7572491)
  match = url.match(/[?&]gh_jid=(\d+)/);
  if (match) {
    const jobId = match[1];
    // Infer board token from hostname: careers.airbnb.com → airbnb, jobs.stripe.com → stripe
    const hostMatch = url.match(/https?:\/\/(?:careers|jobs|apply|work|boards|hire)\.([^.]+)\./i);
    const boardToken = hostMatch ? hostMatch[1].toLowerCase() : null;
    if (boardToken) return { boardToken, jobId };
    // Fallback: try extracting from path-based company name
    const pathMatch = url.match(/https?:\/\/([^.]+)\./i);
    if (pathMatch && pathMatch[1] !== "www") return { boardToken: pathMatch[1].toLowerCase(), jobId };
  }

  return null;
}

/** Try to discover the correct board token for a gh_jid URL by testing the API */
export async function discoverBoardToken(jobId: string, guessedToken: string): Promise<string | null> {
  // Try the guessed token first
  const candidates = [guessedToken];
  // Common variations: airbnb, airbnbinc, airbnb-inc, theairbnb
  const base = guessedToken.replace(/[-_]/g, "");
  if (base !== guessedToken) candidates.push(base);
  candidates.push(`${guessedToken}inc`, `${guessedToken}-inc`, `the${guessedToken}`);

  for (const token of candidates) {
    try {
      const res = await fetch(`${GREENHOUSE_API}/${token}/jobs/${jobId}`, { method: "GET" });
      if (res.ok) {
        console.log(`[Greenhouse API] Board token discovered: "${token}" (tried ${candidates.indexOf(token) + 1}/${candidates.length})`);
        return token;
      }
    } catch { /* */ }
  }
  console.log(`[Greenhouse API] Could not discover board token for job ${jobId} (tried: ${candidates.join(", ")})`);
  return null;
}

// ── Form Schema Fetching ──

/** Fetch the job posting details including custom questions */
export async function fetchGreenhouseFormSchema(
  boardToken: string,
  jobId: string,
): Promise<FormSchema> {
  const url = `${GREENHOUSE_API}/${boardToken}/jobs/${jobId}?questions=true`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Greenhouse API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const questions = data.questions || [];
  const fields: FormField[] = [];
  const customQuestions: FormField[] = [];

  for (const q of questions) {
    const field: FormField = {
      id: q.fields?.[0]?.name || `question_${q.id}`,
      label: q.label || q.name || "",
      type: mapGreenhouseFieldType(q.fields?.[0]?.type),
      required: q.required || false,
      options: q.fields?.[0]?.values?.map((v: any) => v.label || v.value) || undefined,
    };

    // Standard fields
    if (["first_name", "last_name", "email", "phone", "resume", "cover_letter", "location"].includes(field.id)) {
      fields.push(field);
    } else {
      customQuestions.push(field);
    }
  }

  return {
    platform: "greenhouse",
    jobId,
    boardToken,
    fields,
    customQuestions,
  };
}

function mapGreenhouseFieldType(ghType: string): FormField["type"] {
  switch (ghType) {
    case "input_text": return "text";
    case "textarea": return "textarea";
    case "multi_value_single_select": return "select";
    case "multi_value_multi_select": return "multi_select";
    case "input_file": return "file";
    case "input_hidden": return "text";
    default: return "text";
  }
}

// ── AI Question Answering ──

/** Answer custom questions — delegates to unified AI client (Claude preferred, OpenAI fallback) */
export async function answerCustomQuestions(
  aiClient: any,
  questions: FormField[],
  applicant: ApplicantData,
  jobTitle: string,
  company: string,
): Promise<Map<string, string>> {
  return answerQuestions(aiClient, questions, applicant, jobTitle, company);
}

// ── Direct Submission ──

/** Submit application directly via Greenhouse Job Board API */
export async function submitGreenhouseApplication(
  boardToken: string,
  jobId: string,
  applicant: ApplicantData,
  customAnswers: Map<string, string>,
  schema: FormSchema,
): Promise<DirectSubmitResult> {
  const url = `${GREENHOUSE_API}/${boardToken}/jobs/${jobId}`;
  const steps: string[] = [];

  // Build multipart form data
  const formData = new FormData();

  // Standard fields
  formData.append("first_name", applicant.firstName);
  formData.append("last_name", applicant.lastName);
  formData.append("email", applicant.email);
  steps.push(`Set first_name: ${applicant.firstName}`);
  steps.push(`Set last_name: ${applicant.lastName}`);
  steps.push(`Set email: ${applicant.email}`);

  if (applicant.phone) {
    formData.append("phone", applicant.phone);
    steps.push(`Set phone: ${applicant.phone}`);
  }

  if (applicant.location) {
    formData.append("location", applicant.location);
    steps.push(`Set location: ${applicant.location}`);
  }

  // Resume file upload
  if (applicant.resumeFilePath && fs.existsSync(applicant.resumeFilePath)) {
    const resumeBuffer = fs.readFileSync(applicant.resumeFilePath);
    const fileName = path.basename(applicant.resumeFilePath);
    const blob = new Blob([resumeBuffer], { type: "application/pdf" });
    formData.append("resume", blob, fileName);
    steps.push(`Attached resume: ${fileName}`);
  }

  // Cover letter as text
  if (applicant.coverLetterText) {
    const coverBlob = new Blob([applicant.coverLetterText], { type: "text/plain" });
    formData.append("cover_letter", coverBlob, "cover_letter.txt");
    steps.push("Attached cover letter");
  }

  // Custom question answers
  Array.from(customAnswers.entries()).forEach(([fieldId, answer]) => {
    formData.append(fieldId, answer);
    steps.push(`Answered "${fieldId}": ${answer.slice(0, 50)}`);
  });

  // GDPR consent (required by some companies)
  formData.append("data_compliance[gdpr_processing_consent_given]", "true");
  formData.append("data_compliance[gdpr_retention_consent_given]", "true");

  console.log(`[Greenhouse API] Submitting to ${url} with ${steps.length} fields...`);

  try {
    const res = await fetch(url, {
      method: "POST",
      body: formData,
      headers: {
        // No auth needed for public job board submissions
        "Accept": "application/json",
      },
    });

    const responseText = await res.text();
    let responseBody: any;
    try { responseBody = JSON.parse(responseText); } catch { responseBody = responseText; }

    if (res.ok) {
      console.log(`[Greenhouse API] ✅ Success: ${res.status}`);
      return {
        success: true,
        platform: "greenhouse",
        method: "api",
        message: `Application submitted successfully via API. ${typeof responseBody === "object" ? (responseBody.message || "") : ""}`.trim(),
        httpStatus: res.status,
        responseBody: responseText.slice(0, 500),
        fieldsSubmitted: steps.length,
        stepsCompleted: steps,
      };
    } else {
      const errorMsg = typeof responseBody === "object"
        ? (responseBody.message || responseBody.error || JSON.stringify(responseBody))
        : responseText.slice(0, 200);
      console.log(`[Greenhouse API] ❌ Failed: ${res.status} — ${errorMsg}`);
      return {
        success: false,
        platform: "greenhouse",
        method: "api",
        message: `API submission failed (${res.status}): ${errorMsg}`,
        httpStatus: res.status,
        responseBody: responseText.slice(0, 500),
        fieldsSubmitted: steps.length,
        stepsCompleted: steps,
      };
    }
  } catch (err) {
    return {
      success: false,
      platform: "greenhouse",
      method: "api",
      message: `API request error: ${(err as Error).message}`,
      fieldsSubmitted: steps.length,
      stepsCompleted: steps,
    };
  }
}

// ── High-Level Orchestrator ──

/** Complete Greenhouse application via direct API — no browser needed */
export async function applyGreenhouseViaAPI(
  jobUrl: string,
  applicant: ApplicantData,
  openai?: any,
  jobTitle?: string,
  company?: string,
): Promise<DirectSubmitResult> {
  const parsed = parseGreenhouseUrl(jobUrl);
  if (!parsed) {
    return {
      success: false,
      platform: "greenhouse",
      method: "api",
      message: `Could not parse Greenhouse URL: ${jobUrl}`,
      fieldsSubmitted: 0,
      stepsCompleted: [],
    };
  }

  let { boardToken, jobId } = parsed;
  console.log(`[Greenhouse API] Board: ${boardToken}, Job: ${jobId}`);

  // 1. Fetch form schema (with board token discovery fallback for gh_jid URLs)
  let schema: FormSchema;
  try {
    schema = await fetchGreenhouseFormSchema(boardToken, jobId);
  } catch (schemaErr: any) {
    // If 404, the board token might be wrong — try discovery
    if (schemaErr.message?.includes("404") || schemaErr.message?.includes("error")) {
      console.log(`[Greenhouse API] Schema fetch failed with "${boardToken}", trying board token discovery...`);
      const discovered = await discoverBoardToken(jobId, boardToken);
      if (discovered) {
        boardToken = discovered;
        schema = await fetchGreenhouseFormSchema(boardToken, jobId);
      } else {
        throw schemaErr;
      }
    } else {
      throw schemaErr;
    }
  }
  console.log(`[Greenhouse API] Form has ${schema.fields.length} standard fields, ${schema.customQuestions.length} custom questions`);

  // 2. Answer custom questions with AI
  let customAnswers = new Map<string, string>();
  if (schema.customQuestions.length > 0 && openai) {
    customAnswers = await answerCustomQuestions(
      openai,
      schema.customQuestions,
      applicant,
      jobTitle || "Software Engineer",
      company || boardToken,
    );
    console.log(`[Greenhouse API] AI answered ${customAnswers.size}/${schema.customQuestions.length} questions`);
  }

  // 3. Submit
  return await submitGreenhouseApplication(boardToken, jobId, applicant, customAnswers, schema);
}

// ── Hybrid Submission (Browser + Deterministic Fill) ──
//
// Instead of using the REST API (which needs Basic Auth) or the AI agent (slow, iterative),
// this navigates directly to the Greenhouse embed form URL, extracts anti-bot tokens from
// the DOM, fills all fields in one shot, uploads the resume, and clicks submit.
//
// Key insight: the embed form at boards.greenhouse.io POSTs as a regular web form —
// no API key needed. By navigating directly (not in an iframe), there are no cross-origin
// issues for file uploads.

export async function applyGreenhouseHybrid(
  page: any,
  boardToken: string,
  jobId: string,
  applicant: ApplicantData,
  openai?: any,
  jobTitle?: string,
  company?: string,
): Promise<DirectSubmitResult> {
  const steps: string[] = [];

  // 1. Navigate directly to the Greenhouse embed form
  const embedUrl = `https://boards.greenhouse.io/embed/job_app?for=${boardToken}&token=${jobId}`;
  console.log(`[Greenhouse Hybrid] Navigating to ${embedUrl}`);

  try {
    await page.goto(embedUrl, { waitUntil: "networkidle", timeout: 20000 });
  } catch {
    try { await page.goto(embedUrl, { waitUntil: "domcontentloaded", timeout: 15000 }); } catch { /* */ }
  }

  try {
    await page.waitForSelector("#application_form", { timeout: 10000 });
  } catch {
    return {
      success: false, platform: "greenhouse", method: "hybrid",
      message: "Could not load Greenhouse application form",
      fieldsSubmitted: 0, stepsCompleted: steps,
    };
  }
  steps.push("Loaded Greenhouse application form");

  // 2. Extract anti-bot tokens + question structure from the DOM
  const formInfo = await page.evaluate(`(() => {
    var form = document.getElementById("application_form");
    var formAction = form ? form.action : "";
    var fp = document.getElementById("fingerprint");
    var rd = document.getElementById("render_date");
    var plt = document.getElementById("page_load_time");

    var questions = [];
    for (var i = 0; i < 30; i++) {
      var qidEl = document.getElementById("job_application_answers_attributes_" + i + "_question_id");
      if (!qidEl) continue;

      var priorityEl = document.getElementById("job_application_answers_attributes_" + i + "_priority");
      var textEl = document.getElementById("job_application_answers_attributes_" + i + "_text_value");
      var boolEl = document.getElementById("job_application_answers_attributes_" + i + "_boolean_value");

      var container = qidEl.closest(".field") || (qidEl.parentElement ? qidEl.parentElement.parentElement : null);
      var selectEl = container ? container.querySelector("select") : null;
      var checkboxEls = container ? container.querySelectorAll("input[type='checkbox']") : [];

      var type = "text";
      if (checkboxEls.length > 0) type = "checkbox";
      else if (boolEl) type = "boolean";
      else if (selectEl) type = "select";

      var labelEl = container ? container.querySelector("label") : null;
      var label = labelEl ? labelEl.textContent.replace(/\\s*\\*\\s*$/, "").trim() : "Question " + i;

      var options = [];
      if (type === "checkbox") {
        for (var ci = 0; ci < checkboxEls.length; ci++) {
          var cbParent = checkboxEls[ci].closest("label, li, div");
          var cbText = "";
          if (cbParent && cbParent.tagName === "LABEL") cbText = cbParent.textContent.trim();
          else if (cbParent && cbParent.tagName === "LI") cbText = cbParent.textContent.trim();
          else if (checkboxEls[ci].nextSibling && checkboxEls[ci].nextSibling.textContent) cbText = checkboxEls[ci].nextSibling.textContent.trim();
          options.push({ id: checkboxEls[ci].id, label: cbText.slice(0, 50) || "Option " + ci });
        }
      } else if (selectEl) {
        for (var j = 0; j < selectEl.options.length; j++) {
          var opt = selectEl.options[j];
          if (opt.value) options.push({ id: opt.value, label: opt.text.trim() });
        }
      }

      questions.push({
        index: i,
        questionId: qidEl.value,
        priority: priorityEl ? priorityEl.value : String(i),
        type: type,
        label: label,
        options: options,
        inputId: textEl ? textEl.id : (boolEl ? boolEl.id : ""),
        selectId: selectEl ? selectEl.id : ""
      });
    }

    return {
      formAction: formAction,
      fingerprint: fp ? fp.value : "",
      renderDate: rd ? rd.value : "",
      pageLoadTime: plt ? plt.value : "",
      questions: questions
    };
  })()`);

  console.log(`[Greenhouse Hybrid] Form action: ${formInfo.formAction}`);
  console.log(`[Greenhouse Hybrid] Tokens: fp=${formInfo.fingerprint.slice(0, 10)}..., render=${formInfo.renderDate}`);
  console.log(`[Greenhouse Hybrid] ${formInfo.questions.length} custom questions found`);

  // 3. Use AI to answer custom questions
  const customQs: FormField[] = formInfo.questions.map((q: any) => ({
    id: String(q.index),
    label: q.label + (q.type === "checkbox" ? " (check all that apply)" : ""),
    type: q.type === "select" || q.type === "checkbox" ? "select" as const : q.type === "boolean" ? "boolean" as const : "text" as const,
    required: true,
    options: q.options.map((o: any) => o.label),
  }));

  let aiAnswers = new Map<string, string>();
  if (customQs.length > 0 && openai) {
    aiAnswers = await answerCustomQuestions(openai, customQs, applicant, jobTitle || "Software Engineer", company || boardToken);
    console.log(`[Greenhouse Hybrid] AI answered ${aiAnswers.size}/${customQs.length} questions`);
    steps.push(`AI answered ${aiAnswers.size} custom questions`);
  }

  // 4. Fill ALL form fields via page.evaluate() — React-aware, one-shot
  const answersObj = Object.fromEntries(aiAnswers);
  const fillData = {
    firstName: applicant.firstName,
    lastName: applicant.lastName,
    email: applicant.email,
    phone: applicant.phone || "",
    location: applicant.location || "",
    coverLetterText: applicant.coverLetterText || "",
    questions: formInfo.questions,
    answers: answersObj,
  };

  const fillResult = await page.evaluate(`((data) => {
    var filled = [];
    var missed = [];

    function setValue(el, val) {
      var proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      var setter = Object.getOwnPropertyDescriptor(proto, "value");
      if (setter && setter.set) setter.set.call(el, val);
      else el.value = val;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }

    // Standard fields
    var stdFields = [
      ["first_name", data.firstName],
      ["last_name", data.lastName],
      ["email", data.email],
      ["phone", data.phone]
    ];
    for (var i = 0; i < stdFields.length; i++) {
      var id = stdFields[i][0], val = stdFields[i][1];
      if (!val) continue;
      var el = document.getElementById(id);
      if (el) { setValue(el, val); filled.push(id); }
      else missed.push(id);
    }

    // Location — just set value here; autocomplete selection done outside evaluate
    if (data.location) {
      var locEl = document.querySelector("#auto_complete_input, #candidate-location, input[name*='location']");
      if (locEl) { setValue(locEl, data.location); filled.push("location"); }
    }

    // Custom questions
    for (var qi = 0; qi < data.questions.length; qi++) {
      var q = data.questions[qi];
      var answer = data.answers[String(q.index)];
      if (!answer) continue;

      if (q.type === "text" && q.inputId) {
        var tEl = document.getElementById(q.inputId);
        if (tEl) { setValue(tEl, answer); filled.push("q" + q.index + ":" + q.label.slice(0, 25)); }
      } else if (q.type === "boolean" && q.inputId) {
        // Greenhouse boolean fields are <select> elements with Yes/No options
        var bEl = document.getElementById(q.inputId);
        if (bEl) {
          var isYes = answer.toLowerCase() === "yes" || answer === "true" || answer === "1";
          var boolVal = isYes ? "1" : "0";
          // Try as select first (most common)
          if (bEl.tagName === "SELECT") {
            for (var bi = 0; bi < bEl.options.length; bi++) {
              var bOptText = bEl.options[bi].text.trim().toLowerCase();
              if ((isYes && bOptText === "yes") || (!isYes && bOptText === "no")) {
                bEl.value = bEl.options[bi].value;
                bEl.dispatchEvent(new Event("change", { bubbles: true }));
                filled.push("q" + q.index + ":bool=" + bOptText);
                break;
              }
            }
          } else {
            // Fallback: checkbox
            bEl.checked = isYes;
            bEl.dispatchEvent(new Event("change", { bubbles: true }));
            filled.push("q" + q.index + ":bool=" + isYes);
          }
        }
      } else if (q.type === "checkbox" && q.options && q.options.length > 0) {
        var cbAnswers = answer.split(",").map(function(x) { return x.trim().toLowerCase(); });
        var cbChecked = 0;
        for (var cbi = 0; cbi < q.options.length; cbi++) {
          var cbEl = document.getElementById(q.options[cbi].id);
          if (!cbEl) continue;
          var cbOpt = q.options[cbi].label.toLowerCase();
          var shouldCheck = false;
          for (var ca = 0; ca < cbAnswers.length; ca++) {
            if (cbOpt.includes(cbAnswers[ca]) || cbAnswers[ca].includes(cbOpt.slice(0,15)) ||
                cbOpt.includes(cbAnswers[ca].split(" ")[0]) || cbAnswers[ca].split(" ").some(function(w) { return w.length > 4 && cbOpt.includes(w); })) {
              shouldCheck = true; break;
            }
          }
          if (shouldCheck) {
            cbEl.checked = true;
            cbEl.dispatchEvent(new Event("change", { bubbles: true }));
            cbChecked++;
          }
        }
        if (cbChecked > 0) filled.push("q" + q.index + ":cb=" + cbChecked);
        else missed.push("q" + q.index + ":cb-no-match(" + answer.slice(0, 20) + ")");
      } else if (q.type === "select" && q.selectId) {
        var sEl = document.getElementById(q.selectId);
        if (sEl) {
          var matched = false;
          var ansLow = answer.toLowerCase().trim();
          var countryMap = {"united states":"us","us":"united states","usa":"united states","united kingdom":"uk","uk":"united kingdom"};
          var altAns = countryMap[ansLow] || "";
          // Pass 1: exact match (including country aliases)
          for (var si = 0; si < sEl.options.length && !matched; si++) {
            var optText = sEl.options[si].text.trim();
            var optLow1 = optText.toLowerCase();
            if (optText === answer || optLow1 === ansLow || (altAns && optLow1 === altAns)) {
              sEl.value = sEl.options[si].value; sEl.dispatchEvent(new Event("change", { bubbles: true }));
              filled.push("q" + q.index + ":" + optText.slice(0, 25)); matched = true;
            }
          }
          // Pass 2: fuzzy match
          for (var si2 = 0; si2 < sEl.options.length && !matched; si2++) {
            var optLow = sEl.options[si2].text.trim().toLowerCase();
            if (optLow.startsWith(ansLow.slice(0, 15)) || ansLow.startsWith(optLow.slice(0, 15)) ||
                optLow.includes(ansLow) || ansLow.includes(optLow) ||
                (altAns && (optLow === altAns || optLow.includes(altAns) || altAns.includes(optLow)))) {
              sEl.value = sEl.options[si2].value; sEl.dispatchEvent(new Event("change", { bubbles: true }));
              filled.push("q" + q.index + ":" + sEl.options[si2].text.trim().slice(0, 25)); matched = true;
            }
          }
          if (!matched) missed.push("q" + q.index + ":no-match(" + answer.slice(0, 20) + ")");
        }
      }
    }

    // Cover letter
    if (data.coverLetterText) {
      var clEl = document.getElementById("cover_letter_text");
      if (clEl) { setValue(clEl, data.coverLetterText); filled.push("cover_letter"); }
    }

    // Demographic/EEO selects — fill with "Decline" values
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
      if (!sel || sel.tagName !== "SELECT" || sel.selectedIndex > 0) return;
      for (var oi = 0; oi < sel.options.length; oi++) {
        if (sel.options[oi].text.trim().toLowerCase().includes(searchText)) {
          sel.value = sel.options[oi].value;
          sel.dispatchEvent(new Event("change", { bubbles: true }));
          var s2span = document.getElementById("select2-chosen-" + selId.replace(/[^0-9]/g, "").slice(-1));
          if (s2span) s2span.textContent = sel.options[oi].text.trim();
          filled.push(filledName);
          break;
        }
      }
    }
    setSelect2OrNative("education_degree_0", "bachelor", "edu:degree");
    setSelect2OrNative("education_degree", "bachelor", "edu:degree");
    setSelect2OrNative("education_discipline_0", "computer science", "edu:discipline");
    setSelect2OrNative("education_discipline", "computer science", "edu:discipline");

    // Work experience fields
    var companyInput = document.getElementById("employment_company_name_0") || document.querySelector("input[name*='employment'][name*='company']");
    if (companyInput && !companyInput.value) { setValue(companyInput, "Intuit"); filled.push("work:company"); }
    var titleInput = document.getElementById("employment_title_0") || document.querySelector("input[name*='employment'][name*='title']");
    if (titleInput && !titleInput.value) { setValue(titleInput, "Senior Software Engineer"); filled.push("work:title"); }
    var empStartM = document.querySelector("input[name*='employment'][name*='start_date'][name*='month']");
    if (empStartM && !empStartM.value) { setValue(empStartM, "01"); filled.push("work:startM"); }
    var empStartY = document.querySelector("input[name*='employment'][name*='start_date'][name*='year']");
    if (empStartY && !empStartY.value) { setValue(empStartY, "2020"); filled.push("work:startY"); }
    var empCurrent = document.getElementById("employment_current_0");
    if (empCurrent && !empCurrent.checked) { empCurrent.checked = true; empCurrent.dispatchEvent(new Event("change", { bubbles: true })); filled.push("work:current"); }

    return { filled: filled, missed: missed };
  })(${JSON.stringify(fillData)})`);

  console.log(`[Greenhouse Hybrid] Filled: ${fillResult.filled.join(", ")}`);
  if (fillResult.missed.length > 0) console.log(`[Greenhouse Hybrid] Missed: ${fillResult.missed.join(", ")}`);
  steps.push(`Filled ${fillResult.filled.length} fields`);
  for (const f of fillResult.filled) steps.push(`Set ${f}`);

  // 4b. Education school — Select2 dropdown with search, or native autocomplete
  try {
    const schoolS2 = await page.$("#s2id_education_school_name_0 a, #s2id_education_school_name a");
    if (schoolS2) {
      await schoolS2.click({ timeout: 5000 });
      await page.waitForTimeout(800);
      const searchInput = await page.$(".select2-drop-active .select2-input, .select2-search .select2-input");
      if (searchInput) {
        await searchInput.type("University of California", { delay: 30 });
        await page.waitForTimeout(2500);
        const result = await page.$(".select2-drop-active .select2-results li.select2-result");
        if (result) { await result.click(); console.log("[Greenhouse Hybrid] School selected via Select2"); }
        else { await page.keyboard.press("Enter"); }
      } else {
        await page.evaluate(`(() => {
          var el = document.getElementById('education_school_name_0');
          if (el) { el.value = '1'; var span = document.getElementById('select2-chosen-1'); if (span) span.textContent = 'University of California, Berkeley'; }
        })()`);
        console.log("[Greenhouse Hybrid] School set programmatically");
      }
      steps.push("Set education school");
    } else {
      const schoolInput = await page.$("#education_school_name_0_autocomplete, #education_school_name_autocomplete, input[id*='school_name'][id*='autocomplete']");
      if (schoolInput) {
        await schoolInput.click(); await schoolInput.fill("");
        await page.keyboard.type("University of California", { delay: 40 });
        await page.waitForTimeout(2000);
        const schoolSug = await page.$(".ui-autocomplete .ui-menu-item, .pac-item, [role='option']");
        if (schoolSug) { await schoolSug.click(); console.log("[Greenhouse Hybrid] School selected from autocomplete"); }
        else { await page.keyboard.press("ArrowDown"); await page.waitForTimeout(200); await page.keyboard.press("Enter"); }
        steps.push("Set education school");
      }
    }
  } catch {}

  // 4c. Location autocomplete — type into field and select from dropdown
  // Greenhouse uses Google Places autocomplete; just setting value isn't enough.
  // IMPORTANT: Validate suggestion text before clicking to prevent wrong location (e.g., Mexico).
  try {
    const locInput = await page.$("#auto_complete_input, #candidate-location, input[name*='location']");
    if (locInput && applicant.location) {
      await locInput.click();
      await locInput.fill("");
      await page.keyboard.type(applicant.location, { delay: 60 });
      await page.waitForTimeout(3000);
      const suggestion = await page.$(".pac-item, .location-autocomplete-item, [role='option'], #auto_complete_results li");
      if (suggestion) {
        const sugText = await suggestion.textContent().catch(() => "") || "";
        const cityWord = applicant.location.split(",")[0].trim().toLowerCase();
        if (sugText.toLowerCase().includes(cityWord)) {
          await suggestion.click();
          console.log(`[Greenhouse Hybrid] Location: selected "${sugText.trim().slice(0, 60)}"`);
          steps.push(`Selected location: ${sugText.trim().slice(0, 60)}`);
        } else {
          // Wrong suggestion — press Escape and keep typed text
          await page.keyboard.press("Escape");
          console.log(`[Greenhouse Hybrid] Location: kept typed "${applicant.location}" (bad suggestion: "${sugText.trim().slice(0, 40)}")`);
          steps.push(`Typed location: ${applicant.location}`);
        }
      } else {
        console.log(`[Greenhouse Hybrid] Location: no autocomplete, kept typed "${applicant.location}"`);
        steps.push(`Typed location: ${applicant.location}`);
      }
    }
  } catch (locErr) {
    console.log(`[Greenhouse Hybrid] Location autocomplete failed: ${(locErr as Error).message.slice(0, 60)}`);
  }

  // 5. Upload resume
  // S3-enabled forms: filechooser breaks CSRF tokens → use paste instead.
  // Non-S3 forms: Attach button creates a DOM file input → use setInputFiles.
  if (applicant.resumeFilePath && fs.existsSync(applicant.resumeFilePath)) {
    let resumeUploaded = false;
    const isS3 = await page.evaluate(`(() => {
      var el = document.querySelector('#resume_fieldset [data-allow-s3]');
      return el ? el.getAttribute('data-allow-s3') === 'true' : false;
    })()`);

    if (!isS3) {
      // Non-S3: click Attach → creates dynamic file input → setInputFiles
      try {
        const attachBtn = await page.$("#resume_fieldset button[data-source='attach'], button[data-source='attach']");
        if (attachBtn) {
          await attachBtn.click({ force: true });
          await page.waitForTimeout(1500);
        }
        const fileInput = await page.$("#resume_file, #resume_fieldset input[type='file']");
        if (fileInput) {
          await fileInput.setInputFiles(applicant.resumeFilePath);
          await page.waitForTimeout(2000);
          steps.push(`Uploaded resume: ${path.basename(applicant.resumeFilePath)}`);
          console.log(`[Greenhouse Hybrid] Resume uploaded via file input`);
          resumeUploaded = true;
        }
      } catch (uploadErr) {
        console.log(`[Greenhouse Hybrid] Resume Attach failed: ${(uploadErr as Error).message.slice(0, 80)}`);
      }
    }
    // Fallback: paste resume text if file upload didn't work
    if (!resumeUploaded && applicant.resumeText) {
      try {
        // Click "or enter manually" to show the paste textarea
        const pasteBtn = await page.$("#resume_fieldset button[data-source='paste']");
        if (pasteBtn) await pasteBtn.click({ force: true });
        await page.waitForTimeout(500);
        const resumeTextarea = await page.$("#resume_text");
        if (resumeTextarea) {
          await resumeTextarea.fill(applicant.resumeText.slice(0, 3000));
          steps.push("Pasted resume text (file upload fallback)");
          console.log("[Greenhouse Hybrid] Pasted resume text as fallback");
        }
      } catch { /* resume text fallback is best-effort */ }
    }
  }

  // 6. Take proof screenshot, then click submit
  await page.waitForTimeout(1000);
  let screenshotBeforeSubmit: string | undefined;
  try {
    const ssBuffer = await page.screenshot({ fullPage: true, timeout: 8000 });
    if (ssBuffer && ssBuffer.length > 100) {
      screenshotBeforeSubmit = ssBuffer.toString("base64");
      console.log(`[Greenhouse Hybrid] Pre-submit screenshot captured (${Math.round(ssBuffer.length / 1024)}KB)`);
      steps.push("Pre-submit screenshot captured");
    }
  } catch { /* screenshot is best-effort */ }

  // Submit via programmatic JS click — Greenhouse's submit button has JS handlers
  // that add anti-bot data (fingerprint, render_date, page_load_time). form.submit()
  // and fetch() both bypass these → 400. The .click() is a pure JS invocation.
  try {
    const hasSubmitBtn = await page.$('#submit_app');
    if (hasSubmitBtn) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {}),
        page.evaluate(`document.getElementById("submit_app").click()`),
      ]);
      console.log("[Greenhouse Hybrid] Submitted via programmatic click");
      steps.push("Submitted form (programmatic)");
      await page.waitForTimeout(3000);
    } else {
      return {
        success: false, platform: "greenhouse", method: "hybrid",
        message: "Form filled but no submit button found",
        fieldsSubmitted: fillResult.filled.length, stepsCompleted: steps, screenshotBeforeSubmit,
      };
    }
  } catch (submitErr) {
    return {
      success: false, platform: "greenhouse", method: "hybrid",
      message: `Submit failed: ${(submitErr as Error).message}`,
      fieldsSubmitted: fillResult.filled.length, stepsCompleted: steps, screenshotBeforeSubmit,
    };
  }

  // 7. Analyze result
  const pageContent = await page.textContent("body").catch(() => "") || "";
  const currentUrl = page.url();
  console.log(`[Greenhouse Hybrid] Post-submit URL: ${currentUrl}`);
  console.log(`[Greenhouse Hybrid] Post-submit (300 chars): ${pageContent.slice(0, 300)}`);

  // Security code verification — try to handle it directly via Gmail API
  if (pageContent.toLowerCase().includes("security code") || pageContent.toLowerCase().includes("enter the code")) {
    steps.push("Security code verification required");
    console.log("[Greenhouse Hybrid] Security code page detected — attempting Gmail code retrieval");

    let codeEntered = false;
    try {
      const { fetchVerificationCode } = await import("../agent/verification");
      const code = await fetchVerificationCode(
        undefined, // dbUserId not available here
        applicant.email,
        "greenhouse-mail.io",
        60, // wait up to 60 seconds
        undefined, // no rootPage for browser fallback
      );
      if (code && !code.startsWith("RESET_LINK:")) {
        console.log(`[Greenhouse Hybrid] Got security code: ${code}`);
        // Set security code value via React-aware setter
        await page.evaluate(`((code) => {
          var el = document.getElementById("security_code");
          if (el) {
            var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
            if (setter && setter.set) setter.set.call(el, code); else el.value = code;
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
          }
        })(${JSON.stringify(code)})`);
        steps.push(`Entered security code: ${code}`);
        // Submit again via programmatic click
        await page.waitForTimeout(500);
        const hasSubmitBtn2 = await page.$("#submit_app");
        if (hasSubmitBtn2) {
          await Promise.all([
            page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {}),
            page.evaluate(`document.getElementById("submit_app").click()`),
          ]);
          console.log("[Greenhouse Hybrid] Submitted with security code (programmatic)");
          await page.waitForTimeout(3000);
          const finalContent = await page.textContent("body").catch(() => "") || "";
          const flc = finalContent.toLowerCase();
          if (flc.includes("thank you") || flc.includes("application received") || flc.includes("has been submitted") || flc.includes("application has been")) {
            steps.push("Confirmation after security code!");
            codeEntered = true;
            return {
              success: true, platform: "greenhouse", method: "hybrid",
              message: "Application submitted successfully via Greenhouse hybrid (with security code).",
              fieldsSubmitted: fillResult.filled.length, stepsCompleted: steps, screenshotBeforeSubmit,
            };
          }
          console.log(`[Greenhouse Hybrid] Post-code page (200 chars): ${finalContent.slice(0, 200)}`);
        }
      } else {
        console.log("[Greenhouse Hybrid] Could not retrieve security code from Gmail");
      }
    } catch (codeErr) {
      console.log(`[Greenhouse Hybrid] Security code handling failed: ${(codeErr as Error).message.slice(0, 80)}`);
    }

    if (!codeEntered) {
      // Fall through to AI agent — page is already on the security code screen
      return {
        success: false, platform: "greenhouse", method: "hybrid",
        message: "Form submitted but security code verification required. AI agent will handle.",
        fieldsSubmitted: fillResult.filled.length, stepsCompleted: steps, screenshotBeforeSubmit,
      };
    }
  }

  // Confirmation detected
  const lc = pageContent.toLowerCase();
  if (lc.includes("thank you") || lc.includes("application received") || lc.includes("has been submitted") || lc.includes("application has been")) {
    const confirmText = pageContent.slice(0, 200).trim();
    steps.push(`Confirmation: ${confirmText.slice(0, 80)}`);
    return {
      success: true, platform: "greenhouse", method: "hybrid",
      message: "Application submitted successfully via Greenhouse hybrid.",
      fieldsSubmitted: fillResult.filled.length, stepsCompleted: steps, screenshotBeforeSubmit,
    };
  }

  // Validation errors
  const errors = await page.evaluate(`(() => {
    var els = document.querySelectorAll(".field_with_errors, .error-message, .form-error, [class*='error']");
    var errs = [];
    for (var i = 0; i < els.length && i < 5; i++) {
      var t = els[i].textContent ? els[i].textContent.trim() : "";
      if (t) errs.push(t);
    }
    return errs;
  })()`);

  if (errors.length > 0) {
    steps.push(`Validation errors: ${errors.join("; ").slice(0, 100)}`);
    return {
      success: false, platform: "greenhouse", method: "hybrid",
      message: `Form validation errors: ${errors.join("; ").slice(0, 200)}`,
      fieldsSubmitted: fillResult.filled.length, stepsCompleted: steps, screenshotBeforeSubmit,
    };
  }

  // Unknown result
  return {
    success: false, platform: "greenhouse", method: "hybrid",
    message: `Form submitted but outcome unclear. Page: ${pageContent.slice(0, 200)}`,
    fieldsSubmitted: fillResult.filled.length, stepsCompleted: steps, screenshotBeforeSubmit,
  };
}
