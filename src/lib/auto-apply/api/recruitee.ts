// Recruitee Application API
// Recruitee has a public REST API — no company API key required.
//
// Public endpoints:
//   GET  https://{company}.recruitee.com/api/v1/careers/{offer_slug}  — job + form fields
//   POST https://{company}.recruitee.com/api/v1/careers/{offer_slug}/apply — submit application
//
// Resume must be uploaded as base64 in the JSON payload.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { readFileSync } from "fs";
import { basename } from "path";
import type { ApplicantData } from "./types";
import { answerQuestions } from "./ai-client";

// ── URL Parsing ──

export interface RecruiteeJob {
  company: string;   // subdomain, e.g. "acme"
  slug: string;      // offer slug, e.g. "software-engineer-123456"
}

/** Extract company subdomain and offer slug from a Recruitee URL */
export function parseRecruiteeUrl(url: string): RecruiteeJob | null {
  // https://{company}.recruitee.com/o/{slug}
  // https://{company}.recruitee.com/o/{slug}/c/{city}
  const match = url.match(/https?:\/\/([^.]+)\.recruitee\.com\/o\/([^/?#]+)/i);
  if (match) return { company: match[1], slug: match[2] };
  return null;
}

// ── Schema Fetching ──

export interface RecruiteeField {
  name: string;
  label: string;
  type: string;
  required: boolean;
  options?: string[];
}

export interface RecruiteeSchema {
  jobTitle: string;
  companyName: string;
  fields: RecruiteeField[];
  customQuestions: RecruiteeField[];
}

const STANDARD_FIELDS = new Set([
  "name", "email", "phone", "cover_letter", "resume",
  "linkedin", "github", "portfolio", "website",
]);

export async function fetchRecruiteeSchema(company: string, slug: string): Promise<RecruiteeSchema> {
  const res = await fetch(`https://${company}.recruitee.com/api/v1/careers/${slug}`, {
    headers: { "Accept": "application/json" },
  });
  if (!res.ok) throw new Error(`Recruitee API ${res.status}: ${res.statusText}`);
  const data = await res.json();

  const offer = data.offer || data;
  const jobTitle = offer.title || offer.position || slug;
  const companyName = offer.company_name || company;

  const fields: RecruiteeField[] = [];
  const customQuestions: RecruiteeField[] = [];

  // Parse custom questions from the offer schema
  const sections = offer.sections || offer.fields || [];
  for (const section of sections) {
    const sectionFields = section.fields || (Array.isArray(section) ? section : [section]);
    for (const f of sectionFields) {
      if (!f || !f.name) continue;
      const field: RecruiteeField = {
        name: f.name,
        label: f.label || f.name,
        type: f.type || "text",
        required: !!f.required,
        options: f.options?.map((o: any) => o.label || o.name || o) || undefined,
      };
      if (STANDARD_FIELDS.has(f.name.toLowerCase())) {
        fields.push(field);
      } else {
        customQuestions.push(field);
      }
    }
  }

  return { jobTitle, companyName, fields, customQuestions };
}

// ── AI Question Answering ──

export async function answerRecruiteeQuestions(
  aiClient: any,
  questions: RecruiteeField[],
  applicant: ApplicantData,
  jobTitle: string,
  company: string,
): Promise<Map<string, string>> {
  if (questions.length === 0) return new Map();
  const mapped = questions.map((q) => ({
    id: q.name,
    label: q.label,
    type: q.type as any,
    required: q.required,
    options: q.options,
  }));
  return answerQuestions(aiClient, mapped, applicant, jobTitle, company);
}

// ── Application Submission ──

export interface RecruiteeApplyResult {
  success: boolean;
  message: string;
  candidateId?: string;
}

export async function applyViaRecruiteeAPI(
  company: string,
  slug: string,
  applicant: ApplicantData,
  aiAnswers: Map<string, string>,
  jobTitle: string,
): Promise<RecruiteeApplyResult> {
  // Build application payload
  const payload: Record<string, any> = {
    candidate: {
      name: `${applicant.firstName} ${applicant.lastName}`,
      email: applicant.email,
      phone: applicant.phone || "",
      cover_letter: applicant.coverLetterText || "",
    },
    answers: [] as any[],
  };

  // Add AI-answered custom questions
  for (const [name, value] of Array.from(aiAnswers)) {
    payload.answers.push({ name, value });
  }

  // Attach resume as base64 if available
  if (applicant.resumeFilePath) {
    try {
      const fileBuffer = readFileSync(applicant.resumeFilePath);
      const base64 = fileBuffer.toString("base64");
      const filename = basename(applicant.resumeFilePath);
      payload.candidate.cv = {
        filename,
        data: base64,
      };
    } catch {
      console.log("[Recruitee] Could not read resume file for upload");
    }
  }

  const res = await fetch(`https://${company}.recruitee.com/api/v1/careers/${slug}/apply`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (res.ok) {
    const data = await res.json().catch(() => ({}));
    return {
      success: true,
      message: "Application submitted via Recruitee API",
      candidateId: data.candidate?.id || data.id,
    };
  }

  // Parse error
  const errText = await res.text().catch(() => "");
  let errMsg = `Recruitee API error ${res.status}`;
  try {
    const errJson = JSON.parse(errText);
    errMsg = errJson.message || errJson.error || errMsg;
  } catch { /* */ }

  return { success: false, message: errMsg };
}
