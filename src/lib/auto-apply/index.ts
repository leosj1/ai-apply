// Auto-apply module — uses Playwright to fill and SUBMIT job application forms
// Supports: Greenhouse, Lever, LinkedIn, Workable, Ashby, SmartRecruiters, iCIMS, Taleo
// Features: actual submission, confirmation detection, rate limiting, proxy emails

/* eslint-disable @typescript-eslint/no-explicit-any */

interface ApplyContext {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  linkedIn?: string;
  resumeText: string;
  coverLetterText: string;
  // Optional fields
  currentCompany?: string;
  currentTitle?: string;
  yearsExp?: string;
  location?: string;
  website?: string;
  // Sponsorship
  needsSponsorship?: boolean;
  // File paths for uploads
  resumeFilePath?: string;
  // LinkedIn auth — path to cookies JSON file exported from browser
  linkedInCookiesPath?: string;
  // Clerk user ID — used to fetch LinkedIn OAuth token for LinkedIn job pages
  clerkId?: string;
  // Job metadata for AI question answering
  jobTitle?: string;
  company?: string;
}

interface ApplyResult {
  success: boolean;
  platform: string;
  message: string;
  screenshotBase64?: string;
  // Proof of application
  stepsCompleted?: string[];
  screenshotSteps?: { step: string; screenshot: string }[];
  // Confirmation detection
  confirmationDetected?: boolean;
  confirmationText?: string;
}

// ── Proxy Email Generation ──
// Generates a plus-addressed email for each application so confirmation
// emails can be filtered and tracked back to the specific job.
// e.g. user@gmail.com → user+greenhouse-acme-swe@gmail.com
function generateProxyEmail(baseEmail: string, company: string, role: string): string {
  const [local, domain] = baseEmail.split("@");
  if (!local || !domain) return baseEmail;
  // Sanitize company+role into a short tag
  const tag = `${company}-${role}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${local}+${tag}@${domain}`;
}

// ── Rate Limiting ──
// Track last apply time per platform to avoid anti-bot detection
const lastApplyTime: Record<string, number> = {};
const RATE_LIMIT_MS: Record<string, number> = {
  greenhouse: 5000,    // API-first, fast
  lever: 5000,         // API-first, fast
  linkedin: 20000,     // Aggressive bot detection
  workable: 15000,     // Cloudflare Turnstile sensitive
  ashby: 8000,         // Browser-based, moderate
  smartrecruiters: 10000,
  icims: 10000,
  taleo: 12000,        // Complex multi-page, needs time
  bamboohr: 8000,
  jazzhr: 8000,
  breezyhr: 8000,
  recruitee: 5000,     // API-first
  jobvite: 10000,
  successfactors: 15000, // SAP enterprise, slow
  pinpoint: 8000,
  rippling: 10000,     // Uses Greenhouse under the hood sometimes
  default: 10000,
};

async function enforceRateLimit(platform: string): Promise<void> {
  const limit = RATE_LIMIT_MS[platform] || RATE_LIMIT_MS.default;
  const last = lastApplyTime[platform] || 0;
  const elapsed = Date.now() - last;
  if (elapsed < limit) {
    const wait = limit - elapsed;
    console.log(`[auto-apply] Rate limit: waiting ${wait}ms before ${platform} apply`);
    await new Promise((r) => setTimeout(r, wait));
  }
  lastApplyTime[platform] = Date.now();
}

// ── Confirmation Detection ──
// After form submission, check for confirmation/thank-you page
async function detectConfirmation(page: any): Promise<{ detected: boolean; text: string }> {
  try {
    await page.waitForTimeout(3000);
    // Common confirmation selectors and text patterns
    const confirmSelectors = [
      "div[class*='confirmation']", "div[class*='thank']", "div[class*='success']",
      "h1:has-text('Thank')", "h2:has-text('Thank')", "h3:has-text('Thank')",
      "h1:has-text('Application')", "h2:has-text('Application submitted')",
      "div:has-text('Your application has been')", "div:has-text('application was sent')",
      "div[class*='post-apply']", ".application-confirmation",
      "div[data-test*='confirm']", "div[class*='submitted']",
    ];
    for (const sel of confirmSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          const text = (await el.textContent() || "").trim().slice(0, 200);
          if (/thank|confirm|submitted|received|success|sent/i.test(text)) {
            return { detected: true, text };
          }
        }
      } catch { /* */ }
    }
    // Fallback: check full page text
    const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 2000) || "");
    if (/thank you for (your )?appl|application (has been |was )?(submitted|received|sent)|we('ve| have) received your/i.test(bodyText)) {
      const match = bodyText.match(/[^.]*(?:thank you|application|submitted|received)[^.]*/i);
      return { detected: true, text: match ? match[0].trim().slice(0, 200) : "Application confirmation detected" };
    }
    return { detected: false, text: "" };
  } catch {
    return { detected: false, text: "" };
  }
}

// Detect which ATS platform a URL belongs to
function detectPlatform(url: string): string {
  if (/boards\.greenhouse\.io|job-boards\.greenhouse\.io|greenhouse\.io\/embed/i.test(url)) return "greenhouse";
  // Company career pages with embedded Greenhouse (e.g. careers.airbnb.com/positions/123?gh_jid=123)
  if (/[?&]gh_jid=/i.test(url)) return "greenhouse";
  if (/jobs\.lever\.co/i.test(url)) return "lever";
  if (/linkedin\.com\/jobs/i.test(url)) return "linkedin";
  if (/apply\.workable\.com|jobs\.workable\.com/i.test(url)) return "workable";
  if (/ashbyhq\.com|jobs\.ashby\.com/i.test(url)) return "ashby";
  if (/jobs\.smartrecruiters\.com|careers\.smartrecruiters\.com/i.test(url)) return "smartrecruiters";
  if (/icims\.com|\.iCIMS\./i.test(url)) return "icims";
  if (/taleo\.net|oracle\.com\/.*taleo/i.test(url)) return "taleo";
  if (/\.bamboohr\.com\/careers|\.bamboohr\.com\/jobs/i.test(url)) return "bamboohr";
  if (/\.applytojob\.com|app\.jazz\.co\/job\/|resumatorapi\.com/i.test(url)) return "jazzhr";
  if (/\.breezy\.hr\/p\/|breezyhr\.com/i.test(url)) return "breezyhr";
  if (/\.recruitee\.com/i.test(url)) return "recruitee";
  if (/jobs\.jobvite\.com|app\.jobvite\.com/i.test(url)) return "jobvite";
  if (/successfactors\.com|sap\.com\/recruiting/i.test(url)) return "successfactors";
  if (/pinpoint\.app\/jobs|join\.pinpoint\.app/i.test(url)) return "pinpoint";
  if (/rippling\.com\/jobs|rippling\.com\/careers/i.test(url)) return "rippling";
  return "unknown";
}

// Get Playwright browser instance
// Uses playwright-extra with stealth plugin for Workday sites to bypass bot detection
async function getPlaywrightBrowser(url?: string): Promise<any> {
  // Platforms that block headless browsers and need stealth mode
  const needsStealth = url ? (
    url.includes("myworkdayjobs.com") || url.includes("workday.com") ||
    url.includes("smartrecruiters.com") ||
    url.includes("workable.com") || url.includes("apply.workable.com") ||
    url.includes("ashbyhq.com") || url.includes("jobs.ashby.com") ||
    url.includes("bamboohr.com") ||
    url.includes("jobvite.com") ||
    url.includes("successfactors.com")
  ) : false;

  if (needsStealth) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { chromium } = require("playwright-extra");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const StealthPlugin = require("puppeteer-extra-plugin-stealth");
      chromium.use(StealthPlugin());
      console.log(`[AutoApply] Launching stealth browser for ${url?.slice(0, 50)}`);
      return await chromium.launch({
        headless: false,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      });
    } catch (stealthErr) {
      console.log(`[AutoApply] Stealth browser failed, falling back to regular: ${(stealthErr as Error).message?.slice(0, 60)}`);
      // Fall through to regular browser
    }
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pw = require("playwright-core");
    if (!pw?.chromium) return null;
    return await pw.chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
  } catch {
    return null;
  }
}

// Helper: take a screenshot and add to steps
async function takeScreenshot(page: any, stepName: string, screenshotSteps: { step: string; screenshot: string }[]): Promise<void> {
  try {
    const ss = await page.screenshot({ type: "png", fullPage: false });
    screenshotSteps.push({ step: stepName, screenshot: ss.toString("base64") });
  } catch { /* */ }
}

// Helper: add random human-like delays to avoid bot detection
async function humanDelay(page: any, min = 500, max = 1500): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min)) + min;
  await page.waitForTimeout(ms);
}

