// AI Agent Pre-processing
// Generic pre-processing steps that run before the AI loop.
// NO platform-specific hardcoded logic — handles common patterns dynamically.

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { AgentContext } from "./types";

// Dismiss cookie consent banners
async function dismissCookieBanners(page: any, steps: string[]): Promise<void> {
  try {
    const cookieSelectors = [
      '#onetrust-accept-btn-handler',
      'button[id*="onetrust-accept"]',
      '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
      'button[data-cookiefirst-action="accept"]',
      'button.cookie-consent-accept',
      'button[aria-label="Accept cookies"]',
      'button[aria-label="Accept all cookies"]',
      'button:has-text("Accept All")',
      'button:has-text("Accept all cookies")',
      'button:has-text("I Accept")',
      'button:has-text("Allow All")',
      'button:has-text("Allow all")',
      'button[title="Accept"]',
      'button[title="Accept All"]',
    ];
    for (const cs of cookieSelectors) {
      try {
        const btn = await page.$(cs);
        if (btn && await btn.isVisible().catch(() => false)) {
          await btn.click({ timeout: 3000 });
          await page.waitForTimeout(1000);
          steps.push("Pre-processing: Dismissed cookie consent banner");
          console.log(`[AI-Agent] Pre-processing: Dismissed cookie banner via ${cs}`);
          break;
        }
      } catch { /* */ }
    }
  } catch { /* */ }
}

// Known ATS domains — if the current URL contains one of these, we're on the actual application page
const ATS_DOMAINS = [
  "myworkdayjobs.com", "workday.com", "greenhouse.io", "boards.greenhouse.io",
  "lever.co", "jobs.lever.co", "icims.com", "taleo.net",
  "successfactors.com", "smartrecruiters.com", "jobvite.com",
  "ashbyhq.com", "bamboohr.com", "ultipro.com", "paylocity.com",
  "recruitee.com", "breezy.hr", "jazz.co", "applytojob.com",
  "workable.com", "apply.workable.com",
];

// Known aggregator domains — these are NOT application pages
const AGGREGATOR_DOMAINS = [
  "remoterocketship.com", "indeed.com", "glassdoor.com", "ziprecruiter.com",
  "linkedin.com", "monster.com", "careerbuilder.com", "simplyhired.com",
  "dice.com", "builtin.com", "wellfound.com", "angel.co",
  "recruit.net", "jooble.org", "adzuna.com", "remotive.com",
  "weworkremotely.com", "flexjobs.com", "remoteok.com",
];

function isAggregatorPage(url: string): boolean {
  const lower = url.toLowerCase();
  return AGGREGATOR_DOMAINS.some(d => lower.includes(d));
}

function isATSPage(url: string): boolean {
  const lower = url.toLowerCase();
  return ATS_DOMAINS.some(d => lower.includes(d));
}

