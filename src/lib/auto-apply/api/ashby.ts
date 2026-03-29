// Ashby Direct API Submission
// Uses Ashby's public GraphQL API + REST applicationForm.submit endpoint.
// Docs: https://developers.ashbyhq.com/reference/applicationformsubmit
//
// Flow:
// 1. Fetch job posting + application form fields via GraphQL
// 2. Use AI to answer custom questions
// 3. POST multipart/form-data to api.ashbyhq.com/applicationForm.submit

/* eslint-disable @typescript-eslint/no-explicit-any */

import * as fs from "fs";
import * as path from "path";
import type { ApplicantData, FormField, FormSchema, DirectSubmitResult } from "./types";
import { answerQuestions } from "./ai-client";

const ASHBY_GRAPHQL = "https://jobs.ashbyhq.com/api/non-user-graphql";
const ASHBY_API = "https://api.ashbyhq.com";

// ── URL Parsing ──

/** Extract org slug and job posting ID from an Ashby URL */
export function parseAshbyUrl(url: string): { orgSlug: string; jobPostingId: string } | null {
  // Format: https://jobs.ashbyhq.com/{org_slug}/{job_posting_id}
  const match = url.match(/jobs\.ashbyhq\.com\/([^/]+)\/([a-f0-9-]+)/);
  if (match) return { orgSlug: match[1], jobPostingId: match[2] };
  return null;
}

// ── Form Schema Fetching via GraphQL ──