// ── Greenhouse Auto-Fill + Submit ──
async function applyGreenhouse(page: any, ctx: ApplyContext): Promise<ApplyResult> {
  const steps: string[] = [];
  const screenshots: { step: string; screenshot: string }[] = [];

  try {
    await page.waitForSelector("#application_form, form[action*='applications']", { timeout: 10000 });
    steps.push("Application form loaded");
    await takeScreenshot(page, "1. Application form loaded", screenshots);

    // Fill standard fields with human-like delays
    const fieldMap: [string, string][] = [
      ["#first_name, input[name*='first_name']", ctx.firstName],
      ["#last_name, input[name*='last_name']", ctx.lastName],
      ["#email, input[name*='email']", ctx.email],
      ["#phone, input[name*='phone']", ctx.phone || ""],
      ["input[name*='linkedin'], input[placeholder*='LinkedIn']", ctx.linkedIn || ""],
    ];

    for (const [selector, value] of fieldMap) {
      if (!value) continue;
      try {
        const el = await page.$(selector);
        if (el) {
          await el.click();
          await humanDelay(page, 200, 600);
          await el.fill(value);
          await humanDelay(page, 100, 400);
        }
      } catch { /* field not found, skip */ }
    }
    steps.push("Filled personal info");
    await takeScreenshot(page, "2. Personal info filled", screenshots);

    // Handle resume upload if file input present
    if (ctx.resumeFilePath) {
      try {
        const fileInput = await page.$("input[type='file']");
        if (fileInput) {
          await fileInput.setInputFiles(ctx.resumeFilePath);
          steps.push("Uploaded resume PDF");
          await humanDelay(page, 1000, 2000);
        }
      } catch { /* */ }
    }

    // Handle cover letter textarea
    try {
      const coverEl = await page.$("textarea[name*='cover_letter'], #cover_letter");
      if (coverEl && ctx.coverLetterText) {
        await coverEl.fill(ctx.coverLetterText);
        steps.push("Filled cover letter");
        await takeScreenshot(page, "4. Cover letter filled", screenshots);
      }
    } catch { /* */ }

    // Handle "How did you hear about us"
    try {
      const sourceSelect = await page.$("select[name*='source'], select[id*='source']");
      if (sourceSelect) {
        const options = await sourceSelect.$$("option");
        for (const opt of options) {
          const text = await opt.textContent();
          if (/other|job board|online/i.test(text || "")) {
            await sourceSelect.selectOption({ label: text.trim() });
            break;
          }
        }
      }
    } catch { /* */ }

    // Handle sponsorship question
    try {
      const sponsorLabels = await page.$$("label");
      for (const label of sponsorLabels) {
        const text = await label.textContent();
        if (/sponsor|visa|authorization|legally authorized/i.test(text || "")) {
          const forAttr = await label.getAttribute("for");
          if (forAttr) {
            const input = await page.$(`#${forAttr}`);
            if (input) {
              const tagName = await input.evaluate((el: any) => el.tagName.toLowerCase());
              if (tagName === "select") {
                const answer = ctx.needsSponsorship ? "Yes" : "No";
                try { await input.selectOption({ label: answer }); } catch {
                  try { await input.selectOption({ value: answer.toLowerCase() }); } catch { /* */ }
                }
                steps.push("Answered sponsorship question");
              }
            }
          }
        }
      }
    } catch { /* */ }

    await takeScreenshot(page, "Form filled — before submit", screenshots);

    // SUBMIT the form
    const submitBtn = await page.$("#submit_app, button[type='submit'], input[type='submit'], button:has-text('Submit'), button:has-text('Apply')");
    if (submitBtn) {
      await humanDelay(page, 800, 1500);
      await submitBtn.click();
      steps.push("Clicked Submit button");
      await page.waitForTimeout(4000);
      await takeScreenshot(page, "After submit", screenshots);

      // Detect confirmation — only report success if we see ACTUAL confirmation text
      const confirmation = await detectConfirmation(page);
      if (confirmation.detected) {
        steps.push(`Confirmation detected: ${confirmation.text}`);
        return {
          success: true,
          platform: "greenhouse",
          message: `Application submitted! ${confirmation.text}`,
          stepsCompleted: steps,
          screenshotSteps: screenshots,
          confirmationDetected: true,
          confirmationText: confirmation.text,
        };
      }

      // Check if security code prompt appeared (Greenhouse anti-bot)
      const pageText = await page.textContent("body").catch(() => "") || "";
      if (pageText.includes("security code") || pageText.includes("verification code") || pageText.includes("Security code")) {
        steps.push("Security code required — hardcoded handler cannot complete this");
        return {
          success: false,
          platform: "greenhouse",
          message: "Greenhouse requires a security code sent via email. The AI agent is needed to handle this automatically. Please ensure OPENAI_API_KEY is configured.",
          stepsCompleted: steps,
          screenshotSteps: screenshots,
          confirmationDetected: false,
        };
      }

      // No confirmation detected — don't assume success
      return {
        success: false,
        platform: "greenhouse",
        message: "Form submitted but no confirmation detected. The application may not have been completed — check for security code or CAPTCHA requirements.",
        stepsCompleted: steps,
        screenshotSteps: screenshots,
        confirmationDetected: false,
      };
    }

    return {
      success: false,
      platform: "greenhouse",
      message: "Form filled but no submit button found. Manual submission required.",
      stepsCompleted: steps,
      screenshotSteps: screenshots,
      confirmationDetected: false,
    };
  } catch (err) {
    return {
      success: false, platform: "greenhouse",
      message: `Greenhouse apply failed: ${(err as Error).message}`,
      stepsCompleted: steps, screenshotSteps: screenshots,
    };
  }
}

// ── Lever Auto-Fill + Submit ──
async function applyLever(page: any, ctx: ApplyContext): Promise<ApplyResult> {
  const steps: string[] = [];
  const screenshots: { step: string; screenshot: string }[] = [];

  try {
    await page.waitForSelector(".application-form, form.postings-btn, .posting-page", { timeout: 10000 });
    steps.push("Job page loaded");
    await takeScreenshot(page, "1. Job page loaded", screenshots);

    // Click "Apply" button if we're on the job listing page
    try {
      const applyBtn = await page.$("a.postings-btn, a[href*='apply'], button:has-text('Apply')");
      if (applyBtn) {
        await applyBtn.click();
        await page.waitForTimeout(2000);
        steps.push("Clicked Apply button");
        await takeScreenshot(page, "2. Clicked Apply button", screenshots);
      }
    } catch { /* already on apply page */ }

    // Fill standard Lever fields with human delays
    const leverFields: [string, string][] = [
      ["input[name='name']", `${ctx.firstName} ${ctx.lastName}`],
      ["input[name='email']", ctx.email],
      ["input[name='phone']", ctx.phone || ""],
      ["input[name='org'], input[name='company']", ctx.currentCompany || ""],
      ["input[name='urls[LinkedIn]'], input[placeholder*='LinkedIn']", ctx.linkedIn || ""],
    ];

    for (const [selector, value] of leverFields) {
      if (!value) continue;
      try {
        const el = await page.$(selector);
        if (el) {
          await el.click();
          await humanDelay(page, 200, 500);
          await el.fill(value);
          await humanDelay(page, 100, 300);
        }
      } catch { /* */ }
    }
    steps.push("Filled personal info");
    await takeScreenshot(page, "3. Personal info filled", screenshots);

    // Handle resume upload
    if (ctx.resumeFilePath) {
      try {
        const fileInput = await page.$("input[type='file'][name='resume'], input[type='file']");
        if (fileInput) {
          await fileInput.setInputFiles(ctx.resumeFilePath);
          steps.push("Uploaded resume PDF");
          await takeScreenshot(page, "4. Resume uploaded", screenshots);
          await humanDelay(page, 1000, 2000);
        }
      } catch { /* */ }
    }

    // Fill cover letter
    try {
      const coverEl = await page.$("textarea[name='comments'], textarea[placeholder*='cover'], textarea[name*='additional']");
      if (coverEl && ctx.coverLetterText) {
        await coverEl.fill(ctx.coverLetterText);
        steps.push("Filled cover letter");
        await takeScreenshot(page, "5. Cover letter filled", screenshots);
      }
    } catch { /* */ }

    // Handle custom questions (selects)
    try {
      const selects = await page.$$("select");
      for (const sel of selects) {
        const labelEl = await sel.evaluate((el: any) => el.closest(".application-question")?.querySelector("label")?.textContent || "");
        if (/sponsor|visa|authorization|authorized/i.test(labelEl)) {
          const answer = ctx.needsSponsorship ? "Yes" : "No";
          try { await sel.selectOption({ label: answer }); } catch {
            try { await sel.selectOption({ value: answer.toLowerCase() }); } catch { /* */ }
          }
          steps.push("Answered sponsorship question");
        }
      }
    } catch { /* */ }

    await takeScreenshot(page, "Form filled — before submit", screenshots);

    // SUBMIT the form
    const submitBtn = await page.$("button[type='submit'], button.postings-btn, button:has-text('Submit application'), button:has-text('Submit')");
    if (submitBtn) {
      await humanDelay(page, 800, 1500);
      await submitBtn.click();
      steps.push("Clicked Submit button");
      await page.waitForTimeout(4000);
      await takeScreenshot(page, "After submit", screenshots);

      const confirmation = await detectConfirmation(page);
      if (confirmation.detected) {
        steps.push(`Confirmation detected: ${confirmation.text}`);
      }

      if (confirmation.detected) {
        return {
          success: true, platform: "lever",
          message: `Application submitted! ${confirmation.text}`,
          stepsCompleted: steps, screenshotSteps: screenshots,
          confirmationDetected: true, confirmationText: confirmation.text,
        };
      }

      return {
        success: false, platform: "lever",
        message: "Form submitted but no confirmation detected. May need CAPTCHA or manual review.",
        stepsCompleted: steps, screenshotSteps: screenshots, confirmationDetected: false,
      };
    }

    return {
      success: false, platform: "lever",
      message: "Form filled but no submit button found. Manual submission required.",
      stepsCompleted: steps, screenshotSteps: screenshots, confirmationDetected: false,
    };
  } catch (err) {
    return {
      success: false, platform: "lever",
      message: `Lever apply failed: ${(err as Error).message}`,
      stepsCompleted: steps, screenshotSteps: screenshots,
    };
  }
}

