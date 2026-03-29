// CAPTCHA Solving Service — Multi-provider (CapSolver + 2Captcha)
// Supports: reCAPTCHA v2, hCaptcha, Cloudflare Turnstile
//
// Provider priority:
//   1. CapSolver (CAPSOLVER_API_KEY) — best hCaptcha support
//   2. 2Captcha  (TWOCAPTCHA_API_KEY / CAPTCHA_API_KEY)
//
// Flow:
// 1. Detect CAPTCHA type + sitekey from page
// 2. Submit to solving provider
// 3. Poll for solution (typically 15-45s)
// 4. Inject solution token into page
// 5. Trigger callback if needed

/* eslint-disable @typescript-eslint/no-explicit-any */

import { Solver } from "2captcha-ts";

const CAPSOLVER_API = "https://api.capsolver.com";
const ANTICAPTCHA_API = "https://api.anti-captcha.com";

export type CaptchaType = "recaptcha_v2" | "hcaptcha" | "turnstile" | "unknown";

export interface CaptchaInfo {
  type: CaptchaType;
  sitekey: string;
  pageUrl: string;
  /** For Turnstile: action parameter */
  action?: string;
  /** For Turnstile: cdata parameter */
  cdata?: string;
  /** For hCaptcha: enterprise mode */
  isEnterprise?: boolean;
  /** For hCaptcha: invisible/execute mode */
  isInvisible?: boolean;
  /** For hCaptcha: enterprise API endpoint */
  enterprisePayload?: Record<string, string>;
  /** For hCaptcha: rqdata from checksiteconfig (session-specific HSW challenge) */
  rqdata?: string;
}

export interface CaptchaSolution {
  success: boolean;
  token?: string;
  error?: string;
  type: CaptchaType;
  solveTimeMs?: number;
}

type Provider = "capsolver" | "2captcha" | "anticaptcha";

interface ProviderConfig {
  provider: Provider;
  apiKey: string;
}

/** Get the best provider for a specific CAPTCHA type */
function getProviderForType(captchaType?: CaptchaType): ProviderConfig | null {
  return getProvidersForType(captchaType)[0] ?? null;
}

/** Get all available providers in priority order for fallback */
function getProvidersForType(captchaType?: CaptchaType): ProviderConfig[] {
  const capsolverKey = process.env.CAPSOLVER_API_KEY;
  const anticaptchaKey = process.env.ANTICAPTCHA_API_KEY || process.env.ANTI_CAPTCHA_API_KEY;
  const twoCaptchaKey = process.env.TWOCAPTCHA_API_KEY || process.env.CAPTCHA_API_KEY;

  const providers: ProviderConfig[] = [];

  // hCaptcha: Anti-Captcha first (CapSolver proxyless unreliable for enterprise HSW)
  if (captchaType === "hcaptcha") {
    if (anticaptchaKey) providers.push({ provider: "anticaptcha", apiKey: anticaptchaKey });
    if (twoCaptchaKey) providers.push({ provider: "2captcha", apiKey: twoCaptchaKey });
    if (capsolverKey) providers.push({ provider: "capsolver", apiKey: capsolverKey });
    return providers;
  }

  // reCAPTCHA / Turnstile: CapSolver first, Anti-Captcha as fallback
  if (capsolverKey) providers.push({ provider: "capsolver", apiKey: capsolverKey });
  if (anticaptchaKey) providers.push({ provider: "anticaptcha", apiKey: anticaptchaKey });
  if (twoCaptchaKey) providers.push({ provider: "2captcha", apiKey: twoCaptchaKey });
  return providers;
}

function getProvider(): ProviderConfig | null {
  return getProviderForType();
}

function getApiKey(): string | null {
  return getProvider()?.apiKey || null;
}

// ── CAPTCHA Detection ──

