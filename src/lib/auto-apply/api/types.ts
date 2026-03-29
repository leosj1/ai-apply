// Direct API Submission Types
// Shared types for the hybrid browser+API auto-apply approach.

export interface ApplicantData {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  linkedIn?: string;
  location?: string;
  currentTitle?: string;
  yearsExp?: string;
  needsSponsorship?: boolean;
  resumeFilePath?: string;
  resumeText?: string;
  coverLetterText?: string;
}

export interface FormField {
  id: string;           // field identifier (e.g., "question_12345" for Greenhouse)
  label: string;        // human-readable label
  type: "text" | "textarea" | "select" | "multi_select" | "file" | "boolean" | "date" | "number" | "phone" | "email" | "location" | "url";
  required: boolean;
  options?: string[];   // for select/multi_select
  value?: string;       // pre-filled or AI-generated value
}

export interface FormSchema {
  platform: string;
  jobId: string;
  boardToken?: string;  // Greenhouse board token
  apiKey?: string;      // extracted from page source
  fields: FormField[];
  customQuestions: FormField[];
}

export interface DirectSubmitResult {
  success: boolean;
  platform: string;
  method: "api" | "browser" | "hybrid";
  message: string;
  httpStatus?: number;
  responseBody?: string;
  fieldsSubmitted: number;
  stepsCompleted: string[];
  screenshotBeforeSubmit?: string; // base64 PNG screenshot taken just before clicking submit
}

// Token/credential harvested from page source or network intercept
export interface HarvestedCredentials {
  platform: string;
  apiKey?: string;        // Greenhouse Basic Auth key
  boardToken?: string;    // Greenhouse board token
  csrfToken?: string;     // CSRF token from cookies/meta tags
  cookies?: Record<string, string>;
  cfClearance?: string;   // Cloudflare clearance cookie
  customHeaders?: Record<string, string>;
}