// ── LinkedIn Easy Apply ──
async function applyLinkedIn(page: any, ctx: ApplyContext, browserContext: any): Promise<ApplyResult> {
  const steps: string[] = [];
  const screenshotSteps: { step: string; screenshot: string }[] = [];

  const takeStepScreenshot = async (stepName: string) => {
    await takeScreenshot(page, stepName, screenshotSteps);
  };

  try {
    // Load LinkedIn cookies if available
    if (ctx.linkedInCookiesPath) {
      try {
        const fs = require("fs");
        const cookies = JSON.parse(fs.readFileSync(ctx.linkedInCookiesPath, "utf-8"));
        await browserContext.addCookies(cookies);
        steps.push("Loaded LinkedIn session cookies");
      } catch {
        return {
          success: false, platform: "linkedin",
          message: "Failed to load LinkedIn cookies. Please export your LinkedIn cookies first (Settings → LinkedIn Connect).",
        };
      }
    } else {
      return {
        success: false, platform: "linkedin",
        message: "LinkedIn Easy Apply requires authentication. Please connect your LinkedIn account in Settings → LinkedIn Connect to export session cookies.",
      };
    }

    // Navigate to the job page
    await page.goto(page.url(), { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(3000);
    steps.push("Opened LinkedIn job page");

    // Check if we're logged in
    const isLoggedIn = await page.$("nav.global-nav, .global-nav__me");
    if (!isLoggedIn) {
      await takeStepScreenshot("Not logged in");
      return {
        success: false, platform: "linkedin",
        message: "LinkedIn session expired. Please re-export your cookies from Settings.",
        screenshotSteps,
      };
    }
    steps.push("Verified LinkedIn login");

    // Find and click the Easy Apply button
    const easyApplyBtn = await page.$("button.jobs-apply-button, button:has-text('Easy Apply'), button[aria-label*='Easy Apply']");
    if (!easyApplyBtn) {
      await takeStepScreenshot("No Easy Apply button");
      return {
        success: false, platform: "linkedin",
        message: "This job does not support Easy Apply. It may require applying on the company website.",
        stepsCompleted: steps, screenshotSteps,
      };
    }
    await easyApplyBtn.click();
    await page.waitForTimeout(2000);
    steps.push("Clicked Easy Apply button");
    await takeStepScreenshot("Easy Apply modal opened");

    // Handle multi-step modal — loop through steps
    const maxSteps = 8;
    for (let step = 0; step < maxSteps; step++) {
      // Wait for modal content
      await page.waitForTimeout(1500);

      // Check if we're on the review/submit page
      const reviewBtn = await page.$("button[aria-label*='Submit application'], button[aria-label*='Review'], button:has-text('Submit application')");
      if (reviewBtn) {
        const btnText = await reviewBtn.textContent();
        if (/submit/i.test(btnText || "")) {
          // Take final screenshot before submit
          await takeStepScreenshot("Review page — ready to submit");
          steps.push("Reached review/submit page");
          await reviewBtn.click();
          await page.waitForTimeout(3000);
          steps.push("Clicked Submit");
          await takeStepScreenshot("After submit");

          // Check for success confirmation
          const successEl = await page.$("div[class*='post-apply'], h2:has-text('application was sent'), div:has-text('Your application was sent')");
          if (successEl) {
            steps.push("Application confirmed submitted");
          }
          break;
        }
      }

      // Fill contact info fields if present
      const contactFields: [string, string][] = [
        ["input[name*='phoneNumber'], input[id*='phoneNumber']", ctx.phone || ""],
        ["input[name*='email'], input[id*='email']", ctx.email],
        ["input[name*='firstName'], input[id*='firstName']", ctx.firstName],
        ["input[name*='lastName'], input[id*='lastName']", ctx.lastName],
      ];
      for (const [sel, val] of contactFields) {
        if (!val) continue;
        try {
          const el = await page.$(sel);
          if (el) {
            const current = await el.inputValue();
            if (!current) { await el.click(); await el.fill(val); }
          }
        } catch { /* */ }
      }

      // Handle resume upload if file input is present
      if (ctx.resumeFilePath) {
        try {
          const fileInput = await page.$("input[type='file'][name*='resume'], input[type='file'][accept*='pdf']");
          if (fileInput) {
            await fileInput.setInputFiles(ctx.resumeFilePath);
            steps.push("Uploaded resume PDF");
            await page.waitForTimeout(1500);
          }
        } catch { /* */ }
      }

      // Handle work experience questions
      try {
        const titleInput = await page.$("input[name*='title'], input[id*='title'], input[aria-label*='Title']");
        if (titleInput) {
          const current = await titleInput.inputValue();
          if (!current && ctx.currentTitle) { await titleInput.fill(ctx.currentTitle); }
        }
      } catch { /* */ }

      // Handle years of experience
      try {
        const yoeInput = await page.$("input[name*='years'], input[aria-label*='years']");
        if (yoeInput) {
          const current = await yoeInput.inputValue();
          if (!current && ctx.yearsExp) { await yoeInput.fill(ctx.yearsExp); }
        }
      } catch { /* */ }

      // Handle sponsorship question (select/radio)
      try {
        const selects = await page.$$("select");
        for (const sel of selects) {
          const label = await sel.evaluate((el: any) => {
            const lbl = el.closest(".fb-dash-form-element")?.querySelector("label, span");
            return lbl?.textContent || "";
          });
          if (/sponsor|visa|authorization|authorized/i.test(label)) {
            const answer = ctx.needsSponsorship ? "Yes" : "No";
            try { await sel.selectOption({ label: answer }); } catch {
              try { await sel.selectOption({ value: answer.toLowerCase() }); } catch { /* */ }
            }
          }
        }
      } catch { /* */ }

      // Handle additional text areas (cover letter, additional info)
      try {
        const textareas = await page.$$("textarea");
        for (const ta of textareas) {
          const current = await ta.inputValue();
          if (!current && ctx.coverLetterText) {
            await ta.fill(ctx.coverLetterText);
            steps.push("Filled additional text field");
          }
        }
      } catch { /* */ }

      steps.push(`Completed modal step ${step + 1}`);
      await takeStepScreenshot(`Step ${step + 1}`);

      // Click Next button to advance
      const nextBtn = await page.$("button[aria-label*='Continue'], button[aria-label*='Next'], button:has-text('Next'), button:has-text('Continue'), button:has-text('Review')");
      if (nextBtn) {
        await nextBtn.click();
        await page.waitForTimeout(2000);
      } else {
        // No next button found — might be done or stuck
        break;
      }
    }

    const finalScreenshot = await page.screenshot({ type: "png", fullPage: false });
    const finalBase64 = finalScreenshot.toString("base64");

    // Detect confirmation for LinkedIn
    const confirmation = await detectConfirmation(page);
    if (confirmation.detected) {
      steps.push(`Confirmation detected: ${confirmation.text}`);
    }

    return {
      success: true,
      platform: "linkedin",
      message: confirmation.detected
        ? `LinkedIn Easy Apply submitted! ${confirmation.text}`
        : `LinkedIn Easy Apply completed. ${steps.length} steps processed.`,
      screenshotBase64: finalBase64,
      stepsCompleted: steps,
      screenshotSteps,
      confirmationDetected: confirmation.detected,
      confirmationText: confirmation.text,
    };
  } catch (err) {
    return {
      success: false,
      platform: "linkedin",
      message: `LinkedIn Easy Apply failed: ${(err as Error).message}`,
      stepsCompleted: steps,
      screenshotSteps,
    };
  }
}

// ── Workable Auto-Fill + Submit (Schema-Driven) ──
async function applyWorkable(page: any, ctx: ApplyContext): Promise<ApplyResult> {
  const steps: string[] = [];
  const screenshots: { step: string; screenshot: string }[] = [];

  try {
    // 1. Fetch form schema via public API (no browser needed — fast)
    const url = page.url();
    let schema: any = null;
    let aiAnswers: Map<string, string> = new Map();
    try {
      const { parseWorkableUrl, fetchWorkableFormSchema, answerWorkableQuestions } = await import("./api/workable");
      const parsed = parseWorkableUrl(url);
      if (parsed) {
        schema = await fetchWorkableFormSchema(parsed.company, parsed.shortcode);
        console.log(`[Workable] Schema: ${schema.fields.length} standard + ${schema.customQuestions.length} custom fields`);
        steps.push(`Schema: ${schema.fields.length} standard + ${schema.customQuestions.length} custom`);
        if (schema.customQuestions.length > 0) {
          try {
            const OpenAI = (await import("openai")).default;
            const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
            aiAnswers = await answerWorkableQuestions(
              openai, schema.customQuestions,
              { firstName: ctx.firstName, lastName: ctx.lastName, email: ctx.email, phone: ctx.phone, linkedIn: ctx.linkedIn, location: ctx.location, resumeFilePath: ctx.resumeFilePath, currentTitle: ctx.currentTitle, needsSponsorship: ctx.needsSponsorship },
              ctx.jobTitle || "Software Engineer", ctx.company || parsed.company,
            );
            steps.push(`AI answered ${aiAnswers.size}/${schema.customQuestions.length} questions`);
          } catch (aiErr) {
            console.log(`[Workable] AI failed: ${(aiErr as Error).message?.slice(0, 80)}`);
          }
        }
      }
    } catch (schemaErr) {
      console.log(`[Workable] Schema fetch failed: ${(schemaErr as Error).message?.slice(0, 80)}`);
    }

    // 2. Build a value map from schema + AI answers
    const valueMap: Record<string, string> = {};
    if (schema) {
      for (const f of schema.fields) {
        if (f.id === "firstname") valueMap[f.id] = ctx.firstName;
        else if (f.id === "lastname") valueMap[f.id] = ctx.lastName;
        else if (f.id === "email") valueMap[f.id] = ctx.email;
        else if (f.id === "phone") valueMap[f.id] = ctx.phone || "";
        else if (f.id === "headline") valueMap[f.id] = ctx.currentTitle || "Software Engineer";
        else if (f.id === "address") valueMap[f.id] = ctx.location || "";
        else if (f.id === "summary") valueMap[f.id] = ctx.resumeText?.slice(0, 500) || "";
        else if (f.id === "cover_letter") valueMap[f.id] = ctx.coverLetterText || "";
      }
      for (const [qId, ans] of Array.from(aiAnswers.entries())) {
        valueMap[qId] = ans;
      }
    } else {
      valueMap["firstname"] = ctx.firstName;
      valueMap["lastname"] = ctx.lastName;
      valueMap["email"] = ctx.email;
      valueMap["phone"] = ctx.phone || "";
    }

    // 3. Use page.evaluate() to fill ALL fields in one shot (no per-field timeouts)
    const fillResult = await Promise.race([
      page.evaluate((vals: Record<string, string>) => {
        const filled: string[] = [];
        const missed: string[] = [];
        for (const [id, value] of Object.entries(vals)) {
          if (!value) continue;
          // Try multiple selector patterns
          const el = document.querySelector(
            `input[name="${id}"], textarea[name="${id}"], #${id}, input[data-ui="${id}"], textarea[data-ui="${id}"]`
          ) as HTMLInputElement | HTMLTextAreaElement | null;
          if (el) {
            // React-aware: set value via native setter then dispatch events
            const nativeSetter = Object.getOwnPropertyDescriptor(
              el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
              "value"
            )?.set;
            if (nativeSetter) nativeSetter.call(el, value);
            else el.value = value;
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
            filled.push(id);
          } else {
            missed.push(id);
          }
        }
        return { filled, missed };
      }, valueMap),
      new Promise((_, reject) => setTimeout(() => reject(new Error("DOM fill timed out after 5s")), 5000)),
    ]) as { filled: string[]; missed: string[] };

    steps.push(`Filled ${fillResult.filled.length} fields via DOM`);
    if (fillResult.missed.length > 0) {
      console.log(`[Workable] Missed fields: ${fillResult.missed.join(", ")}`);
    }

    // 4. Resume upload (needs Playwright file API, not page.evaluate)
    if (ctx.resumeFilePath) {
      try {
        const fileInput = await page.$("input[type='file']");
        if (fileInput) {
          await fileInput.setInputFiles(ctx.resumeFilePath);
          steps.push("Uploaded resume");
        }
      } catch { /* skip */ }
    }

    // 5. GDPR consent
    try {
      await page.evaluate(() => {
        const cb = document.querySelector("input[name='gdpr'], input#gdpr") as HTMLInputElement | null;
        if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event("change", { bubbles: true })); return true; }
        return false;
      });
    } catch { /* */ }

    await takeScreenshot(page, "1. Form filled", screenshots);

    // 6. Submit
    try {
      const submitBtn = await page.$("button[type='submit'], button:has-text('Submit'), button:has-text('Apply')");
      if (submitBtn) {
        await humanDelay(page, 500, 1000);
        await Promise.race([
          submitBtn.click(),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Submit click timed out")), 5000)),
        ]);
        steps.push("Clicked Submit");
        await page.waitForTimeout(4000);
        await takeScreenshot(page, "2. After submit", screenshots);
        const confirmation = await detectConfirmation(page);
        if (confirmation.detected) steps.push(`Confirmation: ${confirmation.text}`);
        return { success: true, platform: "workable", message: confirmation.detected ? `Submitted! ${confirmation.text}` : "Form submitted.", stepsCompleted: steps, screenshotSteps: screenshots, confirmationDetected: confirmation.detected, confirmationText: confirmation.text };
      }
    } catch (submitErr) {
      console.log(`[Workable] Submit error: ${(submitErr as Error).message?.slice(0, 60)}`);
    }

    return { success: true, platform: "workable", message: `Form filled (${fillResult.filled.length} fields), submit not confirmed.`, stepsCompleted: steps, screenshotSteps: screenshots, confirmationDetected: false };
  } catch (err) {
    return { success: false, platform: "workable", message: `Workable apply failed: ${(err as Error).message}`, stepsCompleted: steps, screenshotSteps: screenshots };
  }
}

