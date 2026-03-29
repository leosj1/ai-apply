// Lever Direct API Submission
// Uses Lever's public API: POST https://api.lever.co/v0/postings/{id}/apply
// No authentication required — accepts multipart/form-data.
// Docs: https://github.com/lever/postings-api
//
// Flow:
// 1. Fetch job posting + custom questions via public API
// 2. Use AI to answer custom questions
// 3. POST multipart/form-data to api.lever.co

/* eslint-disable @typescript-eslint/no-explicit-any */

import * as fs from "fs";
import * as path from "path";
import type { ApplicantData, FormField, FormSchema, DirectSubmitResult } from "./types";
import { answerQuestions } from "./ai-client";

const LEVER_API = "https://api.lever.co/v0/postings";

// ── URL Parsing ──

/** Extract company slug and posting ID from a Lever URL */
export function parseLeverUrl(url: string): { company: string; postingId: string } | null {
  // Format: https://jobs.lever.co/{company}/{posting_id}
  const match = url.match(/jobs\.lever\.co\/([^/]+)\/([a-f0-9-]+)/);
  if (match) return { company: match[1], postingId: match[2] };
  return null;
}

// ── Form Schema Fetching ──

/** Fetch job posting details and custom questions from Lever API */
export async function fetchLeverFormSchema(
  company: string,
  postingId: string,
): Promise<FormSchema & { leverPostingId: string; customLists: any[] }> {
  const res = await fetch(`${LEVER_API}/${company}/${postingId}`);
  if (!res.ok) {
    throw new Error(`Lever API error: ${res.status} ${res.statusText}`);
  }

  const posting = await res.json();

  // Standard fields (always required by Lever)
  const fields: FormField[] = [
    { id: "name", label: "Full Name", type: "text", required: true },
    { id: "email", label: "Email", type: "email", required: true },
    { id: "phone", label: "Phone", type: "phone", required: false },
    { id: "org", label: "Current Company", type: "text", required: false },
    { id: "urls[LinkedIn]", label: "LinkedIn URL", type: "url", required: false },
    { id: "urls[Portfolio]", label: "Portfolio URL", type: "url", required: false },
    { id: "resume", label: "Resume", type: "file", required: true },
  ];

  // Custom questions from the posting's "lists" field
  // NOTE: Lever's `lists` field contains job description sections (Responsibilities,
  // Qualifications), NOT custom application questions. Custom questions are only
  // visible in the rendered application form HTML and not exposed via the public API.
  const customQuestions: FormField[] = [];

  return {
    platform: "lever",
    jobId: postingId,
    fields,
    customQuestions,
    leverPostingId: posting.id || postingId,
    customLists: posting.lists || [],
  };
}

// ── Card Field Scraping ──

/**
 * Scrape custom card field names + default answers from the Lever apply page HTML.
 * The Lever public API schema does NOT expose these — they're only in the rendered form.
 * Returns a map of field name → default answer ("No" for work-auth, last option for EEO).
 */