// Detect aggregator page and navigate to the actual application URL
async function navigateFromAggregator(
  page: any,
  steps: string[],
  browserContext: any,
  rootPage: any,
): Promise<any> {
  const currentUrl = page.url();
  if (!isAggregatorPage(currentUrl)) return page;
  if (isATSPage(currentUrl)) return page; // Already on ATS

  console.log(`[AI-Agent] Pre-processing: Detected aggregator page: ${currentUrl.slice(0, 80)}`);

  // Strategy 1: Find links to known ATS domains
  try {
    const atsLink: string | null = await page.evaluate(`(() => {
      var atsDomains = ${JSON.stringify(ATS_DOMAINS)};
      var links = document.querySelectorAll('a[href]');
      for (var i = 0; i < links.length; i++) {
        var href = links[i].getAttribute('href') || '';
        for (var j = 0; j < atsDomains.length; j++) {
          if (href.toLowerCase().includes(atsDomains[j])) return href;
        }
      }
      return null;
    })()`);

    if (atsLink) {
      const fullUrl = atsLink.startsWith("http") ? atsLink : new URL(atsLink, currentUrl).toString();
      console.log(`[AI-Agent] Pre-processing: Found ATS link: ${fullUrl.slice(0, 120)}`);
      try {
        await page.goto(fullUrl, { waitUntil: "networkidle", timeout: 20000 });
      } catch {
        try { await page.goto(fullUrl, { waitUntil: "domcontentloaded", timeout: 15000 }); } catch { /* */ }
      }
      await page.waitForTimeout(3000);
      steps.push(`Pre-processing: Navigated from aggregator to ATS: ${fullUrl.slice(0, 100)}`);
      console.log(`[AI-Agent] Pre-processing: Navigated to ATS page`);
      return page;
    }
  } catch { /* */ }

  // Strategy 2: Click "Apply" / "Apply Now" button/link on the aggregator
  try {
    const applySelectors = [
      'a:has-text("Apply Now")', 'a:has-text("Apply on company site")',
      'a:has-text("Apply")', 'button:has-text("Apply Now")',
      'button:has-text("Apply")', 'a:has-text("Apply for this job")',
      'a:has-text("Apply on employer site")', 'a:has-text("External Apply")',
    ];
    for (const sel of applySelectors) {
      try {
        const btn = await page.$(sel);
        if (!btn) continue;
        if (!await btn.isVisible().catch(() => false)) continue;

        const href = await btn.getAttribute("href");
        if (href && href.startsWith("http")) {
          // Direct navigation is more reliable than clicking
          console.log(`[AI-Agent] Pre-processing: Navigating to apply link: ${href.slice(0, 120)}`);
          try {
            await page.goto(href, { waitUntil: "networkidle", timeout: 20000 });
          } catch {
            try { await page.goto(href, { waitUntil: "domcontentloaded", timeout: 15000 }); } catch { /* */ }
          }
          await page.waitForTimeout(3000);
          steps.push(`Pre-processing: Navigated from aggregator via Apply link`);
          return page;
        }

        // Click and check for new tab
        await btn.click({ timeout: 5000 }).catch(() => btn.click({ force: true }).catch(() => {}));
        await page.waitForTimeout(3000);

        if (browserContext) {
          const ctxPages = browserContext.pages();
          if (ctxPages.length > 1) {
            const newPage = ctxPages[ctxPages.length - 1];
            if (newPage !== rootPage) {
              try { await newPage.waitForLoadState("networkidle", { timeout: 10000 }); } catch { /* */ }
              steps.push("Pre-processing: Navigated from aggregator via new tab");
              return newPage;
            }
          }
        }

        // Check if we navigated away from the aggregator
        const newUrl = page.url();
        if (newUrl !== currentUrl) {
          steps.push(`Pre-processing: Navigated from aggregator to: ${newUrl.slice(0, 100)}`);
          return page;
        }
      } catch { /* */ }
    }
  } catch { /* */ }

  console.log("[AI-Agent] Pre-processing: Could not find ATS link on aggregator — AI agent will handle");
  return page;
}