// ── Ashby Auto-Fill + Submit (Schema-Driven) ──
async function applyAshby(page: any, ctx: ApplyContext): Promise<ApplyResult> {
  const steps: string[] = [];
  const screenshots: { step: string; screenshot: string }[] = [];

  try {
    // 1. Parse URL and fetch form schema via GraphQL (no extra network — fast)
    const url = page.url();
    let schema: any = null;
    try {
      const { parseAshbyUrl, fetchAshbyFormSchema, answerAshbyQuestions } = await import("./api/ashby");
      const parsed = parseAshbyUrl(url);
      if (parsed) {
        schema = await fetchAshbyFormSchema(parsed.orgSlug, parsed.jobPostingId);
        console.log(`[Ashby] Schema: ${schema.fields.length} standard + ${schema.customQuestions.length} custom fields`);
        steps.push(`Schema: ${schema.fields.length} standard + ${schema.customQuestions.length} custom`);

        // Pre-compute AI answers for custom questions
        if (schema.customQuestions.length > 0) {
          try {
            const OpenAI = (await import("openai")).default;
            const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
            const answers = await answerAshbyQuestions(
              openai, schema.customQuestions,
              { firstName: ctx.firstName, lastName: ctx.lastName, email: ctx.email, phone: ctx.phone, linkedIn: ctx.linkedIn, location: ctx.location, resumeFilePath: ctx.resumeFilePath },
              ctx.jobTitle || "Software Engineer", ctx.company || parsed.orgSlug,
            );
            // Store answers on schema for use below
            schema._aiAnswers = answers;
            steps.push(`AI answered ${answers.size}/${schema.customQuestions.length} questions`);
          } catch (aiErr) {
            console.log(`[Ashby] AI question answering failed: ${(aiErr as Error).message?.slice(0, 80)}`);
          }
        }
      }
    } catch (schemaErr) {
      console.log(`[Ashby] Schema fetch failed, falling back to generic: ${(schemaErr as Error).message?.slice(0, 80)}`);
    }

    // 2. Navigate to application form if needed
    if (!url.includes("/application")) {
      try {
        const applyBtn = await page.$("button:has-text('Apply'), a:has-text('Apply'), a[href*='application']");
        if (applyBtn) { await applyBtn.click(); await page.waitForTimeout(3000); steps.push("Navigated to application form"); }
      } catch { /* */ }
    }

    await page.waitForSelector("input, textarea", { timeout: 10000 });
    steps.push("Ashby form loaded");
    await takeScreenshot(page, "1. Ashby form loaded", screenshots);

    // 3. Fill fields — use schema if available, otherwise fall back to generic selectors
    if (schema) {
      // Schema-driven: target each field by its path (which matches the input name attribute)
      for (const field of schema.fields) {
        const entry = schema.fieldEntries.find((e: any) => e.id === field.id);
        const fieldPath = entry?.field?.path || field.id;
        const labelLower = field.label.toLowerCase();

        try {
          if (field.type === "file") {
            // Resume upload
            if (ctx.resumeFilePath) {
              const fileInput = await page.$("input[type='file']");
              if (fileInput) {
                await fileInput.setInputFiles(ctx.resumeFilePath);
                steps.push(`Uploaded resume`);
                await humanDelay(page, 1000, 2000);
              }
            }
          } else {
            // Text/email/phone — target by name attribute
            let value = "";
            if (labelLower.includes("name") || labelLower === "full name") {
              value = `${ctx.firstName} ${ctx.lastName}`;
            } else if (labelLower.includes("email")) {
              value = ctx.email;
            } else if (labelLower.includes("phone")) {
              value = ctx.phone || "";
            }

            if (value) {
              const el = await page.$(`input[name="${fieldPath}"], input[name="${field.id}"]`);
              if (el) {
                await el.click();
                await humanDelay(page, 100, 300);
                await el.fill(value);
                steps.push(`Set "${field.label}": ${value}`);
              } else {
                console.log(`[Ashby] Could not find input for "${field.label}" (path: ${fieldPath})`);
              }
            }
          }
        } catch (fieldErr) {
          console.log(`[Ashby] Error filling "${field.label}": ${(fieldErr as Error).message?.slice(0, 60)}`);
        }
      }

      // Fill custom questions using AI answers
      const aiAnswers: Map<string, string> = schema._aiAnswers || new Map();
      for (const q of schema.customQuestions) {
        const entry = schema.fieldEntries.find((e: any) => e.id === q.id);
        const fieldPath = entry?.field?.path || q.id;
        const answer = aiAnswers.get(q.id);
        if (!answer) continue;

        try {
          if (q.type === "boolean") {
            // Ashby uses Yes/No button toggles (not standard checkboxes).
            // Structure: <div class="_yesno_..."><button>Yes</button><button>No</button><input type="checkbox" hidden></div>
            const shouldCheck = answer.toLowerCase() === "true" || answer.toLowerCase() === "yes";
            const btnText = shouldCheck ? "Yes" : "No";
            // Find the container with the hidden checkbox, then click the correct button
            const container = await page.$(`input[name="${fieldPath}"], input[name="${q.id}"]`);
            if (container) {
              const parent = await container.evaluateHandle((el: Element) => el.parentElement);
              const btn = await parent.$(`:scope > button:has-text("${btnText}")`);
              if (btn) {
                await btn.click();
                await humanDelay(page, 200, 400);
                steps.push(`Set "${q.label}": ${btnText}`);
              } else {
                // Fallback: try clicking by text near the field
                const fallbackBtn = await page.$(`input[name="${fieldPath}"] ~ button:has-text("${btnText}"), input[name="${q.id}"] ~ button:has-text("${btnText}")`);
                if (fallbackBtn) { await fallbackBtn.click(); steps.push(`Set "${q.label}": ${btnText}`); }
              }
            }
          } else if (q.type === "select" || q.type === "multi_select") {
            // Select dropdown
            const sel = await page.$(`select[name="${fieldPath}"], select[name="${q.id}"]`);
            if (sel) {
              await sel.selectOption({ label: answer });
              steps.push(`Selected "${q.label}": ${answer}`);
            }
          } else {
            // Text input or textarea
            const el = await page.$(`input[name="${fieldPath}"], textarea[name="${fieldPath}"], input[name="${q.id}"], textarea[name="${q.id}"]`);
            if (el) {
              await el.click();
              await humanDelay(page, 100, 300);
              await el.fill(answer);
              steps.push(`Answered "${q.label}": ${answer.slice(0, 50)}`);
            }
          }
        } catch (qErr) {
          console.log(`[Ashby] Error answering "${q.label}": ${(qErr as Error).message?.slice(0, 60)}`);
        }
      }
    } else {
      // Fallback: generic selector-based filling
      const fields: [string, string][] = [
        ["input[name*='name' i], input[name*='_systemfield_name']", `${ctx.firstName} ${ctx.lastName}`],
        ["input[name*='email' i], input[name*='_systemfield_email']", ctx.email],
        ["input[type='tel'], input[name*='phone' i]", ctx.phone || ""],
        ["input[name*='linkedin' i], input[placeholder*='LinkedIn' i]", ctx.linkedIn || ""],
      ];
      for (const [sel, val] of fields) {
        if (!val) continue;
        try {
          const el = await page.$(sel);
          if (el) { await el.click(); await humanDelay(page, 200, 500); await el.fill(val); }
        } catch { /* */ }
      }
      steps.push("Filled personal info (generic)");

      if (ctx.resumeFilePath) {
        try {
          const fileInput = await page.$("input[type='file']");
          if (fileInput) { await fileInput.setInputFiles(ctx.resumeFilePath); steps.push("Uploaded resume"); await humanDelay(page, 1000, 2000); }
        } catch { /* */ }
      }

      try {
        const textareas = await page.$$("textarea");
        for (const ta of textareas) {
          const current = await ta.inputValue();
          if (!current && ctx.coverLetterText) { await ta.fill(ctx.coverLetterText); steps.push("Filled text field"); break; }
        }
      } catch { /* */ }
    }

    await takeScreenshot(page, "2. Form filled", screenshots);

    // 4. Submit
    const submitBtn = await page.$("button[type='submit'], button:has-text('Submit'), button:has-text('Apply')");
    if (submitBtn) {
      await humanDelay(page, 800, 1500);
      await submitBtn.click();
      steps.push("Clicked Submit");
      await page.waitForTimeout(5000);
      await takeScreenshot(page, "3. After submit", screenshots);
      const confirmation = await detectConfirmation(page);
      if (confirmation.detected) steps.push(`Confirmation: ${confirmation.text}`);
      return { success: true, platform: "ashby", message: confirmation.detected ? `Submitted! ${confirmation.text}` : "Form submitted.", stepsCompleted: steps, screenshotSteps: screenshots, confirmationDetected: confirmation.detected, confirmationText: confirmation.text };
    }
    return { success: true, platform: "ashby", message: "Form filled, no submit button found.", stepsCompleted: steps, screenshotSteps: screenshots, confirmationDetected: false };
  } catch (err) {
    return { success: false, platform: "ashby", message: `Ashby apply failed: ${(err as Error).message}`, stepsCompleted: steps, screenshotSteps: screenshots };
  }
}

