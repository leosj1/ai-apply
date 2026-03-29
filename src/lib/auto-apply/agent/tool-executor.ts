// AI Agent Tool Executor
// Generic tool execution — no platform-specific hardcoded logic.
// The AI model decides what to do based on the screenshot + HTML.

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { AgentContext, ToolResult } from "./types";
import { safeScreenshot, safeKeyboard, isFrameDetached } from "./page-state";
import { fetchVerificationCode } from "./verification";

// Convert a CSS selector to a valid Playwright selector.
// CSS selectors cannot start with a digit after '#', so #1abc → [id="1abc"].
// Also handles tag-prefixed variants: textarea#1abc → textarea[id="1abc"].
function normalizeSelectorForPlaywright(selector: string): string {
  // 1. Digit-prefixed IDs: #1abc → [id="1abc"], textarea#1abc → textarea[id="1abc"]
  let s = selector.replace(/^([a-zA-Z]*)#(\d[^\s,]*)$/, (_, tag, id) =>
    tag ? `${tag}[id="${id}"]` : `[id="${id}"]`
  );
  // 2. IDs with dots (Recruitee: #input-candidate.email-7 or #input-candidate.locations.value-27-0)
  //    Convert if: contains dot(s) AND ends with a digit-bearing segment (strongly indicates compound ID)
  //    This avoids converting real #id.class selectors (class names rarely end in digits)
  s = s.replace(/^([a-zA-Z]*)#([a-zA-Z][a-zA-Z0-9-]*(?:\.[a-zA-Z][a-zA-Z0-9-]*)+)$/, (match, tag, id) => {
    if (/\d$/.test(id)) { // only if final char is a digit — compound ID pattern
      return tag ? `${tag}[id="${id}"]` : `[id="${id}"]`;
    }
    return match;
  });
  // 3. Backslash-escaped dots: #input-candidate\.email-7 → [id="input-candidate.email-7"]
  s = s.replace(/^([a-zA-Z]*)#([^\s,]+\\[.[^\s,]*)$/, (_, tag, id) => {
    const fullId = id.replace(/\\/g, "");
    return tag ? `${tag}[id="${fullId}"]` : `[id="${fullId}"]`;
  });
  return s;
}

