// Workable Form Schema Fetching
// Uses Workable's public API to fetch form fields and custom questions.
// Submission must happen via browser (Cloudflare Turnstile blocks direct API).
//
// Public endpoints:
//   GET /api/v1/jobs/{shortcode}/form — returns form sections with fields
//   GET /api/v2/accounts/{company}/jobs/{shortcode} — job details

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { ApplicantData, FormField, FormSchema } from "./types";
import { answerQuestions } from "./ai-client";

const WORKABLE_BASE = "https://apply.workable.com";

// ── URL Parsing ──

/** Extract company slug and shortcode from a Workable URL */
export function parseWorkableUrl(url: string): { company: string; shortcode: string } | null {
  // Format: https://apply.workable.com/{company}/j/{shortcode}/apply
  // Or: https://apply.workable.com/{company}/j/{shortcode}
  const match = url.match(/apply\.workable\.com\/([^/]+)\/j\/([A-Z0-9]+)/);
  if (match) return { company: match[1], shortcode: match[2] };
  return null;
}

// ── Form Schema Fetching ──

/** Fetch application form fields from Workable's public API */
export async function fetchWorkableFormSchema(
  company: string,
  shortcode: string,
): Promise<FormSchema & { sections: any[] }> {
  const res = await fetch(`${WORKABLE_BASE}/api/v1/jobs/${shortcode}/form`);
  if (!res.ok) {
    throw new Error(`Workable form API error: ${res.status} ${res.statusText}`);
  }

  const sections = await res.json();

  const fields: FormField[] = [];
  const customQuestions: FormField[] = [];

  // Standard field IDs that Workable always includes
  const standardIds = new Set([
    "firstname", "lastname", "email", "phone", "headline",
    "address", "avatar", "resume", "cover_letter",
    "education", "experience", "summary",
  ]);

  for (const section of sections) {
    for (const f of section.fields || []) {
      // Skip group fields (education, experience) — too complex for auto-fill
      if (f.type === "group") continue;

      const formField: FormField = {
        id: f.id,
        label: f.label || f.id,
        type: mapWorkableFieldType(f.type),
        required: f.required || false,
        options: f.choices?.map((c: any) => c.label || c.name || c) || undefined,
      };

      if (standardIds.has(f.id)) {
        fields.push(formField);
      } else {
        customQuestions.push(formField);
      }
    }
  }

  return {
    platform: "workable",
    jobId: shortcode,
    fields,
    customQuestions,
    sections,
  };
}

function mapWorkableFieldType(wType: string): FormField["type"] {
  switch (wType) {
    case "text": return "text";
    case "email": return "email";
    case "phone": return "phone";
    case "paragraph": return "textarea";
    case "boolean": return "boolean";
    case "date": return "date";
    case "number": return "number";
    case "file": return "file";
    case "multiple": return "select";
    case "dropdown": return "select";
    default: return "text";
  }
}

// ── AI Question Answering ──

/** Answer custom questions — delegates to unified AI client (Claude preferred, OpenAI fallback) */
export async function answerWorkableQuestions(
  aiClient: any,
  questions: FormField[],
  applicant: ApplicantData,
  jobTitle: string,
  company: string,
): Promise<Map<string, string>> {
  return answerQuestions(aiClient, questions, applicant, jobTitle, company);
}