// ── SmartRecruiters Auto-Fill + Submit ──
async function applySmartRecruiters(page: any, ctx: ApplyContext): Promise<ApplyResult> {
  const steps: string[] = [];
  const screenshots: { step: string; screenshot: string }[] = [];

  try {
    await page.waitForSelector("form, .st-apply-button, button:has-text('Apply')", { timeout: 10000 });
    steps.push("SmartRecruiters page loaded");
    await takeScreenshot(page, "1. SmartRecruiters page loaded", screenshots);

    // Click Apply
    try {
      const applyBtn = await page.$("button:has-text('Apply'), a:has-text('Apply Now'), .st-apply-button");
      if (applyBtn) { await applyBtn.click(); await page.waitForTimeout(3000); steps.push("Clicked Apply"); await takeScreenshot(page, "2. Clicked Apply", screenshots); }
    } catch { /* */ }

    // SmartRecruiters often has a multi-step form
    const fields: [string, string][] = [
      ["input[name*='firstName'], input[id*='firstName']", ctx.firstName],
      ["input[name*='lastName'], input[id*='lastName']", ctx.lastName],
      ["input[name*='email'], input[id*='email'], input[type='email']", ctx.email],
      ["input[name*='phone'], input[id*='phone'], input[type='tel']", ctx.phone || ""],
      ["input[name*='linkedin' i], input[placeholder*='LinkedIn' i], input[name*='url' i]", ctx.linkedIn || ""],
      ["input[name*='location' i], input[name*='city' i], input[placeholder*='Location' i]", ctx.location || ""],
    ];
    for (const [sel, val] of fields) {
      if (!val) continue;
      try {
        const el = await page.$(sel);
        if (el) { await el.click(); await humanDelay(page, 200, 500); await el.fill(val); }
      } catch { /* */ }
    }
    steps.push("Filled personal info");
    await takeScreenshot(page, "3. Personal info filled", screenshots);

    // Resume upload
    if (ctx.resumeFilePath) {
      try {
        const fileInput = await page.$("input[type='file']");
        if (fileInput) { await fileInput.setInputFiles(ctx.resumeFilePath); steps.push("Uploaded resume"); await takeScreenshot(page, "4. Resume uploaded", screenshots); await humanDelay(page, 1500, 2500); }
      } catch { /* */ }
    }

    // Cover letter
    if (ctx.coverLetterText) {
      try {
        const ta = await page.$("textarea[name*='cover' i], textarea[name*='letter' i], textarea[id*='cover' i], textarea[placeholder*='cover' i]");
        if (ta) { await ta.fill(ctx.coverLetterText); steps.push("Filled cover letter"); await takeScreenshot(page, "5. Cover letter filled", screenshots); }
      } catch { /* */ }
    }

    await takeScreenshot(page, "6. Form complete — before submit", screenshots);

    // Navigate through steps if multi-step
    for (let i = 0; i < 3; i++) {
      const nextBtn = await page.$("button:has-text('Next'), button:has-text('Continue')");
      if (nextBtn) {
        await humanDelay(page, 500, 1000);
        await nextBtn.click();
        await page.waitForTimeout(2000);
        steps.push(`Completed step ${i + 1}`);
        await takeScreenshot(page, `Step ${i + 1} completed`, screenshots);
      } else break;
    }

    const submitBtn = await page.$("button[type='submit'], button:has-text('Submit'), button:has-text('Apply')");
    if (submitBtn) {
      await humanDelay(page, 800, 1500);
      await submitBtn.click();
      steps.push("Clicked Submit");
      await page.waitForTimeout(4000);
      await takeScreenshot(page, "7. After submit", screenshots);
      const confirmation = await detectConfirmation(page);
      if (confirmation.detected) steps.push(`Confirmation: ${confirmation.text}`);
      return { success: true, platform: "smartrecruiters", message: confirmation.detected ? `Submitted! ${confirmation.text}` : "Form submitted.", stepsCompleted: steps, screenshotSteps: screenshots, confirmationDetected: confirmation.detected, confirmationText: confirmation.text };
    }
    return { success: true, platform: "smartrecruiters", message: "Form filled, no submit button found.", stepsCompleted: steps, screenshotSteps: screenshots, confirmationDetected: false };
  } catch (err) {
    return { success: false, platform: "smartrecruiters", message: `SmartRecruiters apply failed: ${(err as Error).message}`, stepsCompleted: steps, screenshotSteps: screenshots };
  }
}

// ── iCIMS Auto-Fill + Submit ──
async function applyICIMS(page: any, ctx: ApplyContext): Promise<ApplyResult> {
  const steps: string[] = [];
  const screenshots: { step: string; screenshot: string }[] = [];

  try {
    // iCIMS often uses iframes
    await page.waitForSelector("form, iframe[src*='icims'], button:has-text('Apply')", { timeout: 10000 });
    steps.push("iCIMS page loaded");
    await takeScreenshot(page, "1. iCIMS page loaded", screenshots);

    // Check for iframe and switch to it
    try {
      const iframe = await page.$("iframe[src*='icims'], iframe[id*='icims']");
      if (iframe) {
        const frame = await iframe.contentFrame();
        if (frame) {
          // Work within the iframe
          const iFields: [string, string][] = [
            ["input[name*='firstName'], input[id*='firstName']", ctx.firstName],
            ["input[name*='lastName'], input[id*='lastName']", ctx.lastName],
            ["input[name*='email'], input[type='email']", ctx.email],
            ["input[name*='phone'], input[type='tel']", ctx.phone || ""],
            ["input[name*='linkedin' i], input[placeholder*='LinkedIn' i]", ctx.linkedIn || ""],
            ["input[name*='location' i], input[name*='city' i]", ctx.location || ""],
          ];
          for (const [sel, val] of iFields) {
            if (!val) continue;
            try {
              const el = await frame.$(sel);
              if (el) { await el.click(); await humanDelay(page, 200, 500); await el.fill(val); }
            } catch { /* */ }
          }
          steps.push("Filled personal info (iframe)");
          await takeScreenshot(page, "2. Personal info filled (iframe)", screenshots);

          if (ctx.resumeFilePath) {
            try {
              const fileInput = await frame.$("input[type='file']");
              if (fileInput) { await fileInput.setInputFiles(ctx.resumeFilePath); steps.push("Uploaded resume"); await takeScreenshot(page, "3. Resume uploaded (iframe)", screenshots); }
            } catch { /* */ }
          }

          await takeScreenshot(page, "4. Form complete (iframe)", screenshots);

          const submitBtn = await frame.$("button[type='submit'], input[type='submit'], button:has-text('Submit'), button:has-text('Apply')");
          if (submitBtn) {
            await humanDelay(page, 800, 1500);
            await submitBtn.click();
            steps.push("Clicked Submit");
            await page.waitForTimeout(4000);
            await takeScreenshot(page, "After submit", screenshots);
            const confirmation = await detectConfirmation(page);
            if (confirmation.detected) steps.push(`Confirmation: ${confirmation.text}`);
            return { success: true, platform: "icims", message: confirmation.detected ? `Submitted! ${confirmation.text}` : "Form submitted.", stepsCompleted: steps, screenshotSteps: screenshots, confirmationDetected: confirmation.detected, confirmationText: confirmation.text };
          }
        }
      }
    } catch { /* no iframe, try direct */ }

    // Direct form (no iframe)
    const fields: [string, string][] = [
      ["input[name*='firstName'], input[id*='firstName']", ctx.firstName],
      ["input[name*='lastName'], input[id*='lastName']", ctx.lastName],
      ["input[name*='email'], input[type='email']", ctx.email],
      ["input[name*='phone'], input[type='tel']", ctx.phone || ""],
      ["input[name*='linkedin' i], input[placeholder*='LinkedIn' i]", ctx.linkedIn || ""],
      ["input[name*='location' i], input[name*='city' i]", ctx.location || ""],
    ];
    for (const [sel, val] of fields) {
      if (!val) continue;
      try {
        const el = await page.$(sel);
        if (el) { await el.click(); await humanDelay(page, 200, 500); await el.fill(val); }
      } catch { /* */ }
    }
    steps.push("Filled personal info");
    await takeScreenshot(page, "2. Personal info filled", screenshots);

    if (ctx.resumeFilePath) {
      try {
        const fileInput = await page.$("input[type='file']");
        if (fileInput) { await fileInput.setInputFiles(ctx.resumeFilePath); steps.push("Uploaded resume"); await takeScreenshot(page, "3. Resume uploaded", screenshots); }
      } catch { /* */ }
    }

    await takeScreenshot(page, "4. Form complete", screenshots);

    const submitBtn = await page.$("button[type='submit'], input[type='submit'], button:has-text('Submit')");
    if (submitBtn) {
      await humanDelay(page, 800, 1500);
      await submitBtn.click();
      steps.push("Clicked Submit");
      await page.waitForTimeout(4000);
      await takeScreenshot(page, "After submit", screenshots);
      const confirmation = await detectConfirmation(page);
      if (confirmation.detected) steps.push(`Confirmation: ${confirmation.text}`);
      return { success: true, platform: "icims", message: confirmation.detected ? `Submitted! ${confirmation.text}` : "Form submitted.", stepsCompleted: steps, screenshotSteps: screenshots, confirmationDetected: confirmation.detected, confirmationText: confirmation.text };
    }
    return { success: true, platform: "icims", message: "Form filled, no submit button found.", stepsCompleted: steps, screenshotSteps: screenshots, confirmationDetected: false };
  } catch (err) {
    return { success: false, platform: "icims", message: `iCIMS apply failed: ${(err as Error).message}`, stepsCompleted: steps, screenshotSteps: screenshots };
  }
}

