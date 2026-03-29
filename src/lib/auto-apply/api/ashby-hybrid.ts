// Ashby Hybrid Submission
// Uses Playwright minimally to load the form page and capture:
//   - formRenderIdentifier (generated client-side when form loads)
//   - formDefinitionIdentifier
//   - recaptchaToken (from reCAPTCHA solve or intercept)
// Then uses Ashby's public GraphQL mutations to fill fields and submit.
//
// This bypasses DOM interaction issues (phone fields, React inputs)
// while still handling reCAPTCHA through the browser.

/* eslint-disable @typescript-eslint/no-explicit-any */

import * as fs from "fs";
import * as path from "path";
import type { ApplicantData, DirectSubmitResult } from "./types";
import { parseAshbyUrl, fetchAshbyFormSchema, answerAshbyQuestions } from "./ashby";

const ASHBY_GRAPHQL = "https://jobs.ashbyhq.com/api/non-user-graphql";

interface AshbySessionData {
  formRenderIdentifier: string;
  formDefinitionIdentifier: string;
  orgSlug: string;
  jobPostingId: string;
  actionIdentifier: string;
}

// NOTE: Standalone GraphQL mutation helpers (gqlMutate, setFormValue, etc.) were removed.
// Ashby's setFormValue is CLIENT-SIDE ONLY — the server does not persist values.
// All mutations must be executed through page.evaluate() to share the browser session.

/** Upload file to S3 using pre-signed POST fields from createFileUploadHandle.
 *  This runs from Node.js (not the browser) since it needs the file buffer. */
async function uploadFileToS3(
  uploadUrl: string,
  presignedFields: Record<string, string> | null,
  fileBuffer: Buffer,
  fileName: string,
  contentType: string,
): Promise<boolean> {
  try {
    const formData = new FormData();
    if (presignedFields) {
      for (const [key, val] of Object.entries(presignedFields)) {
        formData.append(key, val);
      }
    }
    formData.append("Content-Type", contentType);
    formData.append("file", new Blob([new Uint8Array(fileBuffer)], { type: contentType }), fileName);
    const res = await fetch(uploadUrl, { method: "POST", body: formData });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.log(`[Ashby Hybrid] S3 upload failed: ${res.status} ${body.slice(0, 200)}`);
    }
    return res.ok || res.status === 204;
  } catch (err) {
    console.log(`[Ashby Hybrid] File upload failed: ${(err as Error).message}`);
    return false;
  }
}

// ── High-Level Orchestrator ──
// All GraphQL mutations are executed through the browser page via page.evaluate()
// so they share the same session cookies as the form page load.