/** Detect CAPTCHA type and sitekey from a Playwright page */
export async function detectCaptcha(page: any): Promise<CaptchaInfo | null> {
  try {
    const result = await page.evaluate(() => {
      // hCaptcha — check FIRST because hCaptcha also uses data-sitekey, which would
      // false-match the reCAPTCHA selector if we checked reCAPTCHA first
      const hcaptchaEl = document.querySelector(".h-captcha, [data-hcaptcha-sitekey], iframe[src*='hcaptcha']");
      if (hcaptchaEl) {
        const sitekey = hcaptchaEl.getAttribute("data-sitekey") || hcaptchaEl.getAttribute("data-hcaptcha-sitekey") ||
          (document.querySelector("iframe[src*='hcaptcha']") as HTMLIFrameElement)?.src?.match(/sitekey=([^&]+)/)?.[1] || "";
        // Detect enterprise hCaptcha: only from explicit enterprise indicators
        let isEnterprise = false;
        const scripts = Array.from(document.querySelectorAll("script[src*='hcaptcha']"));
        for (const s of scripts) {
          const src = (s as HTMLScriptElement).src || "";
          // Only enterprise.js or explicit enterprise param — NOT secure-api.js or api.js
          if (src.includes("/enterprise.js") || src.includes("enterprise=true")) isEnterprise = true;
        }
        // Check for enterprise endpoint attribute on widget
        if (hcaptchaEl.getAttribute("data-endpoint")) isEnterprise = true;
        // Detect invisible mode: data-size="invisible" or no visible checkbox iframe
        const isInvisible = hcaptchaEl.getAttribute("data-size") === "invisible";
        if (sitekey) return { type: "hcaptcha", sitekey, isEnterprise, isInvisible };
      }

      // reCAPTCHA v2 — use specific selectors to avoid matching hCaptcha
      const recaptchaEl = document.querySelector(".g-recaptcha, iframe[src*='recaptcha'], iframe[src*='google.com/recaptcha']");
      if (recaptchaEl) {
        const sitekey = recaptchaEl.getAttribute("data-sitekey") ||
          (document.querySelector("iframe[src*='recaptcha']") as HTMLIFrameElement)?.src?.match(/k=([^&]+)/)?.[1] || "";
        if (sitekey) return { type: "recaptcha_v2", sitekey };
      }

      // Cloudflare Turnstile
      const turnstileEl = document.querySelector(".cf-turnstile, [data-turnstile-sitekey], iframe[src*='challenges.cloudflare.com']");
      if (turnstileEl) {
        const sitekey = turnstileEl.getAttribute("data-sitekey") || turnstileEl.getAttribute("data-turnstile-sitekey") || "";
        const action = turnstileEl.getAttribute("data-action") || undefined;
        const cdata = turnstileEl.getAttribute("data-cdata") || undefined;
        if (sitekey) return { type: "turnstile", sitekey, action, cdata };
      }

      // Fallback: check iframes for captcha
      const iframes = Array.from(document.querySelectorAll("iframe"));
      for (const iframe of iframes) {
        const src = iframe.src || "";
        if (src.includes("recaptcha") || src.includes("google.com/recaptcha")) {
          const key = src.match(/k=([^&]+)/)?.[1] || "";
          if (key) return { type: "recaptcha_v2", sitekey: key };
        }
        if (src.includes("hcaptcha.com")) {
          const key = src.match(/sitekey=([^&]+)/)?.[1] || "";
          if (key) return { type: "hcaptcha", sitekey: key };
        }
        if (src.includes("challenges.cloudflare.com")) {
          return { type: "turnstile", sitekey: "" };
        }
      }

      return null;
    });

    if (result) {
      return {
        ...result,
        pageUrl: page.url(),
      } as CaptchaInfo;
    }
    return null;
  } catch (err) {
    console.log(`[CAPTCHA] Detection error: ${(err as Error).message?.slice(0, 60)}`);
    return null;
  }
}

// ── CapSolver Provider ──

