// AI Agent Page State Helpers
// Functions to capture and analyze the current state of the browser page.

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { PageState } from "./types";

// Safe screenshot that works for both Page and Frame objects
// Track consecutive screenshot failures to avoid wasting time on headed browsers
let screenshotFailCount = 0;

export async function safeScreenshot(pageOrFrame: any): Promise<string> {
  // If screenshots have failed 3+ times in a row, skip entirely (headed browser issue)
  if (screenshotFailCount >= 3) return "";

  // Progressive timeout: start fast, slow down after failures (5s → 8s → 12s)
  const timeout = [5000, 8000, 12000][Math.min(screenshotFailCount, 2)];

  // Try screenshot on the given page/frame
  try {
    const buf = await pageOrFrame.screenshot({ type: "png", fullPage: false, timeout });
    if (buf && buf.length > 100) { screenshotFailCount = 0; return buf.toString("base64"); }
  } catch (e) {
    const errMsg = (e as Error).message || "";
    // "Execution context was destroyed" means page is navigating — wait briefly and retry once
    if (screenshotFailCount < 2 && /execution context|navigating|target closed/i.test(errMsg)) {
      try {
        await new Promise(r => setTimeout(r, 1500));
        const buf = await pageOrFrame.screenshot({ type: "png", fullPage: false, timeout: 5000 });
        if (buf && buf.length > 100) { screenshotFailCount = 0; return buf.toString("base64"); }
      } catch { /* fall through to parent page attempt */ }
    }
    screenshotFailCount++;
    if (screenshotFailCount <= 2) console.log(`[AI-Agent] Screenshot failed (${screenshotFailCount}/3): ${errMsg.slice(0, 60)}`);
    else if (screenshotFailCount === 3) console.log(`[AI-Agent] Screenshots disabled — 3 consecutive failures (headed browser). Agent will use HTML only.`);
  }
  // Try parent page if target is a frame
  if (screenshotFailCount < 3) {
    try {
      const parentPage = typeof pageOrFrame.page === "function" ? pageOrFrame.page() : null;
      if (parentPage) {
        const buf = await parentPage.screenshot({ type: "png", fullPage: false, timeout: 5000 });
        if (buf && buf.length > 100) { screenshotFailCount = 0; return buf.toString("base64"); }
      }
    } catch { /* */ }
  }
  return "";
}

export function resetScreenshotFailCount(): void { screenshotFailCount = 0; }

// Get keyboard from Page or Frame
export function safeKeyboard(pageOrFrame: any): any {
  if (pageOrFrame.keyboard) return pageOrFrame.keyboard;
  if (typeof pageOrFrame.page === "function") return pageOrFrame.page().keyboard;
  return null;
}

// Check if a frame reference has been detached (stale)
export async function isFrameDetached(pageOrFrame: any): Promise<boolean> {
  try {
    // Frames have a .page() method; detached frames throw on evaluate
    if (typeof pageOrFrame.page === "function") {
      await pageOrFrame.evaluate("1");
      return false;
    }
    return false; // It's a Page, not a Frame — cannot be detached
  } catch {
    return true;
  }
}