// Normalize a CSS selector to a stable field identifier for loop detection.
// e.g. "#source--source" → "source", "[data-automation-id='phoneType']" → "phoneType"
function normalizeFieldId(selector: string): string {
  return selector
    .replace(/^[a-zA-Z][a-zA-Z0-9]*(?=[#\[.])/, "")  // strip tag prefix: textarea#id → #id
    .replace(/^#/, "")
    .replace(/^\[data-automation-id=["']?/i, "")
    .replace(/["']?\]$/, "")
    .replace(/^.*--/, "")  // "phoneNumber--phoneType" → "phoneType"
    .replace(/[^a-zA-Z0-9]/g, "")  // strip special chars
    .toLowerCase();
}

// Check if a field has been attempted too many times (unified across all tools).
// Returns a SKIP message if so, or null to proceed.
function checkFieldAttempts(fieldAttempts: Map<string, number> | undefined, selector: string, maxAttempts = 3): string | null {
  if (!fieldAttempts) return null;
  const fieldId = normalizeFieldId(selector);
  if (!fieldId || fieldId.length < 2) return null; // too generic to track
  const key = fieldId;
  const attempts = (fieldAttempts.get(key) || 0) + 1;
  fieldAttempts.set(key, attempts);
  console.log(`[AI-Agent] Field attempt: "${fieldId}" = ${attempts}/${maxAttempts}`);
  if (attempts > maxAttempts) {
    console.log(`[AI-Agent] SKIP: "${fieldId}" exceeded max attempts`);
    return `SKIP: Field "${selector}" has been attempted ${attempts} times (across all tools). Do NOT retry this field with ANY tool. Click Save/Continue/Next/Submit to proceed — validation will show which fields are truly required.`;
  }
  return null;
}

export async function executeTool(
  page: any,
  toolName: string,
  args: any,
  ctx: AgentContext,
  steps: string[],
  screenshots: { step: string; screenshot: string }[],
  browserContext?: any,
  fieldAttempts?: Map<string, number>,
  rootPage?: any,
): Promise<ToolResult> {
  try {
    switch (toolName) {
      case "fill_field": {
        const { selector, value } = args;

        // Unified loop detection across all tools
        const skipMsg = checkFieldAttempts(fieldAttempts, selector, 3);
        if (skipMsg) return skipMsg;

        // Normalize digit-prefixed IDs (#1abc → [id="1abc"]) — invalid as CSS but valid as attribute selectors
        const normalizedSelector = normalizeSelectorForPlaywright(selector);
        let el = await page.$(normalizedSelector);
        if (!el) {
          try { el = await page.$(`[name="${selector}"]`); } catch { /* */ }
        }
        if (!el) {
          try { el = await page.$(`[placeholder*="${selector}" i]`); } catch { /* */ }
        }
        if (!el) {
          try { el = await page.$(`label:has-text("${selector}") + input, label:has-text("${selector}") + textarea`); } catch { /* */ }
        }
        if (!el) return `Error: Element not found with selector "${selector}". Try a different selector.`;

        try { await el.scrollIntoViewIfNeeded(); await page.waitForTimeout(300); } catch { /* */ }

        // Detect tag name — handle <select> via selectOption
        const tagName = await el.evaluate((e: Element) => e.tagName.toLowerCase()).catch(() => "");
        if (tagName === "select") {
          try { await el.selectOption({ label: value }); } catch {
            try { await el.selectOption(value); } catch {
              try {
                const options = await el.$$("option");
                for (const opt of options) {
                  const text = await opt.textContent();
                  if (text && text.toLowerCase().includes(value.toLowerCase())) {
                    const val = await opt.getAttribute("value");
                    if (val) { await el.selectOption(val); break; }
                  }
                }
              } catch { /* */ }
            }
          }
          steps.push(`Selected "${value.slice(0, 30)}" in "${selector}"`);
          return `Successfully selected "${value}" in dropdown "${selector}".`;
        }

        await el.click();
        await page.waitForTimeout(200 + Math.random() * 300);

        // Detect autocomplete/combobox fields (standard ARIA + Workday + React Select + Ashby)
        const isAutocomplete = (
          (await el.getAttribute("role") === "combobox") ||
          (await el.getAttribute("aria-autocomplete") !== null) ||
          (await el.getAttribute("aria-haspopup") === "listbox") ||
          (await el.evaluate((e: Element) => {
            // Check parent containers for combobox patterns
            const parent = e.closest('[class*="select__"]') || e.closest('[class*="css-"]') || e.closest('[data-automation-id]');
            if (parent && (e.getAttribute("role") === "combobox" || e.getAttribute("aria-autocomplete") || parent.getAttribute("aria-haspopup") === "listbox")) return true;
            // Ashby-style: input inside a div that has a sibling [role="listbox"] or parent with aria-expanded
            const wrapper = e.parentElement;
            if (wrapper) {
              if (wrapper.querySelector('[role="listbox"]') || wrapper.getAttribute('aria-expanded') === 'true') return true;
              const grandparent = wrapper.parentElement;
              if (grandparent && (grandparent.querySelector('[role="listbox"]') || grandparent.getAttribute('aria-expanded') === 'true')) return true;
            }
            // React Select / Downshift patterns
            if (e.closest('[class*="combobox"]') || e.closest('[data-testid*="combobox"]') || e.closest('[class*="downshift"]')) return true;
            // Input with list attribute (native datalist)
            if (e.getAttribute('list')) return true;
            return false;
          }).catch(() => false))
        );

        if (isAutocomplete) {
          try { await el.fill(""); } catch { /* */ }

          const valueLower = value.toLowerCase();
          let clicked = false;
          const suggestionSelectors = [
            "[data-automation-id*='promptOption']",
            "[role='option']", ".select__option", "[class*='menu'] [class*='option']",
            "[role='listbox'] li", "[id*='option']",
            ".pac-item", ".autocomplete-results li", ".suggestions li",
            ".tt-suggestion", "ul.ui-autocomplete li", ".dropdown-menu li",
            "[data-testid*='option']", "li[data-value]",
          ];

          // Helper: scan visible suggestions and click the best text match
          const clickBestSuggestion = async (): Promise<boolean> => {
            for (const ss of suggestionSelectors) {
              try {
                const suggestions = await page.$$(ss);
                const visible: { el: any; text: string }[] = [];
                for (const suggestion of suggestions) {
                  if (await suggestion.isVisible().catch(() => false)) {
                    const text = (await suggestion.textContent().catch(() => ""))?.trim() || "";
                    if (text) visible.push({ el: suggestion, text });
                  }
                }
                if (visible.length === 0) continue;
                let best: { el: any; text: string; score: number } | null = null;
                for (const v of visible) {
                  const vLower = v.text.toLowerCase();
                  let score = 0;
                  if (vLower === valueLower) score = 100;
                  else if (vLower.startsWith(valueLower)) score = 80;
                  else if (vLower.includes(valueLower)) score = 60;
                  else if (valueLower.split(/\s+/).some((w: string) => w.length > 2 && vLower.includes(w))) score = 40;
                  if (score > 0 && (!best || score > best.score)) best = { ...v, score };
                }
                if (best) { await best.el.click(); return true; }
                if (visible.length === 1) { await visible[0].el.click(); return true; }
              } catch { /* */ }
            }
            return false;
          };

          // Strategy 1: Type a short prefix first (3-8 chars) — faster filtering for most dropdowns
          const shortPrefix = value.slice(0, Math.min(8, value.length));
          await safeKeyboard(page).type(shortPrefix, { delay: 60 });
          await page.waitForTimeout(2000);
          clicked = await clickBestSuggestion();

          // Strategy 2: If short prefix didn't match, clear and type the full value
          if (!clicked) {
            try { await el.fill(""); } catch { /* */ }
            await page.waitForTimeout(300);
            await safeKeyboard(page).type(value.slice(0, 30), { delay: 40 });
            await page.waitForTimeout(2000);
            clicked = await clickBestSuggestion();
          }

          // Strategy 3: keyboard navigation (ArrowDown + Enter)
          if (!clicked) {
            try {
              await safeKeyboard(page).press("ArrowDown");
              await page.waitForTimeout(300);
              await safeKeyboard(page).press("Enter");
              clicked = true;
            } catch { /* */ }
          }

          // Cleanup: dismiss any stale dropdown popup
          try { await safeKeyboard(page).press("Escape"); } catch { /* */ }
          await page.waitForTimeout(500);
        } else {
          // Standard fill — try el.fill() first, fall back to keyboard typing for React inputs
          let filled = false;
          try {
            await el.fill("");
            await el.fill(value);
            // inputValue() only works for <input>/<textarea>/<select>; contenteditable returns ""
            const currentVal = await el.inputValue().catch(() => null);
            if (currentVal === null || currentVal.length > 0) filled = true; // null = contenteditable (assume OK)
          } catch { /* */ }

          if (!filled) {
            // Fallback: click, select all, type character by character
            try {
              await el.click({ clickCount: 3 }); // select all
              await page.waitForTimeout(200);
              await safeKeyboard(page).type(value, { delay: 30 });
            } catch { /* */ }
          }

          if (!filled) {
            // Fallback synthetic events — only when el.fill() failed (keyboard path already used).
            // Uses the _valueTracker trick: reset React's internal change detector so it
            // recognizes our programmatic value as a new user input, preventing re-render resets.
            try {
              const tag = await el.evaluate((e: HTMLElement) => e.tagName.toLowerCase()).catch(() => "input");
              await page.evaluate((sel: string, val: string, isTextarea: boolean) => {
                const idMatch = sel.match(/^[a-zA-Z]*#(.+)$/);
                const domEl = idMatch
                  ? document.getElementById(idMatch[1])
                  : document.querySelector(sel) as HTMLElement | null;
                if (!domEl) return;
                const tracker = (domEl as any)._valueTracker;
                if (tracker) tracker.setValue("");
                const proto = isTextarea ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
                const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
                if (setter) setter.call(domEl, val);
                domEl.dispatchEvent(new Event("input", { bubbles: true }));
                domEl.dispatchEvent(new Event("change", { bubbles: true }));
              }, selector, value, tag === "textarea");
              await page.waitForTimeout(300);
            } catch { /* */ }
          } else {
            // el.fill() succeeded via trusted CDP events — press Tab to trigger onBlur/validation
            // (helps React-controlled forms like Workday that validate on blur)
            try {
              await safeKeyboard(page).press("Tab");
              await page.waitForTimeout(150);
            } catch { /* */ }
          }
        }
        steps.push(`Filled "${selector}" with "${value.slice(0, 30)}${value.length > 30 ? "..." : ""}"`);
        return `Successfully filled field "${selector}" with value.`;
      }

      case "click_element": {
        const { selector, description } = args;
        let el = await page.$(normalizeSelectorForPlaywright(selector));
        // Try data-automation-id if selector looks like one
        if (!el && selector.includes("data-automation-id")) {
          try { el = await page.$(`[${selector.replace(/^.*?(data-automation-id)/, '$1')}]`); } catch { /* */ }
        }
        if (!el) {
          try { el = await page.$(`text="${selector}"`); } catch { /* */ }
        }
        if (!el) {
          try { el = await page.$(`button:has-text("${selector}"), a:has-text("${selector}")`); } catch { /* */ }
        }
        // Use description for text-based matching (agent often puts button text in description)
        if (!el && description) {
          try { el = await page.$(`button:has-text("${description}"), a:has-text("${description}")`); } catch { /* */ }
          // Also try with just key words from description
          if (!el) {
            const words = description.split(/\s+/).filter((w: string) => w.length > 4 && !/^(click|button|select|upload|download|file|files|field|open|close|save|cancel|the|this|that|from|with|after|before|above|below|into|onto)$/i.test(w));
            for (const word of words.slice(0, 3)) {
              try { el = await page.$(`button:has-text("${word}"), a:has-text("${word}")`); } catch { /* */ }
              if (el) break;
            }
          }
        }
        if (!el) {
          try { el = await page.$(`*:has-text("${selector}")`); } catch { /* */ }
        }
        if (!el) return `Error: Element not found with selector "${selector}". Check the HTML for the exact selector — look for data-automation-id attributes on buttons. For Workday, the Save/Continue button often has data-automation-id="bottom-navigation-next-button".`;

        try {
          await el.scrollIntoViewIfNeeded();
          await page.waitForTimeout(500);
        } catch { /* */ }

        // Dismiss common overlays
        try {
          const overlaySelectors = [
            "button:has-text('Accept')", "button:has-text('Close')", "button:has-text('Dismiss')",
            "button:has-text('Got it')", "[aria-label='Close']", ".modal-close",
            "button:has-text('Accept All')", "button:has-text('I agree')",
          ];
          for (const os of overlaySelectors) {
            const overlay = await page.$(os);
            if (overlay && await overlay.isVisible()) {
              await overlay.click();
              await page.waitForTimeout(500);
              break;
            }
          }
        } catch { /* */ }

        await page.waitForTimeout(300 + Math.random() * 500);

        // Special handling for radio buttons — React-controlled forms need isTrusted=true CDP events
        const isRadio = await el.evaluate((e: any) => e.type === 'radio').catch(() => false);
        if (isRadio) {
          let clicked = false;
          // 1. Get the exact label element handle and click via CDP (isTrusted=true)
          try {
            const labelHandle = await el.evaluateHandle((radio: any) => {
              const parent = radio.closest('label');
              if (parent) return parent;
              if (radio.id) return document.querySelector(`label[for="${radio.id}"]`);
              const sib = radio.nextElementSibling;
              if (sib?.tagName === 'LABEL') return sib;
              return radio.parentElement?.querySelector('label') || null;
            });
            const labelEl = labelHandle ? await (labelHandle as any).asElement() : null;
            if (labelEl) {
              await labelEl.click({ force: true, timeout: 3000 });
              clicked = true;
              console.log(`[AI-Agent] Radio: label-click succeeded for "${selector.slice(0, 60)}"`);
            } else {
              console.log(`[AI-Agent] Radio: no label found for "${selector.slice(0, 60)}"`);
            }
          } catch (e) {
            console.log(`[AI-Agent] Radio: label-click threw: ${(e as Error).message?.slice(0, 60)}`);
          }
          // 2. focus() + keyboard Space — always isTrusted=true, works for hidden inputs
          if (!clicked) {
            try {
              await el.focus();
              await page.keyboard.press('Space');
              clicked = true;
              console.log(`[AI-Agent] Radio: keyboard-Space succeeded for "${selector.slice(0, 60)}"`);
            } catch { /* */ }
          }
          // 3. CDP click directly on input
          if (!clicked) {
            try { await el.click({ force: true, timeout: 3000 }); clicked = true; } catch { /* */ }
          }
          // 3. React fiber onChange — directly invoke the component's state updater
          await page.evaluate((s: string) => {
            const radio = document.querySelector(s) as HTMLInputElement;
            if (!radio) return;
            // Try React fiber to call onChange directly (works for controlled components)
            const fiberKey = Object.keys(radio).find((k: string) =>
              k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')
            );
            if (fiberKey) {
              let fiber = (radio as any)[fiberKey];
              while (fiber) {
                const props = fiber.memoizedProps;
                if (props && typeof props.onChange === 'function') {
                  radio.checked = true;
                  props.onChange({ target: radio, currentTarget: radio, type: 'change', bubbles: true, preventDefault: () => {}, stopPropagation: () => {}, nativeEvent: new Event('change') });
                  return;
                }
                fiber = fiber.return;
              }
            }
            // Fallback: native setter + events
            const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set;
            if (nativeSetter) nativeSetter.call(radio, true);
            else radio.checked = true;
            radio.dispatchEvent(new Event('change', { bubbles: true }));
            radio.dispatchEvent(new Event('input', { bubbles: true }));
          }, selector).catch(() => {});
          steps.push(`Clicked: ${description || selector}`);
          await page.waitForTimeout(800);
          return `Radio button selected: "${selector}". ${description || ''}`;
        }

        // Try normal click, then force, then JS click
        try {
          await el.click({ timeout: 5000 });
        } catch {
          try {
            await el.click({ force: true });
          } catch (forceErr) {
            try {
              await page.evaluate((s: string) => {
                const e = document.querySelector(s);
                if (e) (e as HTMLElement).click();
              }, selector);
            } catch {
              return `Error: Could not click "${selector}". Try scrolling or dismissing popups first. Error: ${(forceErr as Error).message}`;
            }
          }
        }

        // After clicking a label — trigger React fiber onChange on the associated radio (Workday multiselect fix)
        // NOTE: uses function() + var to avoid esbuild __name() wrapping (which breaks in browser context)
        try {
          const labelFiberResult = await el.evaluate(function(label: any) {
            if (label.tagName !== 'LABEL') return 'skip:not-label(' + label.tagName + ')';
            var forAttr = label.getAttribute('for');
            var radio = forAttr
              ? document.getElementById(forAttr)
              : (label.querySelector('input[type="radio"]') || label.previousElementSibling);
            if (!radio || (radio as any).type !== 'radio') return 'skip:no-radio(for=' + forAttr + ')';
            (radio as any).checked = true;
            var keys = Object.keys(radio);
            var fiberKey = null;
            for (var i = 0; i < keys.length; i++) {
              if (keys[i].indexOf('__reactFiber') === 0 || keys[i].indexOf('__reactInternalInstance') === 0) {
                fiberKey = keys[i]; break;
              }
            }
            if (fiberKey) {
              var fiber = (radio as any)[fiberKey]; var depth = 0;
              while (fiber && depth < 30) {
                var props = fiber.memoizedProps;
                if (props && typeof props.onChange === 'function') {
                  props.onChange({ target: radio, currentTarget: radio, type: 'change', bubbles: true, preventDefault: function(){}, stopPropagation: function(){}, nativeEvent: new Event('change') });
                  return 'fiber-onChange:depth=' + depth;
                }
                fiber = fiber.return; depth++;
              }
              return 'fiber-no-onChange:depth=' + depth;
            }
            var descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked');
            var nativeSetter = descriptor && descriptor.set;
            if (nativeSetter) nativeSetter.call(radio, true);
            (radio as any).dispatchEvent(new Event('change', { bubbles: true }));
            (radio as any).dispatchEvent(new Event('input', { bubbles: true }));
            return 'native-events-dispatched';
          });
          console.log(`[AI-Agent] Label-radio fix: ${labelFiberResult}`);
        } catch (e) { console.log(`[AI-Agent] Label-radio fix error: ${(e as Error).message?.slice(0,60)}`); }

        // Wait longer for submit/sign-in buttons — SPAs like Workday need time to process
        const isSubmitAction = /submit|sign.?in|create.?account|log.?in|next|continue|save/i.test(description || selector);
        if (isSubmitAction) {
          try { await page.waitForLoadState("networkidle", { timeout: 8000 }); } catch { /* */ }
          await page.waitForTimeout(3000);
        } else {
          await page.waitForTimeout(2000);
        }
        steps.push(`Clicked: ${description || selector}`);

        // Check if a new tab was opened
        if (browserContext) {
          try {
            const pages = browserContext.pages();
            if (pages.length > 1) {
              const newPage = pages[pages.length - 1];
              if (newPage !== page) {
                try { await newPage.waitForLoadState("networkidle", { timeout: 10000 }); } catch { /* */ }
                await newPage.waitForTimeout(1000);
                steps.push(`New tab opened: ${await newPage.title()}`);
                const ssB64 = await safeScreenshot(newPage);
                screenshots.push({ step: `New tab: ${description || selector}`, screenshot: ssB64 });
                return { result: `Clicked "${selector}" and a new tab opened. Switched to new tab.`, newPage };
              }
            }
          } catch { /* */ }
        }

        // Check if an iframe appeared with form fields
        try {
          const iframeExclusions = ["googleapis.com", "recaptcha", "gstatic.com", "doubleclick", "googletagmanager", "applywithlinkedin", "myworkdaygadgets"];
          const iframes = await page.$$("iframe");
          for (const iframe of iframes) {
            const src = await iframe.getAttribute("src");
            if (!src) continue;
            if (iframeExclusions.some((ex: string) => src.toLowerCase().includes(ex))) continue;
            const frame = await iframe.contentFrame();
            if (frame) {
              const inputs = await frame.$$("input:not([type='hidden']), textarea, select").catch(() => []);
              if (inputs.length >= 3) {
                steps.push(`Switched to embedded application iframe`);
                const ssB64 = await safeScreenshot(page);
                screenshots.push({ step: `Iframe detected: ${description || selector}`, screenshot: ssB64 });
                return { result: `Clicked "${selector}" and an embedded application form appeared in an iframe. Switched to iframe.`, newPage: frame };
              }
            }
          }
        } catch { /* */ }

        const ssB64 = await safeScreenshot(page);
        screenshots.push({ step: `After click: ${description || selector}`, screenshot: ssB64 });
        return `Clicked "${selector}" successfully. Page may have updated.`;
      }

      case "select_option": {
        const { selector, value, byLabel } = args;

        // Unified loop detection across all tools (shared counter with fill_field)
        const skipMsg = checkFieldAttempts(fieldAttempts, selector, 3);
        if (skipMsg) return skipMsg;

        const el = await page.$(selector);
        if (!el) return `Error: Select element not found with selector "${selector}".`;

        // Try standard <select>
        try {
          if (byLabel) {
            await el.selectOption({ label: value });
          } else {
            await el.selectOption(value);
          }
          steps.push(`Selected "${value}" in "${selector}"`);
          return `Selected option "${value}" in dropdown.`;
        } catch { /* not a standard select */ }
        try {
          await el.selectOption({ label: value });
          steps.push(`Selected "${value}" in "${selector}"`);
          return `Selected option "${value}" in dropdown.`;
        } catch { /* */ }

        // Generic custom dropdown: multiple strategies for ARIA/Workday/React Select
        try {
          const valueLower = value.toLowerCase();
          
          // Helper: scan visible options and click best text match
          const optionSelectors = [
            "[data-automation-id*='promptOption']",
            "[role='option']", "[role='listbox'] li",
            "[class*='option']:not([class*='control'])",
            "[class*='menu'] [class*='option']",
            ".autocomplete-results li", ".suggestions li",
            "ul.ui-autocomplete li", ".dropdown-menu li",
            ".pac-item", ".tt-suggestion", "[data-option-index]",
          ];
          const clickBestOption = async (): Promise<string | null> => {
            // Collect all visible options with their text
            const candidates: { el: any; text: string }[] = [];
            for (const optSel of optionSelectors) {
              try {
                const options = await page.$$(optSel);
                for (const opt of options) {
                  if (await opt.isVisible().catch(() => false)) {
                    const text = (await opt.textContent().catch(() => ""))?.trim() || "";
                    if (text) candidates.push({ el: opt, text });
                  }
                }
              } catch { /* */ }
              if (candidates.length > 0) break; // Use first selector that finds options
            }
            if (candidates.length === 0) return null;
            
            // Score candidates: exact match > starts with > contains > word overlap
            let best: { el: any; text: string; score: number } | null = null;
            for (const c of candidates) {
              const cLower = c.text.toLowerCase();
              let score = 0;
              if (cLower === valueLower) score = 100;
              else if (cLower.startsWith(valueLower)) score = 80;
              else if (cLower.includes(valueLower)) score = 60;
              else if (valueLower.split(/\s+/).some((w: string) => w.length > 2 && cLower.includes(w))) score = 40;
              if (score > 0 && (!best || score > best.score)) {
                best = { ...c, score };
              }
            }
            if (best) {
              await best.el.click();
              await page.waitForTimeout(500);
              steps.push(`Selected "${best.text.slice(0, 40)}" in "${selector}"`);
              return `Selected option "${best.text}" in custom dropdown.`;
            }
            return null;
          };

          // Strategy A: Click element to open dropdown WITHOUT typing (works for Workday, many ARIA dropdowns)
          await el.click({ timeout: 3000 }).catch(() => el.click({ force: true }).catch(() => {}));
          await page.waitForTimeout(1000);
          
          let result = await clickBestOption();
          if (result) return result;
          
          // Strategy B: Try clicking inner button/arrow to open dropdown popup
          const trigger = await page.$(`${selector} button, ${selector} [class*='arrow'], ${selector} [class*='indicator']`);
          if (trigger) {
            await trigger.click({ timeout: 3000 }).catch(() => {});
            await page.waitForTimeout(1000);
            result = await clickBestOption();
            if (result) return result;
          }
          
          // Strategy C: Find inner <input> and type to filter (works for React Select, searchable dropdowns)
          const innerInput = await page.$(`${selector} input`) ||
            await page.$(`[data-automation-id="${selector.replace('#', '')}"] input`) ||
            (await el.evaluate((e: Element) => e.tagName.toLowerCase()).catch(() => "") === "input" ? el : null);
          
          if (innerInput) {
            await innerInput.click({ timeout: 3000 }).catch(() => innerInput.click({ force: true }).catch(() => {}));
            await page.waitForTimeout(600);
            try { await innerInput.fill(""); } catch { /* */ }
            await safeKeyboard(page).type(value.slice(0, 25), { delay: 40 });
            await page.waitForTimeout(1500);
            
            result = await clickBestOption();
            if (result) return result;
          }

          // Strategy C: Keyboard navigation fallback — but be honest about uncertainty
          try {
            await safeKeyboard(page).press("ArrowDown");
            await page.waitForTimeout(300);
            await safeKeyboard(page).press("Enter");
            await page.waitForTimeout(500);
            // Dismiss any open popup by pressing Escape
            await safeKeyboard(page).press("Escape").catch(() => {});
            await page.waitForTimeout(300);
          } catch { /* */ }
          return `UNCERTAIN: Attempted keyboard selection for "${value}" in "${selector}" but could not verify it worked. Do NOT retry this dropdown. Instead, click Save/Continue/Next to proceed — if this field is required, validation errors will appear and you can try a different approach.`;
        } catch {
          return `FAILED: Could not select "${value}" in "${selector}". Do NOT retry. Click Save/Continue/Next to proceed — validation will show which fields are truly required.`;
        }
      }

      case "upload_file": {
        const { selector } = args;
        if (!ctx.resumeFilePath) return "Error: No resume file path configured. Cannot upload file.";

        const fs = require("fs");
        if (!fs.existsSync(ctx.resumeFilePath)) {
          return `Error: Resume file not found at "${ctx.resumeFilePath}".`;
        }

        const isInsideIframe = typeof page.page === "function";
        const theRootPage = isInsideIframe ? page.page() : page;

        // Strategy 1: iframe filechooser
        if (isInsideIframe) {
          try {
            await page.evaluate(`(() => {
              var el = document.querySelector('${selector.replace(/'/g, "\\'")}') || document.querySelector('input[type="file"]');
              if (el) { el.classList.remove('visually-hidden'); el.style.cssText='display:block;opacity:1;position:relative;width:300px;height:30px;'; }
            })()`);
            await page.waitForTimeout(300);

            const clickTarget = selector || 'input[type="file"]';
            const [fileChooser] = await Promise.all([
              theRootPage.waitForEvent("filechooser", { timeout: 5000 }),
              page.locator(clickTarget).first().click({ force: true }),
            ]);
            await fileChooser.setFiles(ctx.resumeFilePath);
            // Wait for upload
            let uploadComplete = false;
            for (let w = 0; w < 5; w++) {
              await theRootPage.waitForTimeout(3000);
              try {
                const progress = await page.evaluate(`(() => {
                  var pb = document.querySelector('[role="progressbar"]');
                  if (pb) { var val = parseInt(pb.getAttribute('aria-valuenow') || '0'); if (val >= 100) return 'complete'; if (val > 0) return 'uploading:' + val; }
                  var fn = document.querySelector('.file-upload__filename, .filename');
                  if (fn && fn.textContent.trim()) return 'filename:' + fn.textContent.trim();
                  return 'pending';
                })()`);
                if (progress === "complete" || progress.startsWith("filename:")) {
                  uploadComplete = true;
                  break;
                }
              } catch { /* */ }
            }
            steps.push("Uploaded resume file");
            return uploadComplete
              ? "File uploaded successfully. The resume has been attached."
              : "File upload initiated but may still be processing. Continue filling other fields.";
          } catch (fcErr) {
            console.log(`[AI-Agent] Iframe filechooser failed: ${(fcErr as Error).message.slice(0, 100)}`);
          }
        }

        // Strategy 2: Standard setInputFiles
        const el = await page.$(selector);
        if (!el) {
          const anyFileInput = await page.$('input[type="file"][accept*="pdf"], input[type="file"][accept*=".pdf"], input[type="file"][accept*="doc"], input[type="file"]');
          if (anyFileInput) {
            await anyFileInput.setInputFiles(ctx.resumeFilePath);
            await page.waitForTimeout(3000);
            steps.push("Uploaded resume file (fallback file input)");
            return "File uploaded successfully via fallback file input.";
          }
          return `Error: File input not found with selector "${selector}".`;
        }

        await el.setInputFiles(ctx.resumeFilePath);
        await page.waitForTimeout(3000);
        steps.push("Uploaded resume file");
        return "File uploaded successfully.";
      }

      case "switch_to_iframe": {
        const { iframeSrc } = args;
        const srcMatch = iframeSrc || "";
        const iframeExclusions = ["googleapis.com", "recaptcha", "google.com/recaptcha", "gstatic.com", "doubleclick", "googletagmanager", "applywithlinkedin", "myworkdaygadgets", "trustarc", "onetrust", "cookielaw", "cookieconsent", "cookiepro", "consent.trustarc"];
        const allIframes = await page.$$("iframe");

        // First: match by src hint
        if (srcMatch) {
          for (const iframe of allIframes) {
            const src = await iframe.getAttribute("src");
            if (!src) continue;
            if (iframeExclusions.some((ex: string) => src.toLowerCase().includes(ex))) continue;
            if (src.toLowerCase().includes(srcMatch.toLowerCase())) {
              const frame = await iframe.contentFrame();
              if (frame) {
                await frame.waitForLoadState("domcontentloaded").catch(() => {});
                await page.waitForTimeout(1000);
                steps.push(`Switched to iframe: ${src.slice(0, 100)}`);
                return { result: `Switched to application iframe (${srcMatch}).`, newPage: frame };
              }
            }
          }
        }

        // Fallback: find any iframe with form fields
        for (const iframe of allIframes) {
          const src = await iframe.getAttribute("src");
          if (src && iframeExclusions.some((ex: string) => src.toLowerCase().includes(ex))) continue;
          const frame = await iframe.contentFrame();
          if (frame) {
            const inputs = await frame.$$("input:not([type='hidden']), textarea, select");
            if (inputs.length > 3) {
              await frame.waitForLoadState("domcontentloaded").catch(() => {});
              steps.push(`Switched to iframe with ${inputs.length} form fields`);
              return { result: `Switched to iframe containing ${inputs.length} form fields.`, newPage: frame };
            }
          }
        }
        return "Error: No application iframe found. Try clicking an 'Apply' button first, or use navigate_to with the application URL.";
      }

      case "navigate_to": {
        const { url: navUrl, reason } = args;
        try {
          await page.goto(navUrl, { waitUntil: "networkidle", timeout: 20000 });
        } catch {
          try { await page.goto(navUrl, { waitUntil: "domcontentloaded", timeout: 15000 }); } catch { /* */ }
        }
        await page.waitForTimeout(2000);
        steps.push(`Navigated to: ${reason || navUrl}`);
        const navSsB64 = await safeScreenshot(page);
        screenshots.push({ step: `After navigation: ${reason || navUrl}`, screenshot: navSsB64 });
        return `Navigated to ${navUrl}. Page loaded.`;
      }

      case "get_verification_code": {
        const { senderHint, waitSeconds } = args;
        // Auto-detect ATS platform from page URL to improve sender hint
        let effectiveSenderHint = senderHint;
        if (!senderHint || senderHint === "noreply@" || senderHint === "no-reply@") {
          try {
            const pageUrl = (rootPage || page).url?.() || "";
            if (pageUrl.includes("greenhouse")) effectiveSenderHint = "greenhouse-mail.io";
            else if (pageUrl.includes("lever.co")) effectiveSenderHint = "lever.co";
            else if (pageUrl.includes("workday") || pageUrl.includes("myworkdayjobs")) effectiveSenderHint = "workday.com";
            else if (pageUrl.includes("smartrecruiters")) effectiveSenderHint = "smartrecruiters.com";
            else if (pageUrl.includes("ashbyhq")) effectiveSenderHint = "ashbyhq.com";
            else if (pageUrl.includes("icims")) effectiveSenderHint = "icims.com";
            else if (pageUrl.includes("workable")) effectiveSenderHint = "workable.com";
            if (effectiveSenderHint !== senderHint) {
              console.log(`[AI-Agent] Auto-detected ATS sender hint: ${effectiveSenderHint} (page: ${pageUrl.slice(0, 60)})`);
            }
          } catch { /* ignore URL detection errors */ }
        }
        const code = await fetchVerificationCode(ctx.dbUserId, ctx.email, effectiveSenderHint, waitSeconds || 30, rootPage, ctx.clerkId);
        if (code) {
          if (code.startsWith("RESET_LINK:")) {
            const resetUrl = code.replace("RESET_LINK:", "");
            steps.push(`Retrieved password reset link from email`);
            return `Password reset link found: ${resetUrl}\n\nUse navigate_to to open this link, then set a new password (use "ApplyAI_2026!xK") and sign in.`;
          }
          steps.push(`Retrieved verification code: ${code}`);
          return `Verification code found: ${code}`;
        }
        return "Error: No verification code found in email. It may not have arrived yet. Try waiting longer or try a different approach (e.g., create a new account if sign-in failed).";
      }

      case "scroll_page": {
        const { direction, amount } = args;
        const px = amount || 500;
        await page.evaluate(`window.scrollBy(0, ${direction === "down" ? px : -px})`);
        await page.waitForTimeout(500);
        steps.push(`Scrolled ${direction} ${px}px`);
        return `Scrolled ${direction} by ${px}px.`;
      }

      case "wait_and_screenshot": {
        const { waitMs, reason } = args;
        const ms = waitMs || 3000;
        await page.waitForTimeout(ms);
        steps.push(`Waited ${ms}ms: ${reason || "page load"}`);
        const ssB64 = await safeScreenshot(page);
        screenshots.push({ step: `After wait: ${reason || "page load"}`, screenshot: ssB64 });
        return `Waited ${ms}ms. New screenshot taken.`;
      }

      case "check_checkbox": {
        const { selector, checked } = args;
        const el = await page.$(selector);
        if (!el) return `Error: Checkbox not found with selector "${selector}".`;
        const isChecked = await el.isChecked().catch(() => false);
        const wantChecked = checked !== false;
        if (wantChecked !== isChecked) {
          // Use JS-based approach for custom styled checkboxes (Lever)
          try {
            await page.evaluate((s: string, want: boolean) => {
              const cb = document.querySelector(s) as HTMLInputElement;
              if (cb) {
                cb.checked = want;
                cb.dispatchEvent(new Event('change', { bubbles: true }));
                cb.dispatchEvent(new Event('input', { bubbles: true }));
                cb.dispatchEvent(new Event('click', { bubbles: true }));
              }
            }, selector, wantChecked);
          } catch {
            await el.click();
          }
        }
        steps.push(`${wantChecked ? "Checked" : "Unchecked"} "${selector}"`);
        return `Checkbox ${wantChecked ? "checked" : "unchecked"} successfully.`;
      }

      case "solve_captcha": {
        const captchaType = args.captchaType || "unknown";
        steps.push(`CAPTCHA detected: ${captchaType}`);
        console.log(`[AI-Agent] CAPTCHA detected: ${captchaType}`);

        const parentPage = (typeof page.page === "function") ? page.page() : null;
        const pagesToSearch = parentPage ? [page, parentPage] : [page];

        // Strategy 1: Click reCAPTCHA checkbox
        for (const searchPage of pagesToSearch) {
          try {
            const recaptchaFrame = await searchPage.$('iframe[src*="recaptcha"], iframe[title*="reCAPTCHA"]');
            if (recaptchaFrame) {
              const frame = await recaptchaFrame.contentFrame();
              if (frame) {
                const checkbox = await frame.$(".recaptcha-checkbox-border, #recaptcha-anchor");
                if (checkbox) {
                  await checkbox.click();
                  await (parentPage || page).waitForTimeout(3000);
                  const checked = await frame.$('.recaptcha-checkbox-checked, [aria-checked="true"]');
                  if (checked) {
                    steps.push("CAPTCHA: Clicked reCAPTCHA checkbox — solved");
                    return "CAPTCHA solved by clicking the reCAPTCHA checkbox. Continue with form submission.";
                  }
                }
              }
            }
          } catch { /* */ }
        }

        // Strategy 2: Turnstile checkbox
        for (const searchPage of pagesToSearch) {
          try {
            const turnstileFrame = await searchPage.$('iframe[src*="challenges.cloudflare.com"]');
            if (turnstileFrame) {
              const frame = await turnstileFrame.contentFrame();
              if (frame) {
                const checkbox = await frame.$('input[type="checkbox"], .cb-i');
                if (checkbox) {
                  await checkbox.click();
                  await (parentPage || page).waitForTimeout(3000);
                  steps.push("CAPTCHA: Clicked Turnstile checkbox");
                  return "Attempted Turnstile CAPTCHA by clicking checkbox. Check if it was solved.";
                }
              }
            }
          } catch { /* */ }
        }

        // Pre-check: are there empty required fields? Don't waste CAPTCHA tokens on incomplete forms
        // Auto-fill survey/EEO fields immediately; after 2 deferrals auto-fill ALL remaining groups
        // Track deferrals to avoid infinite loops — max 3 deferrals then proceed anyway
        if (!((page as any).__captchaDeferCount >= 0)) (page as any).__captchaDeferCount = 0;
        const deferCount = (page as any).__captchaDeferCount;
        try {
          const checkPage = parentPage || page;
          const emptyRequired: string[] = await checkPage.evaluate(`(function() {
            var empty = [];
            var defersSoFar = ${deferCount};
            var surveyKw = /gender|race|ethnicity|veteran|disability|lgbtq|orientation|identity|demographic|survey/i;
            var raceOptionKw = /asian|hispanic|latino|black|african|native|hawaiian|pacific|white|caucasian|two or more|prefer not/i;

            function getSectionLabel(el) {
              var c = el.closest(".application-question, .custom-question, fieldset, div[class*='card'], .application-additional, .application-demographics, .lever-application-custom-field");
              if (!c) return el.name || "";
              // Try section header first (h2, h3, legend, .question-label), then first label
              var hdr = c.querySelector("h2, h3, h4, legend, .question-label, .application-label");
              if (hdr) return hdr.textContent.trim().slice(0, 80);
              var lbl = c.querySelector("label");
              return lbl ? lbl.textContent.trim().slice(0, 80) : el.name || "";
            }

            // Check text inputs, selects, textareas with [required]
            document.querySelectorAll("input[required], select[required], textarea[required]").forEach(function(el) {
              if (!el.value && el.type !== "hidden" && el.type !== "file" && el.type !== "radio" && el.type !== "checkbox" && el.offsetParent !== null) {
                var label = (el.closest("label") || {}).textContent;
                label = (label || "").trim().slice(0, 30) || el.name || el.id || "unknown";
                empty.push(label);
              }
            });

            // Check ALL radio groups
            var radioGroups = {};
            document.querySelectorAll("input[type='radio']").forEach(function(el) {
              if (el.offsetParent === null) return;
              if (!radioGroups[el.name]) radioGroups[el.name] = { checked: false, radios: [] };
              radioGroups[el.name].radios.push(el);
              if (el.checked) radioGroups[el.name].checked = true;
            });

            var groupNames = Object.keys(radioGroups);
            for (var i = 0; i < groupNames.length; i++) {
              var name = groupNames[i];
              var group = radioGroups[name];
              if (group.checked) continue;

              var labelText = getSectionLabel(group.radios[0]);
              var isSurvey = surveyKw.test(labelText) || surveyKw.test(name) || name.indexOf("survey") !== -1;

              // Auto-fill: survey groups always; ALL groups after 2 deferrals
              if (isSurvey || defersSoFar >= 2) {
                var lastRadio = group.radios[group.radios.length - 1];
                lastRadio.checked = true;
                lastRadio.dispatchEvent(new Event("change", { bubbles: true }));
                lastRadio.dispatchEvent(new Event("input", { bubbles: true }));
                continue;
              }

              empty.push("Radio: " + labelText.slice(0, 50) + " [name=" + name + "]");
            }

            // Check checkbox groups
            var sections = document.querySelectorAll(".application-question, .custom-question, div[class*='card'], .application-demographics, .lever-application-custom-field");
            sections.forEach(function(section) {
              var checkboxes = section.querySelectorAll("input[type='checkbox']");
              if (checkboxes.length <= 1) return;
              var anyChecked = false;
              checkboxes.forEach(function(cb) { if (cb.checked) anyChecked = true; });
              if (anyChecked) return;

              var label = getSectionLabel(checkboxes[0]);

              // Detect race/ethnicity by checking option labels too
              var hasRaceOptions = false;
              checkboxes.forEach(function(cb) {
                var optLabel = (cb.closest("label") || cb.parentElement || {}).textContent || "";
                if (raceOptionKw.test(optLabel)) hasRaceOptions = true;
              });

              var isSurvey = surveyKw.test(label) || hasRaceOptions;

              // Auto-fill: survey groups always; ALL groups after 2 deferrals
              if (isSurvey || defersSoFar >= 2) {
                var preferNot = null;
                checkboxes.forEach(function(cb) {
                  var cbLabel = (cb.closest("label") || cb.parentElement || {}).textContent || "";
                  if (/prefer not|decline/i.test(cbLabel)) preferNot = cb;
                });
                var target = preferNot || checkboxes[0];
                target.checked = true;
                target.dispatchEvent(new Event("change", { bubbles: true }));
                return;
              }

              var firstName = checkboxes[0] ? checkboxes[0].name : "";
              empty.push("Checkboxes: " + label.slice(0, 50) + " [name=" + firstName + "]");
            });

            return empty;
          })()`);
          if (emptyRequired.length > 0 && (page as any).__captchaDeferCount < 3) {
            (page as any).__captchaDeferCount++;
            console.log(`[AI-Agent] CAPTCHA pre-check: ${emptyRequired.length} empty required fields — deferring solve (${(page as any).__captchaDeferCount}/3)`);
            console.log(`[AI-Agent] Empty fields: ${emptyRequired.join(" | ")}`);
            return `CAPTCHA detected but ${emptyRequired.length} required fields are still empty: ${emptyRequired.join(", ")}. SCROLL DOWN to find all fields. For each radio group, use click_element with the selector shown. Fill ALL fields first, then call solve_captcha — tokens expire in ~2 minutes.`;
          }
          if (emptyRequired.length > 0) {
            console.log(`[AI-Agent] CAPTCHA pre-check: ${emptyRequired.length} empty fields remain but max deferrals reached — proceeding with solve`);
          }
        } catch (preCheckErr) {
          console.log(`[AI-Agent] CAPTCHA pre-check error: ${(preCheckErr as Error).message?.slice(0, 100)}`);
        }

        // Strategy 3: Multi-provider CAPTCHA solver using getcaptcha network-intercept
        // solveCaptcha() installs a context-level route on api.hcaptcha.com/getcaptcha,
        // waits for Anti-Captcha to return a token, injects it into the fake getcaptcha
        // response so the widget fires its callback with a valid session-bound token.
        try {
          const { solveCaptcha: solveWithProvider, isCaptchaSolverAvailable } = await import("../captcha/solver");
          if (!isCaptchaSolverAvailable()) {
            console.log("[AI-Agent] WARNING: No CAPTCHA API keys configured. Set ANTICAPTCHA_API_KEY (for hCaptcha/Lever), CAPSOLVER_API_KEY (for reCAPTCHA), or TWOCAPTCHA_API_KEY in your .env file.");
          }
          if (isCaptchaSolverAvailable()) {
            const targetPage = parentPage || page;
            const solution = await solveWithProvider(targetPage);
            if (solution.success && solution.token) {
              steps.push(`CAPTCHA: Solved via getcaptcha-intercept (${solution.type}, ${Math.round((solution.solveTimeMs || 0) / 1000)}s)`);
              console.log(`[AI-Agent] CAPTCHA solved — auto-clicking submit immediately to avoid token expiry`);

              // Auto-submit immediately — don't go back to agent loop (token expires in ~120s)
              // Search both iframe (page) and parent page for submit buttons
              const pagesToTry = parentPage && parentPage !== page ? [page, parentPage] : [parentPage || page];
              try {
                const submitSelectors = [
                  "button[type='submit']:not([disabled])",
                  "input[type='submit']:not([disabled])",
                  "#resumator-submit-button",           // JazzHR variant 1
                  "#resumator-submit",                   // JazzHR variant 2
                  "[data-qa='btn-submit']",
                  "[data-automation-id='bottom-navigation-next-button']", // Workday
                  "button:has-text('Submit Application')",
                  "button:has-text('Submit')",
                  "button:has-text('Apply Now')",
                  "button:has-text('Apply')",
                  "button:has-text('Send Application')",
                  "button:has-text('Complete Application')",
                  "input[value='Apply Now']",           // iCIMS
                  "input[value='Submit']",
                  "button[type='submit']",              // disabled fallback
                ];
                let submitted = false;
                // Fast parallel search: find the first visible submit button across all pages
                for (const submitPage of pagesToTry) {
                  if (submitted) break;
                  const btnPromises = submitSelectors.map(async (sel) => {
                    try {
                      const btn = await submitPage.$(sel);
                      if (btn && await btn.isVisible().catch(() => false)) return { btn, sel };
                    } catch { /* */ }
                    return null;
                  });
                  const results = await Promise.all(btnPromises);
                  const found = results.find(r => r !== null);
                  if (found) {
                    await found.btn.click();
                    console.log(`[AI-Agent] Auto-clicked submit: ${found.sel}`);
                    await submitPage.waitForTimeout(4000);
                    const url = submitPage.url();
                    const bodyText = await submitPage.textContent("body").catch(() => "") || "";
                    const success = /\/thanks|\/complete|\/thank|thank.you|submitted|application.received|confirmation|\/applied|\/success/i.test(url) || /application submitted|your application has been|thanks for applying|thank you for (your )?appl|we.ve received your|your application was received/i.test(bodyText);
                    if (success) {
                      steps.push("Auto-submitted after CAPTCHA solve — confirmed!");
                      console.log(`[AI-Agent] Auto-submit confirmed: ${url}`);
                      return `CAPTCHA solved and application auto-submitted successfully! URL: ${url}`;
                    }
                    // Some forms need a second click (validation pass after CAPTCHA)
                    if (!/error verifying|try again/i.test(bodyText)) {
                      try {
                        const btn2 = await submitPage.$(found.sel);
                        if (btn2 && await btn2.isVisible().catch(() => false)) {
                          await btn2.click();
                          console.log(`[AI-Agent] Auto-submit retry click: ${found.sel}`);
                          await submitPage.waitForTimeout(4000);
                          const url2 = submitPage.url();
                          const bodyText2 = await submitPage.textContent("body").catch(() => "") || "";
                          const success2 = /\/thanks|\/complete|\/thank|thank.you|submitted|application.received|confirmation|\/applied|\/success/i.test(url2) || /application submitted|your application has been|thanks for applying|thank you for (your )?appl|we.ve received your|your application was received/i.test(bodyText2);
                          if (success2) {
                            steps.push("Auto-submitted after CAPTCHA solve (retry click) — confirmed!");
                            console.log(`[AI-Agent] Auto-submit retry confirmed: ${url2}`);
                            return `CAPTCHA solved and application auto-submitted successfully! URL: ${url2}`;
                          }
                        }
                      } catch { /* */ }
                    } else {
                      console.log(`[AI-Agent] Auto-submit got verification error — returning to agent`);
                    }
                    submitted = true;
                  }
                }
                if (!submitted) {
                  console.log(`[AI-Agent] No submit button found for auto-submit — returning to agent`);
                }
              } catch (submitErr) {
                console.log(`[AI-Agent] Auto-submit error: ${(submitErr as Error).message?.slice(0, 80)}`);
              }

              return `CAPTCHA solved via network-intercept (${solution.type})! The token is now injected. Click the Submit button NOW — token expires in ~2 minutes.`;
            }
            if (solution.error) {
              console.log(`[AI-Agent] CAPTCHA solver: ${solution.error}`);
            }
          }
        } catch (e) {
          console.log(`[AI-Agent] CAPTCHA solver error: ${(e as Error).message}`);
        }

        // Check if already solved
        for (const searchPage of pagesToSearch) {
          try {
            const solved = await searchPage.$('.recaptcha-checkbox-checked, [aria-checked="true"], .captcha-solved');
            if (solved) return "CAPTCHA appears to already be solved. Continue with form submission.";
          } catch { /* */ }
        }

        return `CAPTCHA detected (${captchaType}) but could not be automatically solved. Try clicking the submit button anyway — many CAPTCHAs auto-solve on submission.`;
      }

      case "report_status": {
        return "Status reported.";
      }

      default:
        return `Unknown tool: ${toolName}`;
    }
  } catch (err) {
    const errMsg = (err as Error).message || "";
    // Detect frame detachment — recover by switching back to rootPage
    if (rootPage && /frame was detached|frame.evaluate|execution context was destroyed|frame has been detached/i.test(errMsg)) {
      console.log(`[AI-Agent] Frame detached during ${toolName} — recovering to root page`);
      steps.push(`Frame detached during ${toolName} — switched back to main page`);
      return { result: `Frame was detached (the iframe navigated or closed). Switched back to the main page. Take a screenshot to see the current state, then use switch_to_iframe if you need to re-enter an iframe, or continue on the main page.`, newPage: rootPage };
    }
    return `Error executing ${toolName}: ${errMsg}`;
  }
}