// Try to find and click an "Apply" button if we're on a job description page
async function clickApplyButton(
  page: any,
  steps: string[],
  browserContext: any,
  rootPage: any,
): Promise<any> {
  try {
    // Count only VISIBLE, non-tracking form fields
    const realFieldCount: number = await page.evaluate(`(() => {
      var trackingNames = ['fbc','fbp','fbclid','gclid','utm_source','utm_medium','utm_campaign','utm_content','utm_term','posthogID','toltReferral','isMetaUser','_token','csrf','csrfmiddlewaretoken','authenticity_token','language','locale','referrer','source'];
      var count = 0;
      document.querySelectorAll("input:not([type='hidden']), textarea, select").forEach(function(el) {
        var rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return;
        var style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;
        var name = el.getAttribute('name') || '';
        if (name && trackingNames.indexOf(name) !== -1) return;
        count++;
      });
      return count;
    })()`);
    console.log(`[AI-Agent] Pre-processing: Visible real form fields: ${realFieldCount}`);
    if (realFieldCount >= 3) return page; // Already on a form

    // Ashby /application URLs need extra React hydration time — don't navigate away
    const currentUrl = page.url();
    if (currentUrl.includes("ashbyhq.com") && currentUrl.includes("/application")) {
      await page.waitForTimeout(4000); // wait for React to hydrate the form
      steps.push(`Pre-processing: Waiting for Ashby form to hydrate`);
      return page;
    }

    // Look for Apply button/link
    const applyBtn = await page.$('a:has-text("Apply"), button:has-text("Apply"), a:has-text("Apply Now"), button:has-text("Apply Now"), a:has-text("Apply for this"), [data-automation-id="jobPostingApplyButton"]');
    if (!applyBtn) return page;

    const href = await applyBtn.getAttribute("href");
    if (href && (href.startsWith("http") || href.startsWith("/"))) {
      const fullUrl = href.startsWith("http") ? href : new URL(href, page.url()).toString();
      try {
        await page.goto(fullUrl, { waitUntil: "networkidle", timeout: 20000 });
      } catch {
        try { await page.goto(fullUrl, { waitUntil: "domcontentloaded", timeout: 15000 }); } catch { /* */ }
      }
      await page.waitForTimeout(3000);
      steps.push(`Pre-processing: Navigated to apply URL: ${fullUrl.slice(0, 100)}`);
      console.log(`[AI-Agent] Pre-processing: Navigated to ${fullUrl.slice(0, 80)}`);
    } else {
      try { await applyBtn.scrollIntoViewIfNeeded(); } catch { /* */ }
      await applyBtn.click({ timeout: 5000 }).catch(() => applyBtn.click({ force: true }).catch(() => {}));
      await page.waitForTimeout(3000);
      steps.push("Pre-processing: Clicked Apply button");
      console.log("[AI-Agent] Pre-processing: Clicked Apply button");
    }

    // Check if a new tab was opened
    if (browserContext) {
      const ctxPages = browserContext.pages();
      if (ctxPages.length > 1) {
        const newPage = ctxPages[ctxPages.length - 1];
        if (newPage !== rootPage) {
          try { await newPage.waitForLoadState("networkidle", { timeout: 10000 }); } catch { /* */ }
          steps.push("Pre-processing: Switched to new tab");
          console.log("[AI-Agent] Pre-processing: Switched to new tab");
          return newPage;
        }
      }
    }

    // After clicking Apply, check for sign-in modal with "Apply Manually" option
    try {
      const manualBtn = page.getByText("Apply Manually", { exact: true });
      if (await manualBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await manualBtn.click({ timeout: 5000 });
        await page.waitForTimeout(3000);
        steps.push("Pre-processing: Clicked Apply Manually");
        console.log("[AI-Agent] Pre-processing: Clicked Apply Manually");
      }
    } catch { /* */ }
  } catch { /* */ }

  return page;
}

// Try to switch to an iframe containing an application form
async function switchToFormIframe(page: any, steps: string[]): Promise<any> {
  try {
    const iframeExclusions = ["googleapis.com", "recaptcha", "gstatic.com", "doubleclick", "googletagmanager", "applywithlinkedin", "myworkdaygadgets"];
    const iframes = await page.$$("iframe");
    for (const iframe of iframes) {
      const src = await iframe.getAttribute("src");
      if (!src) continue;
      if (iframeExclusions.some((ex: string) => src.toLowerCase().includes(ex))) continue;
      const frame = await iframe.contentFrame();
      if (frame) {
        await frame.waitForLoadState("domcontentloaded").catch(() => {});
        await page.waitForTimeout(1000);
        const inputs = await frame.$$("input:not([type='hidden']), textarea, select");
        if (inputs.length >= 3) {
          steps.push(`Pre-processing: Switched to iframe (${inputs.length} fields)`);
          console.log(`[AI-Agent] Pre-processing: Switched to iframe with ${inputs.length} fields`);
          return frame;
        }
        // iCIMS uses nested iframes — check one level deeper
        if (src.toLowerCase().includes("icims.com")) {
          try {
            const innerIframes = await frame.$$("iframe");
            for (const innerIframe of innerIframes) {
              const innerSrc = await innerIframe.getAttribute("src").catch(() => "");
              if (!innerSrc || iframeExclusions.some((ex: string) => (innerSrc || "").toLowerCase().includes(ex))) continue;
              const innerFrame = await innerIframe.contentFrame();
              if (innerFrame) {
                await innerFrame.waitForLoadState("domcontentloaded").catch(() => {});
                await page.waitForTimeout(1000);
                const innerInputs = await innerFrame.$$("input:not([type='hidden']), textarea, select");
                if (innerInputs.length >= 2) {
                  steps.push(`Pre-processing: Switched to nested iCIMS iframe (${innerInputs.length} fields)`);
                  console.log(`[AI-Agent] Pre-processing: Switched to nested iCIMS iframe with ${innerInputs.length} fields`);
                  return innerFrame;
                }
              }
            }
          } catch { /* */ }
          // Even if no nested iframe with inputs, the iCIMS outer frame itself may have content
          if (inputs.length >= 1) {
            steps.push(`Pre-processing: Switched to iCIMS iframe (${inputs.length} fields)`);
            console.log(`[AI-Agent] Pre-processing: Switched to iCIMS iframe with ${inputs.length} fields`);
            return frame;
          }
        }
      }
    }
  } catch { /* */ }
  return page;
}