// ── Taleo (Oracle) Auto-Fill + Submit ──
async function applyTaleo(page: any, ctx: ApplyContext): Promise<ApplyResult> {
  const steps: string[] = [];
  const screenshots: { step: string; screenshot: string }[] = [];

  try {
    // Taleo has notoriously complex forms, often multi-page
    await page.waitForSelector("form, #requisitionDescriptionInterface, .apply-button, button:has-text('Apply')", { timeout: 15000 });
    steps.push("Taleo page loaded");

    // Click Apply
    try {
      const applyBtn = await page.$("a:has-text('Apply'), button:has-text('Apply'), .apply-button, a[href*='apply']");
      if (applyBtn) { await applyBtn.click(); await page.waitForTimeout(3000); steps.push("Clicked Apply"); }
    } catch { /* */ }

    // Taleo may require creating an account or logging in — check for that
    const loginForm = await page.$("input[name*='username'], input[name*='email'][type='email'], #email");
    if (loginForm) {
      // Try to fill email as "guest" or "new applicant" flow
      try {
        const newApplicantBtn = await page.$("button:has-text('New'), a:has-text('new'), button:has-text('Create'), a:has-text('Create')");
        if (newApplicantBtn) { await newApplicantBtn.click(); await page.waitForTimeout(2000); steps.push("Selected new applicant flow"); }
      } catch { /* */ }
    }

    // Fill fields across potentially multiple pages
    for (let pageNum = 0; pageNum < 5; pageNum++) {
      const fields: [string, string][] = [
        ["input[name*='firstName'], input[id*='firstName'], input[name*='first']", ctx.firstName],
        ["input[name*='lastName'], input[id*='lastName'], input[name*='last']", ctx.lastName],
        ["input[name*='email'], input[type='email']", ctx.email],
        ["input[name*='phone'], input[type='tel']", ctx.phone || ""],
        ["input[name*='address'], input[id*='address']", ctx.location || ""],
      ];
      for (const [sel, val] of fields) {
        if (!val) continue;
        try {
          const el = await page.$(sel);
          if (el) {
            const current = await el.inputValue();
            if (!current) { await el.click(); await humanDelay(page, 200, 500); await el.fill(val); }
          }
        } catch { /* */ }
      }

      // Resume upload
      if (ctx.resumeFilePath) {
        try {
          const fileInput = await page.$("input[type='file']");
          if (fileInput) { await fileInput.setInputFiles(ctx.resumeFilePath); steps.push("Uploaded resume"); await humanDelay(page, 1500, 2500); }
        } catch { /* */ }
      }

      // Cover letter
      try {
        const textareas = await page.$$("textarea");
        for (const ta of textareas) {
          const current = await ta.inputValue();
          if (!current && ctx.coverLetterText) { await ta.fill(ctx.coverLetterText); break; }
        }
      } catch { /* */ }

      steps.push(`Completed page ${pageNum + 1}`);
      await takeScreenshot(page, `Page ${pageNum + 1}`, screenshots);

      // Try to advance to next page
      const nextBtn = await page.$("button:has-text('Next'), button:has-text('Continue'), input[value='Next'], a:has-text('Next')");
      if (nextBtn) {
        await humanDelay(page, 500, 1000);
        await nextBtn.click();
        await page.waitForTimeout(3000);
      } else {
        // Check for submit
        const submitBtn = await page.$("button[type='submit'], button:has-text('Submit'), input[type='submit'], input[value='Submit']");
        if (submitBtn) {
          await humanDelay(page, 800, 1500);
          await submitBtn.click();
          steps.push("Clicked Submit");
          await page.waitForTimeout(5000);
          await takeScreenshot(page, "After submit", screenshots);
          const confirmation = await detectConfirmation(page);
          if (confirmation.detected) steps.push(`Confirmation: ${confirmation.text}`);
          return { success: true, platform: "taleo", message: confirmation.detected ? `Submitted! ${confirmation.text}` : "Form submitted.", stepsCompleted: steps, screenshotSteps: screenshots, confirmationDetected: confirmation.detected, confirmationText: confirmation.text };
        }
        break;
      }
    }

    return { success: true, platform: "taleo", message: "Form filled across multiple pages. May need manual review.", stepsCompleted: steps, screenshotSteps: screenshots, confirmationDetected: false };
  } catch (err) {
    return { success: false, platform: "taleo", message: `Taleo apply failed: ${(err as Error).message}`, stepsCompleted: steps, screenshotSteps: screenshots };
  }
}

// ── Generic/Universal Auto-Apply (for unsupported platforms) ──
async function applyGeneric(page: any, ctx: ApplyContext): Promise<ApplyResult> {
  const steps: string[] = [];
  const screenshots: { step: string; screenshot: string }[] = [];

  try {
    await page.waitForTimeout(2000);
    steps.push("Page loaded");
    await takeScreenshot(page, "1. Page loaded", screenshots);

    // Look for an "Apply" button/link to click first
    try {
      const applyBtn = await page.$("a:has-text('Apply'), button:has-text('Apply'), a[href*='apply'], [data-testid*='apply']");
      if (applyBtn) {
        await applyBtn.click();
        await page.waitForTimeout(3000);
        steps.push("Clicked Apply button/link");
        await takeScreenshot(page, "2. Clicked Apply", screenshots);
      }
    } catch { /* no apply button, may already be on form */ }

    // Try to find and fill any form on the page
    const formExists = await page.$("form, input[type='email'], input[name*='email']");
    if (!formExists) {
      await takeScreenshot(page, "No application form found", screenshots);
      return {
        success: false,
        platform: "generic",
        message: "No application form found on this page. This job may require applying on the company's website directly.",
        stepsCompleted: steps,
        screenshotSteps: screenshots,
      };
    }

    // Fill email fields
    const emailSelectors = [
      "input[type='email']", "input[name*='email']", "input[id*='email']",
      "input[placeholder*='email' i]", "input[autocomplete='email']",
    ];
    for (const sel of emailSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          const current = await el.inputValue();
          if (!current) { await el.click(); await humanDelay(page, 200, 500); await el.fill(ctx.email); steps.push("Filled email"); break; }
        }
      } catch { /* */ }
    }

    // Fill name fields (try full name first, then first/last)
    const nameSelectors = [
      ["input[name*='name' i]:not([name*='last']):not([name*='company']):not([name*='user'])", `${ctx.firstName} ${ctx.lastName}`],
      ["input[name*='first' i], input[id*='first' i], input[placeholder*='first' i]", ctx.firstName],
      ["input[name*='last' i], input[id*='last' i], input[placeholder*='last' i]", ctx.lastName],
    ];
    for (const [sel, val] of nameSelectors) {
      if (!val) continue;
      try {
        const el = await page.$(sel);
        if (el) {
          const current = await el.inputValue();
          if (!current) { await el.click(); await humanDelay(page, 200, 500); await el.fill(val); }
        }
      } catch { /* */ }
    }
    steps.push("Filled name fields");

    // Fill phone
    if (ctx.phone) {
      try {
        const phoneEl = await page.$("input[type='tel'], input[name*='phone' i], input[id*='phone' i], input[placeholder*='phone' i]");
        if (phoneEl) {
          const current = await phoneEl.inputValue();
          if (!current) { await phoneEl.click(); await humanDelay(page, 200, 500); await phoneEl.fill(ctx.phone); steps.push("Filled phone"); }
        }
      } catch { /* */ }
    }

    // Fill LinkedIn
    if (ctx.linkedIn) {
      try {
        const linkedInEl = await page.$("input[name*='linkedin' i], input[id*='linkedin' i], input[placeholder*='linkedin' i]");
        if (linkedInEl) {
          const current = await linkedInEl.inputValue();
          if (!current) { await linkedInEl.click(); await humanDelay(page, 200, 500); await linkedInEl.fill(ctx.linkedIn); steps.push("Filled LinkedIn"); }
        }
      } catch { /* */ }
    }

    await takeScreenshot(page, "3. Personal info filled", screenshots);

    // Resume upload
    if (ctx.resumeFilePath) {
      try {
        const fileInput = await page.$("input[type='file']");
        if (fileInput) {
          await fileInput.setInputFiles(ctx.resumeFilePath);
          steps.push("Uploaded resume");
          await takeScreenshot(page, "4. Resume uploaded", screenshots);
          await humanDelay(page, 1000, 2000);
        }
      } catch { /* */ }
    }

    // Fill textareas (cover letter, additional info)
    if (ctx.coverLetterText) {
      try {
        const textareas = await page.$$("textarea");
        for (const ta of textareas) {
          const current = await ta.inputValue();
          if (!current) {
            await ta.fill(ctx.coverLetterText);
            steps.push("Filled text area (cover letter)");
            await takeScreenshot(page, "5. Cover letter filled", screenshots);
            break;
          }
        }
      } catch { /* */ }
    }

    // Handle select dropdowns (sponsorship, work authorization)
    try {
      const selects = await page.$$("select");
      for (const sel of selects) {
        const label = await sel.evaluate((el: any) => {
          const lbl = el.closest("div, fieldset, label")?.querySelector("label, span, legend");
          return lbl?.textContent || "";
        });
        if (/sponsor|visa|authorization|authorized/i.test(label)) {
          const answer = ctx.needsSponsorship ? "Yes" : "No";
          try { await sel.selectOption({ label: answer }); steps.push("Answered sponsorship question"); } catch {
            try { await sel.selectOption({ value: answer.toLowerCase() }); } catch { /* */ }
          }
        }
      }
    } catch { /* */ }

    await takeScreenshot(page, "6. Form complete — before submit", screenshots);

    // Find and click submit button
    const submitSelectors = [
      "button[type='submit']", "input[type='submit']",
      "button:has-text('Submit')", "button:has-text('Apply')",
      "button:has-text('Send')", "button:has-text('Submit Application')",
      "a:has-text('Submit')", "a:has-text('Apply Now')",
    ];
    for (const sel of submitSelectors) {
      try {
        const btn = await page.$(sel);
        if (btn) {
          await humanDelay(page, 800, 1500);
          await btn.click();
          steps.push("Clicked Submit");
          await page.waitForTimeout(4000);
          await takeScreenshot(page, "7. After submit", screenshots);

          const confirmation = await detectConfirmation(page);
          if (confirmation.detected) {
            steps.push(`Confirmation: ${confirmation.text}`);
            return {
              success: true,
              platform: "generic",
              message: `Application submitted! ${confirmation.text}`,
              stepsCompleted: steps,
              screenshotSteps: screenshots,
              confirmationDetected: true,
              confirmationText: confirmation.text,
            };
          }

          return {
            success: false,
            platform: "generic",
            message: "Form submitted but no confirmation detected. Please verify manually.",
            stepsCompleted: steps,
            screenshotSteps: screenshots,
            confirmationDetected: false,
          };
        }
      } catch { /* */ }
    }

    return {
      success: false,
      platform: "generic",
      message: "Form filled but no submit button found. Manual submission required.",
      stepsCompleted: steps,
      screenshotSteps: screenshots,
      confirmationDetected: false,
    };
  } catch (err) {
    await takeScreenshot(page, "Error state", screenshots);
    return {
      success: false,
      platform: "generic",
      message: `Generic auto-apply failed: ${(err as Error).message}`,
      stepsCompleted: steps,
      screenshotSteps: screenshots,
    };
  }
}