// Capture the current page state: URL, title, screenshot, simplified HTML, visible text
export async function getPageState(page: any, rootPage?: any): Promise<PageState> {
  // If the current page reference is a detached frame, fall back to rootPage
  let activePage = page;
  if (rootPage && await isFrameDetached(page)) {
    console.log("[AI-Agent] Frame detached — falling back to root page for state capture");
    activePage = rootPage;
  }
  const url = activePage.url();
  const title = await activePage.title().catch(() => "");
  const screenshot = await safeScreenshot(rootPage || activePage);

  // Get simplified HTML — only interactive elements and their labels
  // NOTE: Using string-based evaluate to avoid tsx/esbuild __name injection issue
  const simplifiedHtml: string = await activePage.evaluate(`(() => {
    var elements = [];
    var seen = new Set();
    var getLabel = function(el) {
      var id = el.getAttribute("id");
      if (id) { var label = document.querySelector('label[for="' + id + '"]'); if (label) return label.textContent?.trim() || ""; }
      var parentLabel = el.closest("label");
      if (parentLabel) return parentLabel.textContent?.trim().slice(0, 80) || "";
      var ariaLabel = el.getAttribute("aria-label");
      if (ariaLabel) return ariaLabel;
      var placeholder = el.getAttribute("placeholder");
      if (placeholder) return "[placeholder: " + placeholder + "]";
      var parent = el.parentElement;
      if (parent) { var prevSibling = el.previousElementSibling; if (prevSibling && prevSibling.tagName === "LABEL") return prevSibling.textContent?.trim() || ""; }
      return "";
    };
    var getSelector = function(el) {
      if (el.id) return "#" + el.id;
      var name = el.getAttribute("name");
      if (name) return el.tagName.toLowerCase() + '[name="' + name + '"]';
      var type = el.getAttribute("type");
      var placeholder = el.getAttribute("placeholder");
      if (type && placeholder) return el.tagName.toLowerCase() + '[type="' + type + '"][placeholder="' + placeholder + '"]';
      if (type) return el.tagName.toLowerCase() + '[type="' + type + '"]';
      var dataAutomation = el.getAttribute("data-automation-id");
      if (dataAutomation) return '[data-automation-id="' + dataAutomation + '"]';
      var parent = el.parentElement;
      if (parent) { var siblings = Array.from(parent.children).filter(function(c) { return c.tagName === el.tagName; }); var idx = siblings.indexOf(el); if (siblings.length > 1) return el.tagName.toLowerCase() + ":nth-of-type(" + (idx + 1) + ")"; }
      return el.tagName.toLowerCase();
    };
    // Filter: skip tracking/analytics fields that aren't real form inputs
    var trackingNames = ['fbc','fbp','fbclid','gclid','utm_source','utm_medium','utm_campaign','utm_content','utm_term','posthogID','toltReferral','isMetaUser','_token','csrf','csrfmiddlewaretoken','authenticity_token','language','locale','referrer','source'];
    document.querySelectorAll("input:not([type='hidden']), textarea, select").forEach(function(el) {
      // Skip invisible elements (zero size, display:none, visibility:hidden)
      var rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      var style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;
      var tag = el.tagName.toLowerCase();
      var type = el.getAttribute("type") || (tag === "textarea" ? "textarea" : tag === "select" ? "select" : "text");
      var name = el.getAttribute("name") || "";
      var id = el.getAttribute("id") || "";
      // Skip known tracking/analytics field names
      if (name && trackingNames.indexOf(name) !== -1) return;
      if (id && trackingNames.indexOf(id) !== -1) return;
      var value = el.value || "";
      var label = getLabel(el);
      var selector = getSelector(el);
      var required = el.hasAttribute("required") ? " required" : "";
      var disabled = el.disabled ? " disabled" : "";
      var options = "";
      if (tag === "select") { var opts = Array.from(el.options).map(function(o) { return o.text.trim(); }).filter(Boolean).slice(0, 10); options = " options=[" + opts.join(", ") + "]"; }
      var key = tag + "|" + name + "|" + id;
      if (seen.has(key) && key !== "||") return;
      seen.add(key);
      elements.push("<" + tag + ' type="' + type + '" selector="' + selector + '" label="' + label + '" value="' + value + '"' + required + disabled + options + "/>");
    });
    // Detect custom dropdowns (ARIA combobox/listbox, Workday-style, React Select, etc.)
    document.querySelectorAll("[role='combobox'], [role='listbox'], [aria-haspopup='listbox'], [data-automation-id*='select'], [data-automation-id*='dropdown'], [class*='select__control'], [class*='css-'][class*='control']").forEach(function(el) {
      var rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      var style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return;
      var selector = getSelector(el);
      var key = "customdd|" + selector;
      if (seen.has(key)) return;
      seen.add(key);
      var label = getLabel(el);
      var role = el.getAttribute("role") || "";
      var expanded = el.getAttribute("aria-expanded") || "false";
      var currentValue = el.textContent?.trim().slice(0, 60) || el.value || "";
      var automationId = el.getAttribute("data-automation-id") || "";
      // Find associated input inside the combobox container
      var innerInput = el.querySelector("input");
      var inputSelector = innerInput ? getSelector(innerInput) : "";
      elements.push('<custom-dropdown selector="' + selector + '" label="' + label + '" role="' + role + '" expanded="' + expanded + '" value="' + currentValue + '" data-automation-id="' + automationId + '" input="' + inputSelector + '" note="CUSTOM DROPDOWN — use select_option or click to open then click the option"/>');
    });
    document.querySelectorAll("button, a[href], input[type='submit']").forEach(function(el) {
      var tag = el.tagName.toLowerCase();
      var text = (el.textContent?.trim() || "").slice(0, 60);
      if (!text) return;
      var rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      var selector = getSelector(el);
      var href = el.getAttribute("href") || "";
      var disabled = el.disabled ? " disabled" : "";
      var type = el.getAttribute("type") || "";
      var automationId = el.getAttribute("data-automation-id") || "";
      var autoAttr = automationId ? ' data-automation-id="' + automationId + '"' : "";
      elements.push("<" + tag + ' selector="' + selector + '" text="' + text + '" href="' + href + '" type="' + type + '"' + autoAttr + disabled + "/>");
    });
    document.querySelectorAll("iframe").forEach(function(iframe) {
      var src = iframe.getAttribute("src") || "";
      if (src && !src.includes("googleapis") && !src.includes("recaptcha") && !src.includes("gstatic") && !src.includes("doubleclick") && !src.includes("googletagmanager")) {
        elements.push('<iframe src="' + src.slice(0, 200) + '" note="IFRAME DETECTED — may contain application form. Use switch_to_iframe if it has form fields."/>');
      }
    });
    document.querySelectorAll("iframe[src*='recaptcha'], iframe[src*='hcaptcha'], iframe[src*='challenges.cloudflare'], .g-recaptcha, .h-captcha, [data-sitekey]").forEach(function(el) {
      var tag = el.tagName.toLowerCase();
      var src = el.getAttribute("src") || "";
      var sitekey = el.getAttribute("data-sitekey") || "";
      var type = "unknown";
      if (src.includes("recaptcha") || el.classList.contains("g-recaptcha")) type = "recaptcha";
      else if (src.includes("hcaptcha") || el.classList.contains("h-captcha")) type = "hcaptcha";
      else if (src.includes("challenges.cloudflare")) type = "turnstile";
      elements.push('<captcha type="' + type + '" tag="' + tag + '" sitekey="' + sitekey.slice(0, 40) + '" note="CAPTCHA DETECTED — use solve_captcha tool"/>');
    });
    document.querySelectorAll("[role='tab'], [data-tab], .tab, .nav-tab").forEach(function(el) {
      var text = (el.textContent?.trim() || "").slice(0, 40);
      if (text && /apply|application|form/i.test(text)) {
        var selector = getSelector(el);
        elements.push('<tab selector="' + selector + '" text="' + text + '" note="TAB that may reveal application form — click this first"/>');
      }
    });
    return elements.join("\\n");
  })()`);

  // Get visible text (truncated)
  const visibleText: string = await activePage.evaluate(`(document.body?.innerText || "").slice(0, 3000)`);

  return { url, title, screenshot, simplifiedHtml: simplifiedHtml.slice(0, 8000), visibleText: visibleText.slice(0, 2000) };
}