async function scrapeCardFields(company: string, postingId: string): Promise<Map<string, string>> {
  const fields = new Map<string, string>();
  try {
    const res = await fetch(`https://jobs.lever.co/${company}/${postingId}/apply`, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) { console.log(`[Lever API] Form scrape ${res.status} — skipping card fields`); return fields; }
    const html = await res.text();

    // Collect all radio groups: name → [value, value, ...]
    const radioGroups = new Map<string, string[]>();
    const addRadio = (name: string, val: string) => {
      if (!radioGroups.has(name)) radioGroups.set(name, []);
      if (!radioGroups.get(name)!.includes(val)) radioGroups.get(name)!.push(val);
    };
    Array.from(html.matchAll(/type=["']radio["'][^>]*name=["'](cards\[[^\]]+\]\[field\d+\])["'][^>]*value=["']([^"']*)["']/g))
      .forEach(m => addRadio(m[1], m[2]));
    Array.from(html.matchAll(/name=["'](cards\[[^\]]+\]\[field\d+\])["'][^>]*type=["']radio["'][^>]*value=["']([^"']*)["']/g))
      .forEach(m => addRadio(m[1], m[2]));
    Array.from(radioGroups.entries()).forEach(([name, opts]) => {
      // Prefer "No" for work-auth/sponsorship; otherwise last option ("Decline to identify")
      const noOpt = opts.find((o: string) => /^no$/i.test(o.trim()));
      fields.set(name, noOpt ?? opts[opts.length - 1]);
    });

    // Select dropdowns: last option
    Array.from(html.matchAll(/<select[^>]*name=["'](cards\[[^\]]+\]\[field\d+\])["'][^>]*>([\s\S]*?)<\/select>/g))
      .forEach(m => {
        const optVals = Array.from(m[2].matchAll(/value=["']([^"']+)["']/g)).map(x => x[1]).filter(v => v);
        if (optVals.length) fields.set(m[1], optVals[optVals.length - 1]);
      });

    console.log(`[Lever API] Scraped ${fields.size} card fields from form HTML`);
  } catch (e: any) {
    console.log(`[Lever API] Card scrape failed: ${e.message?.slice(0, 60)}`);
  }
  return fields;
}

// ── AI Question Answering ──

/** Answer custom questions — delegates to unified AI client (Claude preferred, OpenAI fallback) */
export async function answerLeverQuestions(
  aiClient: any,
  questions: FormField[],
  applicant: ApplicantData,
  jobTitle: string,
  company: string,
): Promise<Map<string, string>> {
  return answerQuestions(aiClient, questions, applicant, jobTitle, company);
}

// ── Direct Submission ──

/** Submit application via Lever's public API */
export async function submitLeverApplication(
  company: string,
  postingId: string,
  applicant: ApplicantData,
  customAnswers: Map<string, string>,
): Promise<DirectSubmitResult> {
  const steps: string[] = [];

  const formData = new FormData();

  // Standard fields
  formData.append("name", `${applicant.firstName} ${applicant.lastName}`);
  steps.push(`Set name: ${applicant.firstName} ${applicant.lastName}`);

  formData.append("email", applicant.email);
  steps.push(`Set email: ${applicant.email}`);

  if (applicant.phone) {
    formData.append("phone", applicant.phone);
    steps.push(`Set phone: ${applicant.phone}`);
  }

  if (applicant.currentTitle) {
    formData.append("org", applicant.currentTitle);
    steps.push(`Set org: ${applicant.currentTitle}`);
  }

  if (applicant.linkedIn) {
    formData.append("urls[LinkedIn]", applicant.linkedIn);
    steps.push(`Set LinkedIn: ${applicant.linkedIn}`);
  }

  // Cover letter (Lever uses 'comments' field for cover letter text)
  if (applicant.coverLetterText) {
    formData.append("comments", applicant.coverLetterText);
    steps.push("Attached cover letter");
  }

  // Resume file
  if (applicant.resumeFilePath && fs.existsSync(applicant.resumeFilePath)) {
    const resumeBuffer = fs.readFileSync(applicant.resumeFilePath);
    const fileName = path.basename(applicant.resumeFilePath);
    const blob = new Blob([new Uint8Array(resumeBuffer)], { type: "application/pdf" });
    formData.append("resume", blob, fileName);
    steps.push(`Attached resume: ${fileName}`);
  }

  // Custom question answers
  for (const [fieldId, answer] of Array.from(customAnswers.entries())) {
    formData.append(fieldId, answer);
    steps.push(`Answered "${fieldId}": ${answer.slice(0, 50)}`);
  }

  // Scrape and include custom card fields (work auth, EEO, etc.) — not in public API schema
  const cardFields = await scrapeCardFields(company, postingId);
  Array.from(cardFields.entries()).forEach(([key, val]) => {
    if (!customAnswers.has(key)) {
      formData.append(key, val);
      steps.push(`Card: ${key.slice(0, 50)} = ${val}`);
    }
  });

  // Consent and source
  formData.append("consent[marketing]", "false");
  formData.append("consent[store]", "true");

  // Lever's public apply endpoint uses posting ID only (no company slug)
  const submitUrl = `${LEVER_API}/${postingId}/apply`;
  console.log(`[Lever API] Submitting to ${submitUrl} with ${steps.length} fields...`);

  try {
    const res = await fetch(submitUrl, {
      method: "POST",
      body: formData,
    });

    const responseText = await res.text();
    let responseBody: any;
    try { responseBody = JSON.parse(responseText); } catch { responseBody = responseText; }

    if (res.ok && responseBody?.ok !== false) {
      console.log(`[Lever API] ✅ Success: ${res.status}`);
      return {
        success: true,
        platform: "lever",
        method: "api",
        message: "Application submitted successfully via Lever API.",
        httpStatus: res.status,
        responseBody: responseText.slice(0, 500),
        fieldsSubmitted: steps.length,
        stepsCompleted: steps,
      };
    } else {
      const errorMsg = responseBody?.error
        ? JSON.stringify(responseBody.error)
        : (typeof responseBody === "object" ? JSON.stringify(responseBody) : responseText.slice(0, 200));
      console.log(`[Lever API] ❌ Failed: ${res.status} — ${errorMsg}`);
      return {
        success: false,
        platform: "lever",
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
      platform: "lever",
      method: "api",
      message: `API request error: ${(err as Error).message}`,
      fieldsSubmitted: steps.length,
      stepsCompleted: steps,
    };
  }
}

// ── High-Level Orchestrator ──

/** Apply to a Lever job via direct API */
export async function applyLeverViaAPI(
  jobUrl: string,
  applicant: ApplicantData,
  openai?: any,
  jobTitle?: string,
  company?: string,
): Promise<DirectSubmitResult> {
  const parsed = parseLeverUrl(jobUrl);
  if (!parsed) {
    return {
      success: false, platform: "lever", method: "api",
      message: `Could not parse Lever URL: ${jobUrl}`,
      fieldsSubmitted: 0, stepsCompleted: [],
    };
  }

  try {
    // 1. Fetch schema
    console.log(`[Lever API] Fetching schema for ${parsed.company}/${parsed.postingId}...`);
    const schema = await fetchLeverFormSchema(parsed.company, parsed.postingId);
    console.log(`[Lever API] ${schema.fields.length} standard fields, ${schema.customQuestions.length} custom questions`);

    // 2. Answer custom questions with AI
    let customAnswers = new Map<string, string>();
    if (schema.customQuestions.length > 0 && openai) {
      customAnswers = await answerLeverQuestions(
        openai, schema.customQuestions, applicant,
        jobTitle || "Software Engineer", company || parsed.company,
      );
      console.log(`[Lever API] AI answered ${customAnswers.size}/${schema.customQuestions.length} questions`);
    }

    // 3. Submit
    return await submitLeverApplication(parsed.company, parsed.postingId, applicant, customAnswers);
  } catch (err) {
    return {
      success: false, platform: "lever", method: "api",
      message: `Lever API error: ${(err as Error).message}`,
      fieldsSubmitted: 0, stepsCompleted: [],
    };
  }
}