async function solveViaCapSolver(info: CaptchaInfo, apiKey: string): Promise<string | null> {
  console.log(`[CAPTCHA] Submitting ${info.type} (sitekey: ${info.sitekey.slice(0, 20)}...) to CapSolver`);

  // Build task based on CAPTCHA type
  let task: Record<string, any>;
  switch (info.type) {
    case "recaptcha_v2":
      task = {
        type: "ReCaptchaV2TaskProxyLess",
        websiteURL: info.pageUrl,
        websiteKey: info.sitekey,
      };
      break;
    case "hcaptcha":
      task = {
        type: "HCaptchaTaskProxyLess",
        websiteURL: info.pageUrl,
        websiteKey: info.sitekey,
      };
      break;
    case "turnstile":
      task = {
        type: "AntiTurnstileTaskProxyLess",
        websiteURL: info.pageUrl,
        websiteKey: info.sitekey,
        metadata: { action: info.action, cdata: info.cdata },
      };
      break;
    default:
      console.log(`[CAPTCHA] Unsupported type: ${info.type}`);
      return null;
  }

  try {
    // 1. Create task
    const createRes = await fetch(`${CAPSOLVER_API}/createTask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientKey: apiKey, task }),
    });
    const createData = await createRes.json() as any;

    if (createData.errorId && createData.errorId !== 0) {
      console.log(`[CAPTCHA] CapSolver create error: ${createData.errorCode} — ${createData.errorDescription}`);
      return null;
    }

    const taskId = createData.taskId;
    if (!taskId) {
      // Some tasks return solution immediately (e.g. ReCaptchaV2)
      if (createData.solution?.gRecaptchaResponse) return createData.solution.gRecaptchaResponse;
      if (createData.solution?.token) return createData.solution.token;
      console.log(`[CAPTCHA] CapSolver no taskId: ${JSON.stringify(createData).slice(0, 200)}`);
      return null;
    }

    console.log(`[CAPTCHA] CapSolver task created: ${taskId}`);

    // 2. Poll for result
    const maxWaitMs = 120000;
    const pollInterval = 3000;
    const startTime = Date.now();
    await new Promise(r => setTimeout(r, 5000)); // initial wait

    while (Date.now() - startTime < maxWaitMs) {
      const pollRes = await fetch(`${CAPSOLVER_API}/getTaskResult`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientKey: apiKey, taskId }),
      });
      const pollData = await pollRes.json() as any;

      if (pollData.status === "ready") {
        const token = pollData.solution?.gRecaptchaResponse || pollData.solution?.token || null;
        if (token) {
          console.log(`[CAPTCHA] CapSolver solved in ${Math.round((Date.now() - startTime) / 1000)}s`);
          return token;
        }
      }

      if (pollData.errorId && pollData.errorId !== 0) {
        console.log(`[CAPTCHA] CapSolver poll error: ${pollData.errorCode}`);
        return null;
      }

      // Still processing
      await new Promise(r => setTimeout(r, pollInterval));
    }

    console.log(`[CAPTCHA] CapSolver timed out after ${maxWaitMs / 1000}s`);
    return null;
  } catch (err: any) {
    console.log(`[CAPTCHA] CapSolver error: ${err.message || err}`);
    return null;
  }
}

// ── 2Captcha Provider ──

async function solveVia2Captcha(info: CaptchaInfo, apiKey: string): Promise<string | null> {
  console.log(`[CAPTCHA] Submitting ${info.type} (sitekey: ${info.sitekey.slice(0, 20)}...) to 2Captcha`);
  const solver = new Solver(apiKey);

  try {
    let result: any;
    switch (info.type) {
      case "recaptcha_v2":
        result = await solver.recaptcha({
          pageurl: info.pageUrl,
          googlekey: info.sitekey,
        });
        break;
      case "hcaptcha":
        result = await solver.hcaptcha({
          pageurl: info.pageUrl,
          sitekey: info.sitekey,
        });
        break;
      case "turnstile":
        result = await solver.cloudflareTurnstile({
          pageurl: info.pageUrl,
          sitekey: info.sitekey,
          action: info.action,
          data: info.cdata,
        });
        break;
      default:
        console.log(`[CAPTCHA] Unsupported type: ${info.type}`);
        return null;
    }

    if (result?.data) {
      console.log(`[CAPTCHA] 2Captcha solved successfully`);
      return result.data;
    }
    console.log(`[CAPTCHA] No solution in response: ${JSON.stringify(result)}`);
    return null;
  } catch (err: any) {
    console.log(`[CAPTCHA] 2Captcha error: ${err.message || err}`);
    return null;
  }
}

// ── Anti-Captcha Provider ──

async function solveViaAntiCaptcha(info: CaptchaInfo, apiKey: string): Promise<string | null> {
  console.log(`[CAPTCHA] Submitting ${info.type} (sitekey: ${info.sitekey.slice(0, 20)}...) to Anti-Captcha`);

  let task: Record<string, any>;
  switch (info.type) {
    case "recaptcha_v2":
      task = {
        type: "RecaptchaV2TaskProxyless",
        websiteURL: info.pageUrl,
        websiteKey: info.sitekey,
      };
      break;
    case "hcaptcha":
      task = {
        type: "HCaptchaTaskProxyless",
        websiteURL: info.pageUrl,
        websiteKey: info.sitekey,
        isEnterprise: info.isEnterprise || false,
        isInvisible: info.isInvisible || false,
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        ...(info.rqdata ? { enterprisePayload: { rqdata: info.rqdata } } : {}),
      };
      console.log(`[CAPTCHA] hCaptcha enterprise: ${info.isEnterprise || false}, invisible: ${info.isInvisible || false}, rqdata: ${info.rqdata ? info.rqdata.slice(0, 30) + '...' : 'none'}`);
      break;
    case "turnstile":
      task = {
        type: "TurnstileTaskProxyless",
        websiteURL: info.pageUrl,
        websiteKey: info.sitekey,
      };
      break;
    default:
      console.log(`[CAPTCHA] Unsupported type: ${info.type}`);
      return null;
  }

  // Race 2 parallel tasks for reliability — solve times vary 20-180s
  const createTask = async (): Promise<number | null> => {
    try {
      const res = await fetch(`${ANTICAPTCHA_API}/createTask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientKey: apiKey, task }),
      });
      const data = await res.json() as any;
      if (data.errorId && data.errorId !== 0) {
        console.log(`[CAPTCHA] Anti-Captcha create error: ${data.errorCode}`);
        return null;
      }
      return data.taskId || null;
    } catch (e: any) {
      console.log(`[CAPTCHA] Anti-Captcha create failed: ${e.message}`);
      return null;
    }
  };

  const pollTask = async (taskId: number): Promise<string | null> => {
    try {
      const res = await fetch(`${ANTICAPTCHA_API}/getTaskResult`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientKey: apiKey, taskId }),
      });
      const data = await res.json() as any;
      if (data.status === "ready") {
        return data.solution?.gRecaptchaResponse || data.solution?.token || null;
      }
      if (data.errorId && data.errorId !== 0) return "ERROR";
      return null;
    } catch { return null; }
  };

  try {
    const startTime = Date.now();
    const maxWaitMs = 240000; // 4 min max

    // Start first task immediately
    const taskId1 = await createTask();
    if (!taskId1) return null;
    console.log(`[CAPTCHA] Anti-Captcha task #1 created: ${taskId1}`);

    let taskId2: number | null = null;
    const taskIds: number[] = [taskId1];

    await new Promise(r => setTimeout(r, 5000));

    while (Date.now() - startTime < maxWaitMs) {
      // Start second task after 45s if first hasn't solved
      if (!taskId2 && Date.now() - startTime > 45000) {
        taskId2 = await createTask();
        if (taskId2) {
          console.log(`[CAPTCHA] Anti-Captcha task #2 created: ${taskId2} (racing)`);
          taskIds.push(taskId2);
        }
      }

      // Poll all active tasks
      for (const tid of taskIds) {
        const token = await pollTask(tid);
        if (token && token !== "ERROR") {
          console.log(`[CAPTCHA] Anti-Captcha solved in ${Math.round((Date.now() - startTime) / 1000)}s`);
          return token;
        }
      }

      await new Promise(r => setTimeout(r, 5000));
    }

    console.log(`[CAPTCHA] Anti-Captcha timed out after ${maxWaitMs / 1000}s`);
    return null;
  } catch (err: any) {
    console.log(`[CAPTCHA] Anti-Captcha error: ${err.message || err}`);
    return null;
  }
}