/** Fetch job posting details and application form fields */
export async function fetchAshbyFormSchema(
  orgSlug: string,
  jobPostingId: string,
): Promise<FormSchema & { ashbyJobPostingId: string; fieldEntries: any[] }> {
  const jobQuery = {
    operationName: "ApiJobPosting",
    variables: { organizationHostedJobsPageName: orgSlug, jobPostingId },
    query: `query ApiJobPosting($organizationHostedJobsPageName: String!, $jobPostingId: String!) {
      jobPosting(
        organizationHostedJobsPageName: $organizationHostedJobsPageName
        jobPostingId: $jobPostingId
      ) {
        id
        title
        departmentName
        locationName
        applicationForm {
          sections {
            title
            fieldEntries {
              id
              field
            }
          }
        }
      }
    }`,
  };

  const res = await fetch(ASHBY_GRAPHQL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(jobQuery),
  });

  if (!res.ok) {
    throw new Error(`Ashby GraphQL error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const posting = data?.data?.jobPosting;
  if (!posting) {
    throw new Error("Job posting not found on Ashby");
  }

  const fields: FormField[] = [];
  const customQuestions: FormField[] = [];
  const allFieldEntries: any[] = [];
  const sections = posting.applicationForm?.sections || [];

  for (const section of sections) {
    for (const entry of section.fieldEntries || []) {
      // entry.field is a JSON scalar with: id, path, title, type, isNullable, selectableValues, etc.
      const fieldData = entry.field;
      if (!fieldData) continue;

      allFieldEntries.push(entry);

      const formField: FormField = {
        id: entry.id, // the fieldEntry ID used for submission
        label: fieldData.title || fieldData.humanReadablePath || "",
        type: mapAshbyFieldType(fieldData.type || "String"),
        required: !fieldData.isNullable,
        options: fieldData.selectableValues?.map((v: any) => v.label || v.value) || undefined,
      };

      // Identify standard vs custom fields by path or label
      const path = (fieldData.path || "").toLowerCase();
      const labelLower = (fieldData.title || "").toLowerCase();
      if (path.includes("_systemfield_name") || path.includes("_systemfield_email") ||
          path.includes("_systemfield_resume") ||
          labelLower.includes("email") || labelLower.includes("phone") ||
          labelLower.includes("resume") || labelLower.includes("cv") ||
          labelLower === "full name" || labelLower === "name") {
        fields.push(formField);
      } else {
        customQuestions.push(formField);
      }
    }
  }

  return {
    platform: "ashby",
    jobId: jobPostingId,
    fields,
    customQuestions,
    ashbyJobPostingId: posting.id,
    fieldEntries: allFieldEntries,
  };
}

function mapAshbyFieldType(ashbyType: string): FormField["type"] {
  switch (ashbyType) {
    case "String": return "text";
    case "Email": return "email";
    case "Phone": return "phone";
    case "LongText":
    case "RichText": return "textarea";
    case "Boolean": return "boolean";
    case "Date": return "date";
    case "Number": return "number";
    case "ValueSelect": return "select";
    case "MultiValueSelect": return "multi_select";
    case "File": return "file";
    default: return "text";
  }
}

// ── AI Question Answering ──

/** Answer custom questions — delegates to unified AI client (Claude preferred, OpenAI fallback) */
export async function answerAshbyQuestions(
  aiClient: any,
  questions: FormField[],
  applicant: ApplicantData,
  jobTitle: string,
  company: string,
): Promise<Map<string, string>> {
  return answerQuestions(aiClient, questions, applicant, jobTitle, company);
}

// ── Direct Submission ──

/** Submit application via Ashby's applicationForm.submit API */
export async function submitAshbyApplication(
  orgSlug: string,
  jobPostingId: string,
  applicant: ApplicantData,
  customAnswers: Map<string, string>,
  schema: FormSchema & { ashbyJobPostingId: string; fieldEntries: any[] },
): Promise<DirectSubmitResult> {
  const steps: string[] = [];

  // Build the field submissions as a JSON object
  // Ashby expects: fieldSubmissions: { fieldId: value, ... }
  const fieldSubmissions: Record<string, any> = {};

  // Map standard fields by label
  for (const field of schema.fields) {
    const labelLower = field.label.toLowerCase();
    if (labelLower.includes("first name")) {
      fieldSubmissions[field.id] = applicant.firstName;
      steps.push(`Set "${field.label}": ${applicant.firstName}`);
    } else if (labelLower.includes("last name")) {
      fieldSubmissions[field.id] = applicant.lastName;
      steps.push(`Set "${field.label}": ${applicant.lastName}`);
    } else if (labelLower.includes("email")) {
      fieldSubmissions[field.id] = applicant.email;
      steps.push(`Set "${field.label}": ${applicant.email}`);
    } else if (labelLower.includes("phone")) {
      fieldSubmissions[field.id] = applicant.phone || "";
      steps.push(`Set "${field.label}": ${applicant.phone || "N/A"}`);
    }
  }

  // Custom question answers
  Array.from(customAnswers.entries()).forEach(([fieldId, answer]) => {
    fieldSubmissions[fieldId] = answer;
    const q = schema.customQuestions.find(q => q.id === fieldId);
    steps.push(`Answered "${q?.label || fieldId}": ${answer.slice(0, 50)}`);
  });

  // Build multipart form data
  const formData = new FormData();
  formData.append("jobPostingId", schema.ashbyJobPostingId);
  formData.append("applicationForm", JSON.stringify({
    fieldSubmissions,
  }));

  // Resume file upload
  if (applicant.resumeFilePath && fs.existsSync(applicant.resumeFilePath)) {
    const resumeBuffer = fs.readFileSync(applicant.resumeFilePath);
    const fileName = path.basename(applicant.resumeFilePath);
    const blob = new Blob([resumeBuffer], { type: "application/pdf" });
    formData.append("resume", blob, fileName);
    steps.push(`Attached resume: ${fileName}`);
  }

  const submitUrl = `${ASHBY_API}/applicationForm.submit`;
  console.log(`[Ashby API] Submitting to ${submitUrl} with ${steps.length} fields...`);

  try {
    const res = await fetch(submitUrl, {
      method: "POST",
      body: formData,
    });

    const responseText = await res.text();
    let responseBody: any;
    try { responseBody = JSON.parse(responseText); } catch { responseBody = responseText; }

    if (res.ok && responseBody?.success !== false) {
      console.log(`[Ashby API] ✅ Success: ${res.status}`);
      return {
        success: true,
        platform: "ashby",
        method: "api",
        message: `Application submitted successfully via Ashby API.`,
        httpStatus: res.status,
        responseBody: responseText.slice(0, 500),
        fieldsSubmitted: steps.length,
        stepsCompleted: steps,
      };
    } else {
      const errorMsg = responseBody?.errors
        ? JSON.stringify(responseBody.errors)
        : (typeof responseBody === "object" ? JSON.stringify(responseBody) : responseText.slice(0, 200));
      console.log(`[Ashby API] ❌ Failed: ${res.status} — ${errorMsg}`);
      return {
        success: false,
        platform: "ashby",
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
      platform: "ashby",
      method: "api",
      message: `API request error: ${(err as Error).message}`,
      fieldsSubmitted: steps.length,
      stepsCompleted: steps,
    };
  }
}

// ── High-Level Orchestrator ──

/** Complete Ashby application via direct API */
export async function applyAshbyViaAPI(
  jobUrl: string,
  applicant: ApplicantData,
  openai?: any,
  jobTitle?: string,
  company?: string,
): Promise<DirectSubmitResult> {
  const parsed = parseAshbyUrl(jobUrl);
  if (!parsed) {
    return {
      success: false,
      platform: "ashby",
      method: "api",
      message: `Could not parse Ashby URL: ${jobUrl}`,
      fieldsSubmitted: 0,
      stepsCompleted: [],
    };
  }

  const { orgSlug, jobPostingId } = parsed;
  console.log(`[Ashby API] Org: ${orgSlug}, Job: ${jobPostingId}`);

  // 1. Fetch form schema via GraphQL
  const schema = await fetchAshbyFormSchema(orgSlug, jobPostingId);
  console.log(`[Ashby API] Form has ${schema.fields.length} standard fields, ${schema.customQuestions.length} custom questions`);

  // 2. Answer custom questions with AI
  let customAnswers = new Map<string, string>();
  if (schema.customQuestions.length > 0 && openai) {
    customAnswers = await answerAshbyQuestions(
      openai,
      schema.customQuestions,
      applicant,
      jobTitle || "Software Engineer",
      company || orgSlug,
    );
    console.log(`[Ashby API] AI answered ${customAnswers.size}/${schema.customQuestions.length} questions`);
  }

  // 3. Submit
  return await submitAshbyApplication(orgSlug, jobPostingId, applicant, customAnswers, schema);
}