// ── Main Auto-Apply Function ──
// When aiOptions is provided, the AI agent handles ALL platforms adaptively.
// Without aiOptions, falls back to hardcoded platform-specific handlers.
export interface AIAgentOptions {
  openai?: any; // Legacy OpenAI client instance (fallback)
  aiClient?: { provider: "claude" | "openai"; client: any }; // Preferred: unified AI client
  dbUserId: string;
  jobTitle: string;
  company: string;
}

export async function autoApply(
  url: string,
  context: ApplyContext,
  aiOptions?: AIAgentOptions,
): Promise<ApplyResult> {
  const platform = detectPlatform(url);

  // Enforce rate limiting between applications (skip for unknown — generic handler)
  if (platform !== "unknown") {
    await enforceRateLimit(platform);
  }

  // ── Direct API attempt for supported platforms ──
  // Try API submission first (no browser needed) — bypasses CAPTCHAs and bot detection.
  // NOTE: Greenhouse Job Board API requires HTTP Basic Auth (company API key) for POST.
  // We don't have these keys, so Greenhouse always goes through browser/AI agent.
  // The GET endpoints (schema fetch) are public and used by the AI agent for context.

  // Resolve the AI client once — prefer aiClient, fall back to wrapping openai
  const resolvedAIClient = aiOptions?.aiClient || (aiOptions?.openai ? { provider: "openai" as const, client: aiOptions.openai } : null);
  const hasAI = !!resolvedAIClient;

  if (platform === "lever") {
    try {
      const { applyLeverViaAPI } = await import("./api/lever");
      console.log(`[AutoApply] Attempting Lever direct API submission for ${url}`);
      const apiResult = await applyLeverViaAPI(
        url,
        { firstName: context.firstName, lastName: context.lastName, email: context.email, phone: context.phone, linkedIn: context.linkedIn, location: context.location, currentTitle: context.currentTitle, resumeFilePath: context.resumeFilePath, resumeText: context.resumeText, coverLetterText: context.coverLetterText },
        resolvedAIClient,
        aiOptions?.jobTitle || context.jobTitle,
        aiOptions?.company || context.company,
      );
      if (apiResult.success) {
        console.log(`[AutoApply] Lever API succeeded — skipping browser`);
        return {
          success: true,
          platform: "lever",
          message: apiResult.message,
          stepsCompleted: apiResult.stepsCompleted,
          confirmationDetected: true,
          confirmationText: "Submitted via Lever API",
        };
      }
      console.log(`[AutoApply] Lever API failed (${apiResult.message?.slice(0, 80)}), falling back to browser`);
    } catch (apiErr) {
      console.log(`[AutoApply] Lever API error: ${(apiErr as Error).message?.slice(0, 80)}, falling back to browser`);
    }
  }

  const browser = await getPlaywrightBrowser(url);
  if (!browser) {
    return {
      success: false,
      platform,
      message: "Playwright browser not available. Install playwright-core and a browser binary.",
    };
  }

  let browserContext: any = null;
  let page: any = null;

  try {
    browserContext = await browser.newContext({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 900 },
    });

    // Inject LinkedIn session cookies if this is a LinkedIn job page
    if (url.includes("linkedin.com") && context.clerkId) {
      try {
        const { clerkClient } = await import("@clerk/nextjs/server");
        const tokens = await clerkClient.users.getUserOauthAccessToken(context.clerkId, "oauth_linkedin_oidc");
        const accessToken = tokens.data?.[0]?.token;
        if (accessToken) {
          // Set LinkedIn OAuth token as li_at cookie (LinkedIn session cookie)
          await browserContext.addCookies([
            {
              name: "li_at",
              value: accessToken,
              domain: ".linkedin.com",
              path: "/",
              httpOnly: true,
              secure: true,
              sameSite: "None",
            },
          ]);
          console.log("[AutoApply] Injected LinkedIn OAuth session from Clerk");
        } else {
          console.log("[AutoApply] No LinkedIn OAuth token available from Clerk");
        }
      } catch (linkedInErr) {
        console.error("[AutoApply] Failed to inject LinkedIn session:", linkedInErr);
      }
    }

    page = await browserContext.newPage();
    // For Lever jobs: capture hCaptcha rqdata during page load (must be before goto)
    if (platform === "lever") {
      const { installHCaptchaCapture } = await import("./captcha/solver");
      installHCaptchaCapture(page);
    }
    // Use networkidle for SPAs (Airbnb, Instacart, etc.) with longer timeout
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    } catch {
      // Fallback to domcontentloaded if networkidle times out
      try { await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 }); } catch { /* page may still be usable */ }
    }
    await humanDelay(page, 2000, 4000); // Human-like initial page load wait

    // SPA-heavy platforms need extra time to render
    const isWorkdayUrl = url.includes("myworkdayjobs.com") || url.includes("workday.com");
    const isWorkableUrl = url.includes("workable.com") || url.includes("apply.workable.com");
    const isSmartRecruitersUrl = url.includes("smartrecruiters.com");
    const isJobviteUrl = url.includes("jobvite.com");
    const isICIMSUrl = url.includes("icims.com");
    const isSPAUrl = isWorkdayUrl || isWorkableUrl || isSmartRecruitersUrl || isJobviteUrl || isICIMSUrl;

    if (isSPAUrl) {
      console.log(`[AutoApply] SPA platform detected — waiting for content to render...`);
      // Platform-specific selectors that indicate the real content (not just a spinner)
      let spaSelector = "form, input, button, [role='main'], .job-description, .application-form, h1, h2";
      if (isWorkdayUrl) {
        spaSelector = "[data-automation-id='jobPostingPage'], [data-automation-id='applyButton'], [data-automation-id='navigationTitle'], [data-automation-id='formField'], form input, .css-1q2dra3";
      } else if (isWorkableUrl) {
        spaSelector = "[data-ui='application-form'], form.application-form, .styles__form, [data-ui='job-description'], input[name='firstname'], .workable-application";
      } else if (isSmartRecruitersUrl) {
        spaSelector = ".openings-content, .job-sections, .application-fieldset, form input, [data-test='jobad-content'], h1.job-title";
      } else if (isJobviteUrl) {
        spaSelector = ".jv-page-content, .jv-application, form.jv-apply-form, .jv-job-detail, input[name='firstName'], .jv-header";
      } else if (isICIMSUrl) {
        spaSelector = "iframe[src*='icims'], .iCIMS_MainWrapper, .iCIMS_JobContent, form, a.iCIMS_ApplyButton";
      }
      try {
        await page.waitForSelector(spaSelector, { timeout: 20000 });
        console.log(`[AutoApply] SPA content detected`);
      } catch {
        // If no content after 20s, try reload
        console.log("[AutoApply] SPA content not found — reloading...");
        try { await page.reload({ waitUntil: "networkidle", timeout: 30000 }); } catch { /* */ }
        // Wait with platform-specific selector again after reload
        try {
          await page.waitForSelector(spaSelector, { timeout: 15000 });
        } catch {
          console.log("[AutoApply] SPA content still not found after reload — proceeding anyway");
        }
      }
    }

    if (isWorkdayUrl) {
      // Workday needs extra time — its React app loads in multiple phases
      await page.waitForTimeout(5000);
      // Wait specifically for Workday's form elements
      try {
        await page.waitForSelector("[data-automation-id], input, button", { timeout: 15000 });
      } catch { /* proceed — AI agent will handle the rest */ }
      const bodyText = await page.textContent("body").catch(() => "") || "";
      if (bodyText.includes("doesn't exist") || bodyText.includes("does not exist") || bodyText.length < 200) {
        console.log("[AutoApply] Workday page may not have loaded — retrying...");
        try { await page.reload({ waitUntil: "networkidle", timeout: 30000 }); } catch { /* */ }
        await page.waitForTimeout(8000);
        try { await page.waitForSelector("[data-automation-id], input", { timeout: 10000 }); } catch { /* */ }
      }
    }

    if (isJobviteUrl) {
      // Jobvite renders templates client-side — wait for Angular/React to hydrate
      await page.waitForTimeout(5000);
      // Check for unrendered template variables ({{ }}) — indicates app hasn't hydrated
      const bodyText = await page.textContent("body").catch(() => "") || "";
      if (bodyText.includes("{{") && bodyText.includes("}}")) {
        console.log("[AutoApply] Jobvite templates not rendered — waiting for hydration...");
        await page.waitForTimeout(8000);
        // If still not rendered after wait, reload
        const bodyText2 = await page.textContent("body").catch(() => "") || "";
        if (bodyText2.includes("{{") && bodyText2.includes("}}")) {
          console.log("[AutoApply] Jobvite still showing templates — reloading...");
          try { await page.reload({ waitUntil: "networkidle", timeout: 30000 }); } catch { /* */ }
          await page.waitForTimeout(8000);
        }
      }
    }

    let result: ApplyResult;

    // ── Greenhouse Hybrid: fast deterministic form fill before AI agent ──
    // Navigates directly to boards.greenhouse.io embed (same-origin, no iframe issues),
    // fills all fields in one shot via DOM, uploads resume, clicks submit.
    // Falls back to AI agent if hybrid fails or security code verification is needed.
    if (platform === "greenhouse" && hasAI) {
      // Set up S3 route interception for resume uploads (Greenhouse uploads files to S3)
      if (context.resumeFilePath) {
        try {
          const { setupS3RouteInterception } = await import("./agent/preprocessing");
          await setupS3RouteInterception(page, context.resumeFilePath);
        } catch { /* S3 interception is optional — upload may still work */ }
      }
      try {
        const { parseGreenhouseUrl, applyGreenhouseHybrid, discoverBoardToken } = await import("./api/greenhouse");
        const parsed = parseGreenhouseUrl(url);
        if (parsed) {
          // For gh_jid URLs, the board token is inferred and might be wrong — verify via API
          if (/[?&]gh_jid=/i.test(url)) {
            const discovered = await discoverBoardToken(parsed.jobId, parsed.boardToken);
            if (discovered && discovered !== parsed.boardToken) {
              console.log(`[AutoApply] Board token corrected: ${parsed.boardToken} → ${discovered}`);
              parsed.boardToken = discovered;
            }
          }
          console.log(`[AutoApply] Trying Greenhouse HYBRID for ${parsed.boardToken}/${parsed.jobId}`);
          const hybridResult = await applyGreenhouseHybrid(
            page, parsed.boardToken, parsed.jobId,
            { firstName: context.firstName, lastName: context.lastName, email: context.email, phone: context.phone, linkedIn: context.linkedIn, location: context.location, currentTitle: context.currentTitle, resumeFilePath: context.resumeFilePath, resumeText: context.resumeText, coverLetterText: context.coverLetterText, needsSponsorship: context.needsSponsorship },
            resolvedAIClient,
            aiOptions?.jobTitle || context.jobTitle,
            aiOptions?.company || context.company,
          );
          if (hybridResult.success) {
            console.log(`[AutoApply] Greenhouse hybrid succeeded!`);
            return {
              success: true,
              platform: "greenhouse",
              message: hybridResult.message,
              stepsCompleted: hybridResult.stepsCompleted,
              screenshotBase64: hybridResult.screenshotBeforeSubmit,
              confirmationDetected: true,
              confirmationText: "Submitted via Greenhouse hybrid (browser + deterministic fill)",
            };
          }
          // If security code is needed, fall through to AI agent which can handle it
          if (hybridResult.message?.includes("security code")) {
            console.log(`[AutoApply] Greenhouse hybrid needs security code — falling through to AI agent`);
            // Page is already on the security code page, AI agent will pick up from here
          } else {
            console.log(`[AutoApply] Greenhouse hybrid failed: ${hybridResult.message?.slice(0, 80)}`);
            // For other failures, still try AI agent
          }
        }
      } catch (hybridErr) {
        console.log(`[AutoApply] Greenhouse hybrid error: ${(hybridErr as Error).message?.slice(0, 80)}, falling back to AI agent`);
      }
    }

    // ── Recruitee API-first: submit directly without browser ──
    if (platform === "recruitee") {
      try {
        const { parseRecruiteeUrl, fetchRecruiteeSchema, answerRecruiteeQuestions, applyViaRecruiteeAPI } = await import("./api/recruitee");
        const parsed = parseRecruiteeUrl(url);
        if (parsed) {
          console.log(`[AutoApply] Trying Recruitee API for ${parsed.company}/${parsed.slug}`);
          const schema = await fetchRecruiteeSchema(parsed.company, parsed.slug);
          const aiAnswers = resolvedAIClient && schema.customQuestions.length > 0
            ? await answerRecruiteeQuestions(resolvedAIClient, schema.customQuestions, { firstName: context.firstName, lastName: context.lastName, email: context.email, phone: context.phone, linkedIn: context.linkedIn, location: context.location, currentTitle: context.currentTitle, resumeText: context.resumeText, coverLetterText: context.coverLetterText, needsSponsorship: context.needsSponsorship, yearsExp: context.yearsExp }, schema.jobTitle, schema.companyName)
            : new Map<string, string>();
          const apiResult = await applyViaRecruiteeAPI(parsed.company, parsed.slug, { firstName: context.firstName, lastName: context.lastName, email: context.email, phone: context.phone, coverLetterText: context.coverLetterText, resumeFilePath: context.resumeFilePath }, aiAnswers, schema.jobTitle);
          if (apiResult.success) {
            return { success: true, platform: "recruitee", message: apiResult.message, confirmationDetected: true, confirmationText: `Application submitted to ${schema.companyName}` };
          }
          console.log(`[AutoApply] Recruitee API failed: ${apiResult.message} — falling back to AI agent`);
        }
      } catch (recruiteeErr) {
        console.log(`[AutoApply] Recruitee API error: ${(recruiteeErr as Error).message?.slice(0, 80)} — falling back to AI agent`);
      }
    }

    // If AI agent is available, use it for ALL platforms — it's adaptive and handles
    // verification codes, multi-page forms, and unexpected UI elements
    if (hasAI && resolvedAIClient) {
      console.log(`[AutoApply] Using AI AGENT (${resolvedAIClient.provider}) for ${url}`);
      try {
        const { runAIAgent } = await import("./ai-agent");
        const agentResult = await runAIAgent(
          resolvedAIClient,
          page,
          {
            ...context,
            dbUserId: aiOptions?.dbUserId,
          },
          url,
          aiOptions?.jobTitle || "",
          aiOptions?.company || "",
          browserContext,
        );
        result = {
          success: agentResult.success,
          platform: agentResult.platform,
          message: agentResult.message,
          stepsCompleted: agentResult.stepsCompleted,
          screenshotSteps: agentResult.screenshotSteps,
          confirmationDetected: agentResult.confirmationDetected,
          confirmationText: agentResult.confirmationText,
        };
      } catch (agentErr) {
        console.error("[AutoApply] AI agent failed:", agentErr);
        // Do NOT silently fall back to hardcoded handlers — they can't handle
        // security codes, CAPTCHAs, or multi-step flows and may falsely report success.
        result = {
          success: false,
          platform: "ai-agent",
          message: `AI agent error: ${(agentErr as Error).message}. Please try again.`,
          stepsCompleted: [],
          screenshotSteps: [],
          confirmationDetected: false,
        };
      }
    } else {
      // No AI — use hardcoded platform-specific handlers
      console.log(`[AutoApply] Using HARDCODED handler for ${platform} (no AI agent)`);
      result = await runHardcodedHandler(platform, page, context, browserContext);
    }

    console.log(`[AutoApply] Result: success=${result.success}, platform=${result.platform}, confirmation=${result.confirmationDetected}, msg=${result.message?.slice(0, 100)}`);
    return result;
  } catch (err) {
    return {
      success: false,
      platform,
      message: `Auto-apply failed: ${(err as Error).message}`,
    };
  } finally {
    try { if (page) await page.close(); } catch { /* */ }
    try { if (browserContext) await browserContext.close(); } catch { /* */ }
    try { await browser.close(); } catch { /* */ }
  }
}