// ── Multi-Provider Dispatcher ──

/** Solve CAPTCHA using best available provider for the specific CAPTCHA type. */
async function solveCaptchaViaProvider(info: CaptchaInfo): Promise<string | null> {
  const providers = getProvidersForType(info.type);
  if (providers.length === 0) {
    console.log("[CAPTCHA] No API key set (CAPSOLVER_API_KEY, ANTICAPTCHA_API_KEY, TWOCAPTCHA_API_KEY)");
    return null;
  }

  for (const config of providers) {
    let token: string | null = null;
    switch (config.provider) {
      case "capsolver":  token = await solveViaCapSolver(info, config.apiKey); break;
      case "anticaptcha": token = await solveViaAntiCaptcha(info, config.apiKey); break;
      case "2captcha":   token = await solveVia2Captcha(info, config.apiKey); break;
    }
    if (token) return token;
    if (providers.length > 1) console.log(`[CAPTCHA] ${config.provider} failed — trying next provider`);
  }
  return null;
}

// ── Solution Injection ──

/** Inject CAPTCHA solution token into the page */
export async function injectSolution(page: any, info: CaptchaInfo, token: string): Promise<boolean> {
  try {
    switch (info.type) {
      case "recaptcha_v2":
        await page.evaluate((t: string) => {
          // Set textarea
          const textarea = document.getElementById("g-recaptcha-response") as HTMLTextAreaElement;
          if (textarea) {
            textarea.style.display = "block";
            textarea.value = t;
          }
          // Also set any hidden textareas in iframes
          document.querySelectorAll("textarea[name='g-recaptcha-response']").forEach((el: any) => {
            el.value = t;
          });
          // Trigger callback if available
          if (typeof (window as any).___grecaptcha_cfg !== "undefined") {
            const clients = (window as any).___grecaptcha_cfg?.clients;
            if (clients) {
              for (const key of Object.keys(clients)) {
                try {
                  const client = clients[key];
                  // Find callback in nested objects
                  const findCallback = (obj: any, depth = 0): any => {
                    if (depth > 5 || !obj) return null;
                    if (typeof obj === "function") return obj;
                    if (typeof obj === "object") {
                      for (const k of Object.keys(obj)) {
                        if (k === "callback" && typeof obj[k] === "function") return obj[k];
                        const found = findCallback(obj[k], depth + 1);
                        if (found) return found;
                      }
                    }
                    return null;
                  };
                  const cb = findCallback(client);
                  if (cb) cb(t);
                } catch { /* */ }
              }
            }
          }
        }, token);
        console.log("[CAPTCHA] reCAPTCHA solution injected");
        return true;

      case "hcaptcha":
        await page.evaluate(`(function(t) {
          // 1. Set all response textareas and hidden inputs
          document.querySelectorAll("textarea[name='h-captcha-response'], textarea[name='g-recaptcha-response']").forEach(function(el) {
            el.value = t;
          });

          // 2. Add/update hidden inputs inside form
          var form = document.querySelector("form");
          if (form) {
            form.querySelectorAll("input.__captcha_injected").forEach(function(e) { e.remove(); });
            ["h-captcha-response", "g-recaptcha-response"].forEach(function(nm) {
              var existing = form.querySelector("input[name='" + nm + "']");
              if (existing) { existing.value = t; }
              else {
                var inp = document.createElement("input");
                inp.type = "hidden"; inp.name = nm; inp.value = t;
                inp.className = "__captcha_injected";
                form.appendChild(inp);
              }
            });
          }

          // 3. Try to call hCaptcha's internal callback to properly register token in session
          // This is more reliable than overriding getResponse() because it fires the
          // same event handler that hCaptcha fires after a real solve.
          var hc = window.hcaptcha;
          if (hc) {
            // Try internal callback first (fires proper session registration)
            try {
              var cbAttr = document.querySelector(".h-captcha[data-callback]");
              var cbName = cbAttr ? cbAttr.getAttribute("data-callback") : null;
              if (cbName && window[cbName]) { window[cbName](t); }
            } catch(e) {}
            // Try setResponse on each widget
            try {
              document.querySelectorAll(".h-captcha, [data-hcaptcha-widget-id]").forEach(function(c) {
                var wid = c.getAttribute("data-hcaptcha-widget-id");
                if (wid != null) try { hc.setResponse(wid, t); } catch(e2) {}
              });
              try { hc.setResponse(0, t); } catch(e) {}
            } catch(e) {}
            // Override getResponse as final fallback
            hc.getResponse = function() { return t; };
            hc.getRespKey = function() { return t; };
            hc.execute = function() { return Promise.resolve({ response: t, key: t }); };
          }
          if (window.grecaptcha) {
            window.grecaptcha.getResponse = function() { return t; };
          }

          // 4. Remove hCaptcha challenge iframes to prevent visual challenge on submit
          document.querySelectorAll('iframe[src*="hcaptcha"]').forEach(function(f) { f.remove(); });

        })("${token.replace(/"/g, '\\"')}")`);
        console.log("[CAPTCHA] hCaptcha solution injected");
        return true;

      case "turnstile":
        await page.evaluate((t: string) => {
          // Set Turnstile response
          const inputs = document.querySelectorAll("input[name='cf-turnstile-response'], input[name='cf_turnstile_response']");
          inputs.forEach((el: any) => { el.value = t; });
          // Try Turnstile API callback
          if (typeof (window as any).turnstile !== "undefined") {
            try {
              const widgets = document.querySelectorAll(".cf-turnstile");
              widgets.forEach((w: any) => {
                const widgetId = w.getAttribute("data-widget-id");
                if (widgetId) {
                  // Turnstile doesn't expose setResponse, but the callback should fire
                }
              });
            } catch { /* */ }
          }
        }, token);
        console.log("[CAPTCHA] Turnstile solution injected");
        return true;

      default:
        return false;
    }
  } catch (err) {
    console.log(`[CAPTCHA] Injection error: ${(err as Error).message?.slice(0, 60)}`);
    return false;
  }
}