// Pre-upload resume if file input exists
async function preUploadResume(page: any, rootPage: any, ctx: AgentContext, steps: string[]): Promise<void> {
  if (!ctx.resumeFilePath) return;
  const fs = require("fs");
  if (!fs.existsSync(ctx.resumeFilePath)) return;

  try {
    // Prefer a PDF-accepting file input (CV/resume) over a photo-only input
    const resumeInput = await page.$('input[type="file"][accept*="pdf"], input[type="file"][accept*=".pdf"], input[type="file"][accept*="doc"], input[type="file"]');
    if (!resumeInput) return;

    const isInIframe = typeof page.page === "function";
    if (isInIframe) {
      await page.evaluate(`(() => {
        var el = document.querySelector('input[type="file"]');
        if (el) { el.classList.remove('visually-hidden'); el.style.cssText='display:block;opacity:1;position:relative;width:300px;height:30px;'; }
      })()`);
      await page.waitForTimeout(300);
      try {
        const [fc] = await Promise.all([
          rootPage.waitForEvent("filechooser", { timeout: 5000 }),
          page.locator('input[type="file"]').first().click({ force: true }),
        ]);
        await fc.setFiles(ctx.resumeFilePath);
        await rootPage.waitForTimeout(8000);
        steps.push("Pre-processing: Uploaded resume via filechooser");
        console.log("[AI-Agent] Pre-processing: Resume uploaded via iframe filechooser");
      } catch (fcErr) {
        console.log(`[AI-Agent] Pre-processing: Filechooser failed: ${(fcErr as Error).message.slice(0, 80)}`);
      }
    } else {
      await resumeInput.setInputFiles(ctx.resumeFilePath);
      await page.waitForTimeout(2000);
      steps.push("Pre-processing: Uploaded resume");
      console.log("[AI-Agent] Pre-processing: Resume uploaded via setInputFiles");
    }
  } catch (uploadErr) {
    console.log(`[AI-Agent] Pre-processing: Resume upload failed: ${(uploadErr as Error).message.slice(0, 80)}`);
  }
}