// Hardcoded platform-specific handlers (fallback when AI agent is not available)
async function runHardcodedHandler(platform: string, page: any, context: ApplyContext, browserContext: any): Promise<ApplyResult> {
  switch (platform) {
    case "greenhouse":
      return await applyGreenhouse(page, context);
    case "lever":
      return await applyLever(page, context);
    case "linkedin":
      return await applyLinkedIn(page, context, browserContext);
    case "workable":
      return await applyWorkable(page, context);
    case "ashby":
      return await applyAshby(page, context);
    case "smartrecruiters":
      return await applySmartRecruiters(page, context);
    case "icims":
      return await applyICIMS(page, context);
    case "taleo":
      return await applyTaleo(page, context);
    case "bamboohr":
    case "jazzhr":
    case "breezyhr":
    case "recruitee":
    case "jobvite":
    case "successfactors":
    case "pinpoint":
    case "rippling":
      return await applyGeneric(page, context);
    default:
      return await applyGeneric(page, context);
  }
}

// ── Batch Auto-Apply ──
// Apply to multiple jobs in sequence with rate limiting between each
export interface BatchApplyResult {
  total: number;
  succeeded: number;
  failed: number;
  results: { jobId: string; company: string; role: string; result: ApplyResult }[];
}

export async function batchAutoApply(
  jobs: { id: string; url: string; company: string; role: string }[],
  context: ApplyContext,
  onProgress?: (completed: number, total: number, current: string) => void,
): Promise<BatchApplyResult> {
  const results: BatchApplyResult["results"] = [];
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    onProgress?.(i, jobs.length, `${job.role} at ${job.company}`);

    // Use the user's ORIGINAL email on the application form
    // Job sites must not know this is an automated application
    const jobContext = { ...context };

    const result = await autoApply(job.url, jobContext);
    results.push({ jobId: job.id, company: job.company, role: job.role, result });

    if (result.success) succeeded++;
    else failed++;

    // Extra delay between batch applications (on top of per-platform rate limit)
    if (i < jobs.length - 1) {
      const batchDelay = 3000 + Math.floor(Math.random() * 5000); // 3-8s between jobs
      await new Promise((r) => setTimeout(r, batchDelay));
    }
  }

  onProgress?.(jobs.length, jobs.length, "Batch complete");

  return { total: jobs.length, succeeded, failed, results };
}

export { detectPlatform, generateProxyEmail, type ApplyContext, type ApplyResult };