/**
 * Install a passive listener to capture hCaptcha's rqdata (session-specific HSW challenge JWT).
 * MUST be called right after page creation, BEFORE page.goto(), so checksiteconfig is captured.
 * Stores rqdata on page.__hcaptchaRqdata for use by solveCaptcha().
 */
export function installHCaptchaCapture(page: any): void {
  page.on("response", async (response: any) => {
    try {
      const url = response.url();
      if (!url.includes("hcaptcha.com") || !url.includes("checksiteconfig")) return;
      const body = await response.text().catch(() => "");
      if (!body) return;
      const json = JSON.parse(body);
      if (json?.c?.req) {
        page.__hcaptchaRqdata = json.c.req as string;
        console.log(`[CAPTCHA] rqdata captured from checksiteconfig (len=${(page.__hcaptchaRqdata as string).length})`);
      }
    } catch { /* */ }
  });
}

// ── hCaptcha Network Intercept ──
//
// Strategy: intercept api.hcaptcha.com/checkcaptcha responses at the browser
// context level. The real browser runs HSW proof-of-work natively (giving the
// token Lever's server trusts), but we swap in a pre-solved Anti-Captcha token
// so the image-challenge step is bypassed.
//
// Flow:
//  1. Install route intercept on hcaptcha **/checkcaptcha** BEFORE hCaptcha loads
//  2. Start solving via Anti-Captcha in parallel (takes 20-60s)
//  3. When the browser's hCaptcha iframe fires checkcaptcha, we intercept the
//     response and return our Anti-Captcha token in the expected shape
//  4. hCaptcha widget fires its callback with our token → form submits normally