// Set up S3 route interception for cross-origin iframe file uploads
export async function setupS3RouteInterception(rootPage: any, resumeFilePath: string): Promise<void> {
  const fs = require("fs");
  try {
    // Intercept S3 uploads for Greenhouse AND Ashby
    await rootPage.route(/s3[.\-].*amazonaws\.com/, async (route: any) => {
      const req = route.request();
      if (req.method() !== "POST") { await route.continue(); return; }
      try {
        const postData = req.postDataBuffer();
        const bodyStr = postData?.toString("latin1") || "";
        const boundaryMatch = bodyStr.match(/(------WebKitFormBoundary[a-zA-Z0-9]+)/);
        if (!boundaryMatch) { await route.continue(); return; }
        const boundary = boundaryMatch[1];
        const parts = bodyStr.split(boundary).filter((p: string) => p.includes("name="));
        const fields: { name: string; value: string }[] = [];
        for (const part of parts) {
          const nameMatch = part.match(/name="([^"]+)"/);
          if (!nameMatch) continue;
          const name = nameMatch[1];
          const headerEnd = part.indexOf("\r\n\r\n");
          if (headerEnd < 0) continue;
          let value = part.slice(headerEnd + 4);
          if (value.endsWith("\r\n")) value = value.slice(0, -2);
          if (value.endsWith("--\r\n")) value = value.slice(0, -4);
          if (value.endsWith("--")) value = value.slice(0, -2);
          fields.push({ name, value: name === "file" ? "" : value.trim() });
        }
        const fileBytes = fs.readFileSync(resumeFilePath);
        const newBoundary = "----WebKitFormBoundaryREUPLOAD" + Date.now();
        const bufParts: Buffer[] = [];
        for (const f of fields) {
          if (f.name === "file") {
            bufParts.push(Buffer.from(`${newBoundary}\r\nContent-Disposition: form-data; name="file"; filename="resume.pdf"\r\nContent-Type: application/pdf\r\n\r\n`));
            bufParts.push(fileBytes);
            bufParts.push(Buffer.from("\r\n"));
          } else {
            bufParts.push(Buffer.from(`${newBoundary}\r\nContent-Disposition: form-data; name="${f.name}"\r\n\r\n${f.value}\r\n`));
          }
        }
        bufParts.push(Buffer.from(`${newBoundary}--\r\n`));
        const fullBody = Buffer.concat(bufParts);
        console.log(`[AI-Agent] S3 upload intercepted: re-uploading with ${fileBytes.length} byte file`);
        const res = await fetch(req.url(), {
          method: "POST",
          headers: { "content-type": `multipart/form-data; boundary=${newBoundary.slice(2)}` },
          body: fullBody,
        });
        const resBody = await res.text();
        console.log(`[AI-Agent] S3 upload result: ${res.status}`);
        await route.fulfill({
          status: res.status,
          headers: Object.fromEntries(res.headers.entries()),
          body: resBody,
        });
      } catch (e) {
        console.log(`[AI-Agent] S3 route error: ${(e as Error).message}`);
        await route.abort();
      }
    });
    console.log("[AI-Agent] S3 upload route interception enabled");
  } catch { /* route setup may fail if page doesn't support it */ }
}

// Auto-set Recruitee phone country downshift combobox to United States
async function fillRecruiteePhoneCountry(page: any, steps: string[]): Promise<void> {
  const url = page.url();
  if (!url.includes("recruitee.com")) return;
  try {
    // Wait extra time for React to render the form after Apply click
    await page.waitForTimeout(2000);

    // Downshift toggle button — standard Recruitee pattern uses #downshift-N-toggle-button
    // Try multiple selectors for the country combobox toggle
    const toggleSelectors = [
      '#downshift-0-toggle-button',
      'button[aria-haspopup="listbox"]',
      '[id*="country-select"]',
      'button[id*="country"]',
    ];
    let toggleBtn: any = null;
    for (const sel of toggleSelectors) {
      try {
        const el = await page.$(sel);
        if (el && await el.isVisible().catch(() => false)) { toggleBtn = el; break; }
      } catch { /* */ }
    }
    if (!toggleBtn) return;

    // Click to open the dropdown
    await toggleBtn.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(600);

    // Type "United States" in the filter input
    const inputSels = ['#downshift-0-input', '[id*="country-select"]', 'input[role="combobox"]'];
    for (const sel of inputSels) {
      try {
        const inp = await page.$(sel);
        if (inp && await inp.isVisible().catch(() => false)) {
          await inp.fill("United States").catch(() => {});
          await page.waitForTimeout(700);
          break;
        }
      } catch { /* */ }
    }

    // Click the matching option
    const option = await page.$('[role="option"]:has-text("United States"), li:has-text("United States (+1)"), [id*="downshift"] li:has-text("United States")');
    if (option) {
      await option.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(500);
      steps.push("Pre-processing: Set Recruitee phone country to United States");
      console.log("[AI-Agent] Pre-processing: Recruitee phone country set to US");
    }
  } catch { /* */ }
}