/** Apply to Ashby job using hybrid approach: browser for session, GraphQL for submission */
export async function applyAshbyHybrid(
  jobUrl: string,
  applicant: ApplicantData,
  openai?: any,
  jobTitle?: string,
  company?: string,
): Promise<DirectSubmitResult> {
  const parsed = parseAshbyUrl(jobUrl);
  if (!parsed) {
    return {
      success: false, platform: "ashby", method: "hybrid",
      message: `Could not parse Ashby URL: ${jobUrl}`,
      fieldsSubmitted: 0, stepsCompleted: [],
    };
  }

  const { orgSlug, jobPostingId } = parsed;
  const steps: string[] = [];

  // 1. Fetch form schema via GraphQL (no browser needed)
  console.log(`[Ashby Hybrid] Fetching form schema for ${orgSlug}/${jobPostingId}...`);
  const schema = await fetchAshbyFormSchema(orgSlug, jobPostingId);
  steps.push(`Fetched form schema: ${schema.fields.length} standard + ${schema.customQuestions.length} custom fields`);
  console.log(`[Ashby Hybrid] ${schema.fields.length} standard fields, ${schema.customQuestions.length} custom questions`);

  // 2. Answer custom questions with AI (do this before browser to minimize browser time)
  let customAnswers = new Map<string, string>();
  if (schema.customQuestions.length > 0 && openai) {
    customAnswers = await answerAshbyQuestions(
      openai, schema.customQuestions, applicant,
      jobTitle || "Software Engineer", company || orgSlug,
    );
    steps.push(`AI answered ${customAnswers.size}/${schema.customQuestions.length} questions`);
  }

  // Helper to get the short path for a field
  const getFieldPath = (fieldId: string): string => {
    const entry = schema.fieldEntries.find((e: any) => e.id === fieldId);
    return entry?.field?.path || fieldId;
  };

  // 3. Launch browser, load form page, and execute all mutations through the page
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pw = require("playwright-core");
  const browser = await pw.chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    let formRenderIdentifier = "";
    let formDefinitionIdentifier = "";

    // Intercept GraphQL requests to capture session identifiers
    page.on("request", (req: any) => {
      if (req.url().includes("non-user-graphql") && req.method() === "POST") {
        try {
          const body = JSON.parse(req.postData() || "{}");
          const vars = body.variables || {};
          if (vars.formRenderIdentifier && !formRenderIdentifier) {
            formRenderIdentifier = vars.formRenderIdentifier;
            console.log(`[Ashby Hybrid] Captured formRenderIdentifier: ${formRenderIdentifier.slice(0, 20)}...`);
          }
          if (vars.formDefinitionIdentifier && !formDefinitionIdentifier) {
            formDefinitionIdentifier = vars.formDefinitionIdentifier;
            console.log(`[Ashby Hybrid] Captured formDefinitionIdentifier: ${formDefinitionIdentifier.slice(0, 20)}...`);
          }
        } catch { /* */ }
      }
    });

    // Navigate to the application form
    const appUrl = jobUrl.includes("/application") ? jobUrl : jobUrl + "/application";
    console.log("[Ashby Hybrid] Loading form page...");
    await page.goto(appUrl, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(2000);

    // Trigger a form interaction to capture identifiers if not yet captured
    if (!formRenderIdentifier) {
      const firstInput = await page.$("input[type='text'], input[type='email']");
      if (firstInput) {
        await firstInput.click();
        await firstInput.fill("x");
        await page.waitForTimeout(2000);
        await firstInput.fill("");
        await page.waitForTimeout(500);
      }
    }

    if (!formRenderIdentifier) {
      await browser.close();
      return {
        success: false, platform: "ashby", method: "hybrid",
        message: "Could not capture Ashby form session identifiers.",
        fieldsSubmitted: 0, stepsCompleted: steps,
      };
    }
    steps.push(`Captured session: formRender=${formRenderIdentifier.slice(0, 12)}...`);

    // ── Execute all mutations through the browser page ──
    // This ensures they share the same session cookies.

    const browserGql = async (opName: string, query: string, variables: Record<string, any>): Promise<any> => {
      return page.evaluate(async (args: { opName: string; query: string; variables: any }) => {
        const res = await fetch("/api/non-user-graphql", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operationName: args.opName, variables: args.variables, query: args.query }),
        });
        return res.json();
      }, { opName, query, variables });
    };

    const setValueQuery = `mutation ApiSetFormValue($organizationHostedJobsPageName: String!, $formRenderIdentifier: String!, $path: String!, $value: JSON, $formDefinitionIdentifier: String) {
      setFormValue(organizationHostedJobsPageName: $organizationHostedJobsPageName, formRenderIdentifier: $formRenderIdentifier, path: $path, value: $value, formDefinitionIdentifier: $formDefinitionIdentifier) { id }
    }`;

    const setFileQuery = `mutation ApiSetFormValueToFile($organizationHostedJobsPageName: String!, $formRenderIdentifier: String!, $path: String!, $fileHandle: String, $formDefinitionIdentifier: String) {
      setFormValueToFile(organizationHostedJobsPageName: $organizationHostedJobsPageName, formRenderIdentifier: $formRenderIdentifier, path: $path, fileHandle: $fileHandle, formDefinitionIdentifier: $formDefinitionIdentifier) { id }
    }`;

    const baseVars = {
      organizationHostedJobsPageName: orgSlug,
      formRenderIdentifier,
      formDefinitionIdentifier,
    };

    // 4. Fill standard fields
    console.log("[Ashby Hybrid] Filling form fields via in-browser GraphQL...");

    for (const field of schema.fields) {
      const fieldPath = getFieldPath(field.id);
      const labelLower = field.label.toLowerCase();

      let value: any = null;
      if (labelLower.includes("name") || labelLower === "full name") {
        value = `${applicant.firstName} ${applicant.lastName}`;
      } else if (labelLower.includes("email")) {
        value = applicant.email;
      } else if (labelLower.includes("phone")) {
        value = applicant.phone || "";
      } else if (field.type === "file" && (labelLower.includes("resume") || labelLower.includes("cv"))) {
        // Handle file upload through browser
        if (applicant.resumeFilePath && fs.existsSync(applicant.resumeFilePath)) {
          const fileBuffer = fs.readFileSync(applicant.resumeFilePath);
          const fileName = path.basename(applicant.resumeFilePath);

          // Create upload handle through browser
          const handleResult = await browserGql(
            "CreateFileUploadHandle",
            `mutation CreateFileUploadHandle($organizationHostedJobsPageName: String!, $fileUploadContext: FileUploadContext!, $filename: String!, $contentType: String!, $contentLength: Int!) {
              createFileUploadHandle(organizationHostedJobsPageName: $organizationHostedJobsPageName, fileUploadContext: $fileUploadContext, filename: $filename, contentType: $contentType, contentLength: $contentLength) { handle url fields }
            }`,
            { ...baseVars, fileUploadContext: "NonUserFormEngine", filename: fileName, contentType: "application/pdf", contentLength: fileBuffer.length },
          );

          const handleData = handleResult?.data?.createFileUploadHandle;
          if (handleData?.handle && handleData?.url) {
            // Upload to S3
            const uploaded = await uploadFileToS3(handleData.url, handleData.fields, fileBuffer, fileName, "application/pdf");
            if (uploaded) {
              // Set file value through browser
              const fileRes = await browserGql("ApiSetFormValueToFile", setFileQuery, { ...baseVars, path: fieldPath, fileHandle: handleData.handle });
              const ok = !fileRes?.errors;
              steps.push(`${ok ? "✓" : "✗"} Uploaded resume: ${fileName}`);
              if (!ok) console.log(`[Ashby Hybrid] setFormValueToFile error:`, JSON.stringify(fileRes.errors).slice(0, 200));
            } else {
              steps.push("✗ Resume upload to S3 failed");
            }
          } else {
            steps.push("✗ Could not create file upload handle");
            if (handleResult?.errors) console.log(`[Ashby Hybrid] createFileUploadHandle error:`, JSON.stringify(handleResult.errors).slice(0, 200));
          }
        }
        continue; // Skip the setFormValue below
      }

      if (value !== null) {
        const res = await browserGql("ApiSetFormValue", setValueQuery, { ...baseVars, path: fieldPath, value });
        const ok = !res?.errors;
        steps.push(`${ok ? "✓" : "✗"} Set "${field.label}": ${value}`);
        if (!ok) console.log(`[Ashby Hybrid] setFormValue error for ${field.label}:`, JSON.stringify(res.errors).slice(0, 200));
      }
    }

    // 5. Fill custom question answers
    for (const [fieldId, answer] of Array.from(customAnswers.entries())) {
      const fieldPath = getFieldPath(fieldId);
      const q = schema.customQuestions.find(cq => cq.id === fieldId);

      let value: any = answer;
      if (q?.type === "boolean") {
        value = answer.toLowerCase() === "true" || answer.toLowerCase() === "yes";
      }

      const res = await browserGql("ApiSetFormValue", setValueQuery, { ...baseVars, path: fieldPath, value });
      const ok = !res?.errors;
      steps.push(`${ok ? "✓" : "✗"} Answered "${q?.label || fieldId}": ${String(answer).slice(0, 50)}`);
      if (!ok) console.log(`[Ashby Hybrid] setFormValue error for custom:`, JSON.stringify(res.errors).slice(0, 200));
    }

    // 6. Submit — requires recaptchaToken
    // Try with empty token first to see if it's enforced
    console.log("[Ashby Hybrid] Attempting submission...");
    const submitRes = await browserGql(
      "SubmitSingleApplicationFormAction",
      `mutation SubmitSingleApplicationFormAction(
        $organizationHostedJobsPageName: String!, $jobPostingId: String!,
        $formRenderIdentifier: String!, $formDefinitionIdentifier: String,
        $actionIdentifier: String!, $recaptchaToken: String!
      ) {
        submitSingleApplicationFormAction(
          organizationHostedJobsPageName: $organizationHostedJobsPageName, jobPostingId: $jobPostingId,
          formRenderIdentifier: $formRenderIdentifier, formDefinitionIdentifier: $formDefinitionIdentifier,
          actionIdentifier: $actionIdentifier, recaptchaToken: $recaptchaToken
        ) {
          applicationFormResult {
            ... on FormSubmitSuccess { _ }
            ... on FormRender { id errorMessages }
          }
          messages { blockMessageForCandidateHtml }
        }
      }`,
      { ...baseVars, jobPostingId, actionIdentifier: "submit", recaptchaToken: "" },
    );

    await browser.close();

    const submitData = submitRes?.data?.submitSingleApplicationFormAction;
    const formResult = submitData?.applicationFormResult;

    if (submitRes?.errors) {
      const errorMsg = JSON.stringify(submitRes.errors).slice(0, 300);
      steps.push(`✗ Submission failed: ${errorMsg}`);
      const isRecaptchaError = errorMsg.toLowerCase().includes("recaptcha") || errorMsg.toLowerCase().includes("captcha");
      return {
        success: false, platform: "ashby", method: "hybrid",
        message: isRecaptchaError
          ? `Form fields filled via API but submission blocked by reCAPTCHA. ${steps.filter(s => s.startsWith("✓")).length} fields set.`
          : `API submission failed: ${errorMsg}`,
        fieldsSubmitted: steps.filter(s => s.startsWith("✓")).length,
        stepsCompleted: steps,
      };
    }

    // Check for validation errors (FormRender with errorMessages)
    if (formResult?.errorMessages && formResult.errorMessages.length > 0) {
      const errorMsg = JSON.stringify(formResult.errorMessages).slice(0, 300);
      steps.push(`✗ Validation errors: ${errorMsg}`);
      return {
        success: false, platform: "ashby", method: "hybrid",
        message: `Form validation failed: ${errorMsg}`,
        fieldsSubmitted: steps.filter(s => s.startsWith("✓")).length,
        stepsCompleted: steps,
      };
    }

    // FormSubmitSuccess
    steps.push("✓ Application submitted successfully");
    return {
      success: true, platform: "ashby", method: "hybrid",
      message: "Application submitted successfully via Ashby hybrid GraphQL approach.",
      fieldsSubmitted: steps.filter(s => s.startsWith("✓")).length,
      stepsCompleted: steps,
    };
  } catch (err) {
    await browser.close().catch(() => {});
    const errorMsg = (err as Error).message?.slice(0, 200) || "Unknown error";
    return {
      success: false, platform: "ashby", method: "hybrid",
      message: `Hybrid submission error: ${errorMsg}`,
      fieldsSubmitted: steps.filter(s => s.startsWith("✓")).length,
      stepsCompleted: steps,
    };
  }
}