async function solveHCaptchaWithIntercept(page: any, info: CaptchaInfo, providerCfg: ProviderConfig): Promise<CaptchaSolution> {
  const startTime = Date.now();

  console.log("[CAPTCHA] Using network-intercept strategy for hCaptcha");

  let interceptedToken: string | null = null;
  const ctx = page.context();

  // Step 1: Click the checkbox FIRST so hCaptcha fires a fresh checksiteconfig
  // with a new session-specific rqdata JWT. We must use THIS rqdata when submitting
  // to Anti-Captcha, not the stale one from page load.
  let checkboxClicked = false;
  try {
    await page.waitForTimeout(1500);
    const frames = page.frames();
    const checkboxFrame = frames.find((f: any) => f.url().includes("hcaptcha") && f.url().includes("checkbox"));
    if (checkboxFrame) {
      console.log("[CAPTCHA] Clicking hCaptcha checkbox to trigger fresh checksiteconfig...");
      for (const sel of ["#checkbox", ".checkbox", "[aria-checked]"]) {
        try {
          await checkboxFrame.waitForSelector(sel, { timeout: 3000 });
          await checkboxFrame.click(sel);
          console.log(`[CAPTCHA] Checkbox clicked (${sel})`);
          checkboxClicked = true;
          break;
        } catch { continue; }
      }
    }
  } catch { /* */ }

  // Wait for the fresh checksiteconfig response to update page.__hcaptchaRqdata
  // (installHCaptchaCapture listener will overwrite it with the new rqdata)
  if (checkboxClicked) {
    await page.waitForTimeout(2500);
  } else {
    // Invisible mode fallback — call execute() to trigger checksiteconfig
    await page.evaluate(`(function() {
      var hc = window.hcaptcha;
      if (hc && hc.execute) { try { hc.execute(); } catch(e) {} }
    })()`);
    await page.waitForTimeout(2000);
  }

  // Step 2: Read the FRESH rqdata (updated by checkbox click → new checksiteconfig)
  const capturedRqdata: string | null = page.__hcaptchaRqdata || null;
  if (capturedRqdata) {
    console.log(`[CAPTCHA] Using fresh rqdata (len=${capturedRqdata.length})`);
  } else {
    console.log("[CAPTCHA] No rqdata available — proceeding without it");
  }

  // Step 3: Start Anti-Captcha NOW with the fresh session-specific rqdata
  const infoWithRqdata: CaptchaInfo = capturedRqdata ? { ...info, rqdata: capturedRqdata } : info;
  const tokenPromise: Promise<string | null> = (providerCfg.provider === "anticaptcha"
    ? solveViaAntiCaptcha(infoWithRqdata, providerCfg.apiKey)
    : providerCfg.provider === "capsolver"
      ? solveViaCapSolver(infoWithRqdata, providerCfg.apiKey)
      : solveVia2Captcha(infoWithRqdata, providerCfg.apiKey)
  );

  // Intercept checkcaptcha: substitute our Anti-Captcha token into the response
  const checkcaptchaHandler = async (route: any) => {
    const url = route.request().url();
    console.log(`[CAPTCHA] Intercepted checkcaptcha: ${url.slice(0, 80)}`);

    const token = interceptedToken || await Promise.race([
      tokenPromise,
      new Promise<null>(r => setTimeout(() => r(null), 120000)),
    ]);

    if (!token) {
      console.log("[CAPTCHA] Token not ready for checkcaptcha — letting through");
      await route.continue();
      return;
    }

    interceptedToken = token;
    const resp = JSON.stringify({
      generated_pass_UUID: token,
      c: { type: "hsw", req: "" },
      pass: true,
      expiration: 120,
    });

    console.log(`[CAPTCHA] checkcaptcha: injecting token (len=${token.length})`);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: resp,
    });
  };

  await ctx.route("**/*hcaptcha.com**/checkcaptcha**", checkcaptchaHandler);

  // Wait for checkcaptcha intercept to fire (browser runs HSW then fires checkcaptcha)
  const token = await Promise.race([
    new Promise<string | null>(r => {
      const check = setInterval(() => {
        if (interceptedToken) { clearInterval(check); r(interceptedToken); }
      }, 500);
      setTimeout(() => { clearInterval(check); r(null); }, 60000);
    }),
    tokenPromise,
  ]);

  // Clean up route handlers
  await ctx.unroute("**/*hcaptcha.com**/checkcaptcha**", checkcaptchaHandler).catch(() => {});

  const finalToken = interceptedToken || token;

  if (!finalToken) {
    return { success: false, error: "hCaptcha solve timed out (intercept + direct both failed)", type: "hcaptcha" };
  }

  // Belt-and-suspenders: also inject into DOM fields
  await injectSolution(page, info, finalToken);

  const solveTimeMs = Date.now() - startTime;
  const method = interceptedToken ? "network-intercept" : "direct-inject";
  console.log(`[CAPTCHA] ✅ hcaptcha solved via ${method} (${Math.round(solveTimeMs / 1000)}s)`);
  return { success: true, token: finalToken, type: "hcaptcha", solveTimeMs };
}