// Auto-fill Breezy HR EEO/CCPA section via JavaScript (avoids guessing selectors)
async function fillBreezyEEO(page: any, steps: string[]): Promise<void> {
  const url = page.url();
  if (!url.includes("breezy.hr")) return;
  try {
    const filled: string[] = await page.evaluate(`(function() {
      var eeoFields = ['race', 'gender', 'disability', 'veteran', 'ethnicity', 'veteranstatus', 'eeoRace', 'eeo_race', 'race_ethnicity', 'raceEthnicity', 'eeoGender', 'eeo_gender', 'disabilityStatus', 'disability_status', 'veteranStatus', 'veteran_status'];
      var filled = [];
      eeoFields.forEach(function(field) {
        // Try radio buttons first
        var radios = Array.from(document.querySelectorAll('input[type="radio"][name="' + field + '"]'));
        if (radios.length > 0) {
          // Prefer a "decline" option, else pick the last option
          var target = radios.find(function(r) {
            var v = (r.value || '').toLowerCase();
            return v.includes('decline') || v.includes('not_specified') || v.includes('prefer') || v === '0' || v === '';
          }) || radios[radios.length - 1];
          if (target) {
            target.checked = true;
            target.click();
            target.dispatchEvent(new Event('change', { bubbles: true }));
            filled.push('radio:' + field + '=' + target.value);
          }
          return;
        }
        // Try select element
        var sel = document.querySelector('select[name="' + field + '"]');
        if (sel) {
          var opts = Array.from(sel.options);
          var declineOpt = opts.find(function(o) {
            var v = (o.value || o.text || '').toLowerCase();
            return v.includes('decline') || v.includes('not_specified') || v.includes('prefer');
          }) || opts[opts.length - 1];
          if (declineOpt) {
            sel.value = declineOpt.value;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            filled.push('select:' + field + '=' + declineOpt.value);
          }
        }
      });
      // Also search by label text for EEO sections (handles custom name patterns like section_*_question_*)
      var allRadioGroups = {};
      Array.from(document.querySelectorAll('input[type="radio"]')).forEach(function(r) {
        var n = r.name || '';
        var label = document.querySelector('label[for="' + r.id + '"]');
        var labelText = (label ? label.textContent : '').toLowerCase();
        var isEEO = ['race', 'ethnicity', 'gender', 'disability', 'veteran'].some(function(k) { return n.toLowerCase().includes(k) || labelText.includes(k); });
        if (isEEO && !allRadioGroups[n]) { allRadioGroups[n] = []; }
        if (isEEO) allRadioGroups[n].push(r);
      });
      Object.values(allRadioGroups).forEach(function(radios) {
        var target = radios.find(function(r) {
          var v = (r.value || '').toLowerCase();
          return v.includes('decline') || v.includes('not_specified') || v.includes('prefer') || v.includes('unspecified') || v === '0' || v === '';
        }) || radios[radios.length - 1];
        if (target && !target.checked) {
          target.checked = true;
          target.click();
          target.dispatchEvent(new Event('change', { bubbles: true }));
          filled.push('label-eeo:' + target.name + '=' + target.value);
        }
      });
      // CCPA / Privacy consent checkboxes — try name-based first, then text-proximity
      var ccpaSelectors = ['input[name="ccpa_consent"]','input[name="ccpa"]','input[name="privacyNotice"]','input[name="ccpa_notice"]','input[name="privacy_policy"]','input[name="gdpr_consent"]','input[name="data_consent"]'];
      var ccpa = null;
      for (var ci = 0; ci < ccpaSelectors.length; ci++) {
        ccpa = document.querySelector(ccpaSelectors[ci]);
        if (ccpa) break;
      }
      if (!ccpa) {
        // Fallback: find any required checkbox near CCPA/privacy/consent text
        Array.from(document.querySelectorAll('input[type="checkbox"]')).forEach(function(cb) {
          if (ccpa) return;
          var label = document.querySelector('label[for="' + cb.id + '"]');
          var container = cb.parentElement;
          var text = ((label ? label.textContent : '') + (container ? container.textContent : '')).toLowerCase();
          if (text.includes('ccpa') || text.includes('privacy') || text.includes('consent') || text.includes('processing')) {
            ccpa = cb;
          }
        });
      }
      if (ccpa && !ccpa.checked) {
        ccpa.checked = true;
        ccpa.click();
        ccpa.dispatchEvent(new Event('change', { bubbles: true }));
        filled.push('ccpa');
      }
      return filled;
    })()`);
    if (filled && filled.length > 0) {
      await page.waitForTimeout(500);
      steps.push(`Pre-processing: Auto-filled Breezy EEO fields: ${filled.join(', ')}`);
      console.log(`[AI-Agent] Pre-processing: Breezy EEO auto-fill: ${filled.join(', ')}`);
    }
  } catch { /* */ }
}

