// AI Agent Tool Definitions
// Supports both Claude tool_use and OpenAI function calling formats.
// The canonical definition is provider-agnostic; format conversion happens at export.

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Canonical Tool Definitions ──

interface ToolParam {
  type: string;
  description: string;
  enum?: string[];
}

interface ToolDef {
  name: string;
  description: string;
  properties: Record<string, ToolParam>;
  required: string[];
}

const TOOL_DEFS: ToolDef[] = [
  {
    name: "fill_field",
    description: "Fill a form field (input, textarea) with a value. Use CSS selector to target the field.",
    properties: {
      selector: { type: "string", description: "CSS selector for the input/textarea field" },
      value: { type: "string", description: "Value to fill in the field" },
    },
    required: ["selector", "value"],
  },
  {
    name: "click_element",
    description: "Click a button, link, or other clickable element on the page.",
    properties: {
      selector: { type: "string", description: "CSS selector for the element to click" },
      description: { type: "string", description: "Brief description of what you're clicking" },
    },
    required: ["selector"],
  },
  {
    name: "select_option",
    description: "Select an option from a dropdown. Works with standard <select>, custom ARIA dropdowns, React Select, and listboxes. Handles click-to-open, type-to-filter, click-option patterns automatically.",
    properties: {
      selector: { type: "string", description: "CSS selector for the select/dropdown element" },
      value: { type: "string", description: "Option value or label to select" },
      byLabel: { type: "boolean", description: "If true, match by visible label text instead of value attribute" },
    },
    required: ["selector", "value"],
  },
  {
    name: "upload_file",
    description: "Upload a file (resume/CV) to a file input element.",
    properties: {
      selector: { type: "string", description: "CSS selector for the file input" },
    },
    required: ["selector"],
  },
  {
    name: "get_verification_code",
    description: "Retrieve a verification/confirmation code from the user's email inbox. Use when the page asks for a code sent to the user's email.",
    properties: {
      senderHint: { type: "string", description: "Expected sender domain or name (e.g. 'greenhouse-mail.io')" },
      waitSeconds: { type: "number", description: "How many seconds to wait for the email to arrive (default 30)" },
    },
    required: [],
  },
  {
    name: "scroll_page",
    description: "Scroll the page up or down to reveal more content.",
    properties: {
      direction: { type: "string", description: "Direction to scroll", enum: ["up", "down"] },
      amount: { type: "number", description: "Pixels to scroll (default 500)" },
    },
    required: ["direction"],
  },
  {
    name: "wait_and_screenshot",
    description: "Wait for a specified duration then take a new screenshot. Use after clicking submit or when waiting for page to load.",
    properties: {
      waitMs: { type: "number", description: "Milliseconds to wait (default 3000)" },
      reason: { type: "string", description: "Why we're waiting" },
    },
    required: [],
  },
  {
    name: "check_checkbox",
    description: "Check or uncheck a checkbox element.",
    properties: {
      selector: { type: "string", description: "CSS selector for the checkbox" },
      checked: { type: "boolean", description: "Whether to check (true) or uncheck (false)" },
    },
    required: ["selector"],
  },
  {
    name: "solve_captcha",
    description: "Detect and attempt to solve a CAPTCHA on the page (reCAPTCHA, hCaptcha, Turnstile).",
    properties: {
      captchaType: { type: "string", description: "Type of CAPTCHA detected", enum: ["recaptcha", "hcaptcha", "turnstile", "unknown"] },
    },
    required: [],
  },
  {
    name: "switch_to_iframe",
    description: "Switch into an iframe containing an application form. After switching, all tools operate inside the iframe.",
    properties: {
      iframeSrc: { type: "string", description: "Part of the iframe src URL to match (e.g., 'greenhouse', 'lever')" },
    },
    required: [],
  },
  {
    name: "navigate_to",
    description: "Navigate the browser to a specific URL.",
    properties: {
      url: { type: "string", description: "The URL to navigate to" },
      reason: { type: "string", description: "Why we're navigating to this URL" },
    },
    required: ["url"],
  },
  {
    name: "report_status",
    description: "Report the current status of the application process. Call when application is submitted or cannot be completed.",
    properties: {
      status: { type: "string", description: "Application status", enum: ["success", "failed", "needs_manual"] },
      message: { type: "string", description: "Detailed message about what happened" },
      confirmationText: { type: "string", description: "Any confirmation text visible on the page" },
    },
    required: ["status", "message"],
  },
];

// ── Claude Format ──

export function getClaudeTools(): any[] {
  return TOOL_DEFS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: {
      type: "object",
      properties: Object.fromEntries(
        Object.entries(t.properties).map(([k, v]) => {
          const prop: any = { type: v.type, description: v.description };
          if (v.enum) prop.enum = v.enum;
          return [k, prop];
        })
      ),
      required: t.required.length > 0 ? t.required : undefined,
    },
  }));
}

// ── OpenAI Format ──

export function getOpenAITools(): any[] {
  return TOOL_DEFS.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: "object",
        properties: Object.fromEntries(
          Object.entries(t.properties).map(([k, v]) => {
            const prop: any = { type: v.type, description: v.description };
            if (v.enum) prop.enum = v.enum;
            return [k, prop];
          })
        ),
        required: t.required.length > 0 ? t.required : undefined,
      },
    },
  }));
}

// Legacy export for backward compatibility
export const AGENT_TOOLS = getOpenAITools();