// ── High-Level API ──

/** Detect, solve, and inject CAPTCHA solution. Returns true if solved. */
export async function solveCaptcha(page: any): Promise<CaptchaSolution> {
  const startTime = Date.now();

  // 1. Detect
  const info = await detectCaptcha(page);
  if (!info) {
    return { success: false, error: "No CAPTCHA detected", type: "unknown" };
  }

  if (!info.sitekey) {
    return { success: false, error: `${info.type} detected but no sitekey found`, type: info.type };
  }

  const provider = getProviderForType(info.type);
  if (!provider) {
    return { success: false, error: `No CAPTCHA API key for ${info.type} (set ANTICAPTCHA_API_KEY for hCaptcha, CAPSOLVER_API_KEY for reCAPTCHA)`, type: info.type };
  }

  console.log(`[CAPTCHA] Detected ${info.type} on ${info.pageUrl.slice(0, 60)} — using ${provider.provider}`);

  // 2. For hCaptcha: use network-intercept strategy (browser HSW + external token)
  if (info.type === "hcaptcha") {
    return solveHCaptchaWithIntercept(page, info, provider);
  }

  // 3. For reCAPTCHA / Turnstile: solve via provider then inject
  const token = await solveCaptchaViaProvider(info);
  if (!token) {
    return { success: false, error: "CAPTCHA solving failed or timed out", type: info.type };
  }

  const injected = await injectSolution(page, info, token);
  if (!injected) {
    return { success: false, error: "Failed to inject CAPTCHA solution into page", type: info.type, token };
  }

  const solveTimeMs = Date.now() - startTime;
  console.log(`[CAPTCHA] ✅ ${info.type} solved and injected (${Math.round(solveTimeMs / 1000)}s)`);

  return { success: true, token, type: info.type, solveTimeMs };
}

/** Check if CAPTCHA solving is available (any provider key configured) */
export function isCaptchaSolverAvailable(): boolean {
  return !!(process.env.CAPSOLVER_API_KEY || process.env.ANTICAPTCHA_API_KEY || process.env.ANTI_CAPTCHA_API_KEY || process.env.TWOCAPTCHA_API_KEY || process.env.CAPTCHA_API_KEY);
}