// Detect and skip Jobvite broken consent/template pages
async function handleJobviteBrokenPages(page: any, steps: string[]): Promise<void> {
  const url = page.url();
  if (!url.includes("jobvite.com")) return;
  try {
    const bodyText = await page.textContent("body").catch(() => "") || "";
    // Detect broken template variables like {{acceptUrl}}, {{policy.name}}
    if (/\{\{[a-zA-Z_.]+\}\}/.test(bodyText)) {
      console.log(`[AI-Agent] Pre-processing: Jobvite broken template detected — attempting to skip consent page`);
      // Try clicking any visible accept/continue/agree button despite broken template
      const consentSelectors = [
        'button:has-text("Accept")', 'button:has-text("Agree")',
        'button:has-text("Continue")', 'a:has-text("Accept")',
        'input[type="submit"]', 'button[type="submit"]',
        'a:has-text("Continue")', 'button:has-text("I Agree")',
      ];
      for (const sel of consentSelectors) {
        try {
          const btn = await page.$(sel);
          if (btn && await btn.isVisible().catch(() => false)) {
            await btn.click({ timeout: 3000 });
            await page.waitForTimeout(2000);
            steps.push(`Pre-processing: Clicked consent button on broken Jobvite page`);
            console.log(`[AI-Agent] Pre-processing: Clicked Jobvite consent: ${sel}`);
            return;
          }
        } catch { /* */ }
      }
      console.log(`[AI-Agent] Pre-processing: No consent button found — Jobvite template is broken`);
      steps.push("Pre-processing: Jobvite consent page has broken template — cannot proceed");
    }
  } catch { /* */ }
}

// Main pre-processing pipeline
export async function runPreprocessing(
  page: any,
  rootPage: any,
  ctx: AgentContext,
  steps: string[],
  screenshots: { step: string; screenshot: string }[],
  browserContext?: any,
): Promise<{ page: any }> {
  let currentPage = page;

  // Set up S3 route interception for file uploads
  if (ctx.resumeFilePath) {
    await setupS3RouteInterception(rootPage, ctx.resumeFilePath);
  }

  // 1. Dismiss cookie banners
  await dismissCookieBanners(currentPage, steps);

  // 2. Detect aggregator page and navigate to actual application
  currentPage = await navigateFromAggregator(currentPage, steps, browserContext, rootPage);

  // 3. Click Apply button if on a job description page
  currentPage = await clickApplyButton(currentPage, steps, browserContext, rootPage);

  // 4. Switch to form iframe if present
  currentPage = await switchToFormIframe(currentPage, steps);

  // 5. Handle Jobvite broken consent/template pages
  await handleJobviteBrokenPages(currentPage, steps);

  // 6. Pre-upload resume if file input exists
  await preUploadResume(currentPage, rootPage, ctx, steps);

  // 7. Auto-fill EEO/CCPA fields for Breezy HR (avoids wasting 30+ iterations on unknown selectors)
  await fillBreezyEEO(currentPage, steps);

  // 8. Auto-set phone country for Recruitee (downshift combobox)
  await fillRecruiteePhoneCountry(currentPage, steps);

  return { page: currentPage };
}
