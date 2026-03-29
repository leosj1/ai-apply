// AI-Driven Adaptive Auto-Apply Agent
// Main entry point — orchestrates the AI loop.
// Supports Claude (preferred) and OpenAI (fallback) for vision + tool use.

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { AgentContext, AgentResult, AgentAIClient } from "./types";
import { getClaudeTools, getOpenAITools } from "./tools";
import { getPageState, safeScreenshot, resetScreenshotFailCount } from "./page-state";
import { executeTool } from "./tool-executor";
import { buildSystemPrompt } from "./prompt";
import { runPreprocessing } from "./preprocessing";

// Re-export types for consumers
export type { AgentContext, AgentResult, AgentAIClient } from "./types";

// ── Submission Verification ──
// Independently checks the page DOM/URL for real confirmation signals.
// Called before accepting any report_status("success") — agent's word alone is not enough.
async function verifySubmissionOnPage(page: any): Promise<{ confirmed: boolean; evidence: string }> {
  try {
    const result = await page.evaluate(() => {
      const url = window.location.href;
      const body = (document.body?.innerText || "").toLowerCase();

      // 1. URL patterns that indicate confirmed submission
      const confirmUrlPatterns = [
        /\/confirmation/, /\/thank[-_]?you/, /\/thanks/, /\/submitted/,
        /\/apply\/success/, /\/application[-_]?(complete|done|success)/,
        /confirmation=true/, /applied=true/, /\/done\b/, /\/success\b/,
        /jobvite.*thank/, /\/greenhouse.*confirm/, /lever.*thank/,
      ];
      const urlMatch = confirmUrlPatterns.find(p => p.test(url));
      if (urlMatch) return { confirmed: true, evidence: `Confirmation URL: ${url.slice(0, 120)}` };

      // 2. Text patterns — must be meaningful (≥20 chars of context)
      const confirmTextPatterns = [
        /application\s+(has been|was|is)\s+(successfully\s+)?(submitted|received|complete)/i,
        /thank\s+you\s+for\s+(applying|your\s+application|submitting)/i,
        /your\s+(job\s+)?application\s+(has been|was)\s+(successfully\s+)?(submitted|received)/i,
        /we.{0,30}received\s+your\s+application/i,
        /application\s+submitted\s+successfully/i,
        /successfully\s+applied/i,
        /you.{0,20}have\s+(applied|submitted)/i,
        /we.{0,20}(will\s+)?(review|be\s+in\s+touch|contact\s+you).{0,50}(application|resume|background)/i,
        /application\s+number\s*[:#]?\s*\d+/i,
        /reference\s+(number|id|code)\s*[:#]?\s*[\w-]+/i,
        /confirmation\s+(number|id|code)\s*[:#]?\s*[\w-]+/i,
      ];
      const textMatch = confirmTextPatterns.find(p => p.test(body));
      if (textMatch) {
        const match = (document.body?.innerText || "").match(textMatch);
        return { confirmed: true, evidence: (match ? match[0] : "Confirmation text found").slice(0, 120) };
      }

      return { confirmed: false, evidence: "" };
    });
    return result;
  } catch {
    return { confirmed: false, evidence: "" };
  }
}

// Normalize action key for loop detection — collapses fill_field selector variants
// (e.g. textarea#uuid, input#uuid, #uuid all → same key)
function normalizeActionKey(fnName: string, fnArgs: any): string {
  // For all selector-based tools, normalize selector for loop detection
  // This prevents agents from bypassing loop detection by using selector variants
  if ((fnName === "fill_field" || fnName === "check_checkbox" || fnName === "click_element" || fnName === "select_option") && fnArgs?.selector) {
    const sel: string = fnArgs.selector;

    // For radio/checkbox selectors with a name attribute, preserve it to differentiate
    // different form fields (e.g. Ashby has many radio[value="Yes"] for different questions)
    const nameMatch = sel.match(/\[name=["']?([^"'\]]+)["']?\]/);
    if (nameMatch && /type=["']?(radio|checkbox)["']?/.test(sel)) {
      const nameNorm = nameMatch[1].replace(/[^a-zA-Z0-9]/g, "").toLowerCase().slice(0, 60);
      const valMatch = sel.match(/\[value=["']?([^"'\]]+)["']?\]/);
      const valNorm = valMatch ? valMatch[1].replace(/[^a-zA-Z0-9]/g, "").toLowerCase().slice(0, 30) : "";
      return `${fnName}:${nameNorm}${valNorm ? "_" + valNorm : ""}`;
    }

    // Strip tag prefix, leading #, attribute wrappers, and special chars to get stable ID
    const normalized = sel
      .replace(/^[a-zA-Z][a-zA-Z0-9]*(?=[#\[.])/, "")  // strip tag prefix (input#, textarea#)
      .replace(/^#/, "")                                   // strip leading #
      .replace(/\[[a-zA-Z-_]+[*^$]?=["']?([^"'\]]+)["']?\]/g, '$1') // extract attribute value
      .replace(/[^a-zA-Z0-9]/g, "")                      // remove all non-alphanumeric
      .toLowerCase()
      .slice(0, 80);
    return `${fnName}:${normalized}`; // value/description excluded — same element = same key
  }
  return `${fnName}:${JSON.stringify(fnArgs).slice(0, 100)}`;
}

// ── Claude Agent Loop ──

async function runClaudeLoop(
  client: any,
  page: any,
  rootPage: any,
  ctx: AgentContext,
  systemPrompt: string,
  steps: string[],
  screenshots: { step: string; screenshot: string }[],
  browserContext: any,
  agentStartTime: number,
): Promise<AgentResult> {
  const MAX_ITERATIONS = 40;
  const AGENT_TIMEOUT_MS = 12 * 60 * 1000; // 12min — Workday needs auth + multi-page form
  let iterations = 0;
  const fieldAttempts = new Map<string, number>();
  const recentActions: string[] = []; // Track recent tool calls for loop detection
  let anyLoopDetected = false; // Set when loop detected — bypasses early give-up
  let consecutiveLoopedIters = 0; // Count iterations where ALL calls were loop-detected
  const tools = getClaudeTools();

  // Claude messages (no system message in array — passed as top-level param)
  const messages: any[] = [];

  // Initial page state
  const initialState = await getPageState(page, rootPage);
  screenshots.push({ step: "1. Initial page state", screenshot: initialState.screenshot });
  steps.push(`Page loaded: ${initialState.title}`);

  const userContent: any[] = [
    {
      type: "text",
      text: `I've navigated to the job application page.\n\nURL: ${initialState.url}\nTitle: ${initialState.title}\n\nVisible text:\n${initialState.visibleText.slice(0, 500)}\n\nInteractive elements:\n${initialState.simplifiedHtml.slice(0, 3000)}\n\nAnalyze the page and start filling out the application.`,
    },
  ];
  if (initialState.screenshot && initialState.screenshot.length > 100) {
    userContent.push({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: initialState.screenshot },
    });
  }
  messages.push({ role: "user", content: userContent });

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    if (Date.now() - agentStartTime > AGENT_TIMEOUT_MS) {
      console.log(`[AI-Agent] Hard timeout at iteration ${iterations}`);
      try { const ss = await safeScreenshot(rootPage || page); screenshots.push({ step: "Timeout", screenshot: ss }); } catch { /* */ }
      return {
        success: false, platform: "ai-agent",
        message: `AI agent timed out after ${Math.round((Date.now() - agentStartTime) / 1000)}s.`,
        stepsCompleted: steps, screenshotSteps: screenshots,
        confirmationDetected: false, confirmationText: "", iterationsUsed: iterations,
      };
    }

    console.log(`[AI-Agent] Claude iteration ${iterations}/${MAX_ITERATIONS}`);

    // Truncate old messages to prevent context overflow
    // Keep only the latest image, truncate old text blocks
    let foundLatestImg = false;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === "user" && Array.isArray(msg.content)) {
        if (!foundLatestImg && msg.content.some((c: any) => c.type === "image")) {
          foundLatestImg = true;
        } else if (foundLatestImg) {
          msg.content = msg.content
            .filter((c: any) => c.type !== "image")
            .map((c: any) => {
              if (c.type === "text" && c.text.length > 800) {
                return { type: "text", text: c.text.slice(0, 800) + "\n[...truncated...]" };
              }
              return c;
            });
        }
      }
    }

    let response;
    try {
      response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        system: systemPrompt,
        tools,
        messages,
      });
    } catch (apiErr: any) {
      if (apiErr?.status === 429) {
        console.log(`[AI-Agent] Claude rate limited, waiting 10s...`);
        await page.waitForTimeout(10000);
        response = await client.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2000,
          system: systemPrompt,
          tools,
          messages,
        });
      } else {
        throw apiErr;
      }
    }

    // Add assistant response to messages
    messages.push({ role: "assistant", content: response.content });

    // Extract tool use blocks
    const toolUseBlocks = response.content.filter((b: any) => b.type === "tool_use");
    const textBlocks = response.content.filter((b: any) => b.type === "text");

    // If no tool calls and stop_reason is end_turn, verify DOM before accepting
    if (toolUseBlocks.length === 0) {
      const domCheck = await verifySubmissionOnPage(page);
      if (domCheck.confirmed) {
        return {
          success: true, platform: "ai-agent",
          message: textBlocks.map((b: any) => b.text).join(" ").slice(0, 500),
          stepsCompleted: steps, screenshotSteps: screenshots,
          confirmationDetected: true, confirmationText: domCheck.evidence,
          iterationsUsed: iterations,
        };
      }
      messages.push({
        role: "user",
        content: [{ type: "text", text: "Please continue with the application or call report_status if you're done." }],
      });
      continue;
    }

    // Execute tool calls and build tool_result blocks
    const toolResultContent: any[] = [];
    let statusReported: { status: string; message: string; confirmationText?: string } | null = null;
    let loopedThisIter = 0;
    let totalThisIter = 0;

    for (const block of toolUseBlocks) {
      totalThisIter++;
      const fnName = block.name;
      const fnArgs = block.input || {};
      const actionKey = `${fnName}:${JSON.stringify(fnArgs).slice(0, 100)}`;

      const normalizedKey = normalizeActionKey(fnName, fnArgs);
      console.log(`[AI-Agent] Tool call: ${fnName}(${JSON.stringify(fnArgs).slice(0, 200)})`);
      recentActions.push(normalizedKey);

      // Loop detection: only block THIS action if it appears too many times in last 15
      // Generic selectors (short normalized keys) get a higher threshold to avoid false positives
      if (recentActions.length > 30) recentActions.splice(0, recentActions.length - 30);
      const thisActionCount = recentActions.slice(-15).filter(a => a === normalizedKey).length;
      const keyParts = normalizedKey.split(":");
      const selectorPart = keyParts.length > 1 ? keyParts[1] : "";
      const isGenericSelector = selectorPart.length < 12 || /^(submit|apply|next|continue|save|text|email|tel|search|button)$/i.test(selectorPart);
      const loopThreshold = isGenericSelector ? 5 : 3;
      if (thisActionCount >= loopThreshold) {
        anyLoopDetected = true;
        loopedThisIter++;
        console.log(`[AI-Agent] Loop detected: "${normalizedKey.slice(0, 60)}" appeared ${thisActionCount}x (threshold ${loopThreshold}) — blocking this action`);
        toolResultContent.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `LOOP DETECTED: "${normalizedKey.slice(0, 60)}" failed ${thisActionCount} times. This field is OPTIONAL — stop retrying it entirely (no more selector variants). Move on immediately and click Submit/Next to continue the application.`,
        });
        continue;
      }

      if (fnName === "report_status") {
        const terminalMsg = (fnArgs.message || fnArgs.confirmationText || "").toLowerCase();
        const isTerminalState = /spam|flagged|duplicate|already applied|already submitted|blacklist|expired|no longer (available|exists)|job (has been|is) closed|position.*filled|not accepting|does not exist|job not found|listing.*closed|been filled|page not found|404|this job.*no longer|no longer open/i.test(terminalMsg);
        const isEarlyGiveUp = fnArgs.status !== "success" && iterations < 12 && !anyLoopDetected && !isTerminalState;
        if (isEarlyGiveUp) {
          console.log(`[AI-Agent] Blocked early report_status("${fnArgs.status}") at iteration ${iterations}`);
          toolResultContent.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: `REJECTED: You cannot report "${fnArgs.status}" yet — only used ${iterations}/${MAX_ITERATIONS} iterations. Keep trying: scroll down to find ALL form fields, fill checkbox groups and radio buttons with reasonable choices, then solve CAPTCHA and submit.`,
          });
        } else {
          // Validate false success
          if (fnArgs.status === "success") {
            const msg = (fnArgs.message || "").toLowerCase();
            const failureIndicators = ["couldn't", "could not", "failed", "manual", "not submitted", "not filled", "missing required", "unable to", "expired", "disabled", "cannot be submitted", "no longer", "does not exist", "not found", "not open"];
            if (failureIndicators.some((f: string) => msg.includes(f))) {
              console.log(`[AI-Agent] Overriding false success: "${fnArgs.message.slice(0, 80)}"`);
              fnArgs.status = "needs_manual";
            }
          }
          statusReported = fnArgs;
          toolResultContent.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: "Status reported. Agent loop will end.",
          });
        }
      } else {
        const result = await executeTool(page, fnName, fnArgs, ctx, steps, screenshots, browserContext, fieldAttempts, rootPage);
        if (typeof result === "object" && result.newPage) {
          page = result.newPage;
          toolResultContent.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: result.result,
          });
        } else {
          toolResultContent.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: typeof result === "string" ? result : result.result,
          });
        }
        // Reset loop detection after navigation so prior field attempts don't persist across page loads
        if (fnName === "navigate_to") recentActions.splice(0);
      }
    }

    // Escalate when all tool calls were loop-detected
    if (totalThisIter > 0 && loopedThisIter === totalThisIter) {
      consecutiveLoopedIters++;
      // After 2 consecutive fully-looped iterations, inject a strong "just submit" instruction
      if (consecutiveLoopedIters === 2) {
        console.log(`[AI-Agent] Escalating: injecting forced-submit instruction after ${consecutiveLoopedIters} looped iterations (Claude)`);
        toolResultContent.push({
          type: "text",
          text: "CRITICAL: You have been looping on optional fields. STOP trying to fill any more fields. The remaining unfilled fields are OPTIONAL. Your ONLY next action must be to click the Submit/Apply/Save button to submit the application. Try these selectors in order: button[type='submit'], input[type='submit'], button:has-text('Submit Application'), button:has-text('Submit'), button:has-text('Apply'), button:has-text('Save and Continue'), [data-automation-id='nextButton'], button.btn-success, button:has-text('Send Application'), button:has-text('Complete'), a:has-text('Submit'). If submit succeeds, call report_status('success'). If you see validation errors, report_status('needs_manual') with the error text.",
        });
      }
      if (consecutiveLoopedIters >= 4) {
        console.log(`[AI-Agent] Force terminating: ${consecutiveLoopedIters} consecutive fully-looped iterations (Claude)`);
        // Aggressive submit attempt before giving up — try many selectors
        let submitClicked = false;
        const submitSelectors = [
          "button[type='submit']", "input[type='submit']",
          "button:has-text('Submit Application')", "button:has-text('Submit')",
          "button:has-text('Apply')", "button:has-text('Apply Now')",
          "button:has-text('Send Application')", "button:has-text('Complete')",
          "button:has-text('Save and Continue')", "[data-automation-id='nextButton']",
          "button.btn-success", "a:has-text('Submit')", "a:has-text('Apply')",
          "button:has-text('Finish')", "button:has-text('Done')",
        ];
        for (const sel of submitSelectors) {
          if (submitClicked) break;
          try {
            const btn = await page.$(sel);
            if (btn) {
              await btn.scrollIntoViewIfNeeded().catch(() => {});
              await btn.click();
              await page.waitForTimeout(3000);
              submitClicked = true;
              steps.push(`Forced submit via ${sel}`);
              console.log(`[AI-Agent] Forced submit clicked: ${sel}`);
            }
          } catch { /* try next */ }
        }
        // Check if forced submit actually worked
        if (submitClicked) {
          const postSubmitCheck = await verifySubmissionOnPage(page);
          if (postSubmitCheck.confirmed) {
            try { const ss = await safeScreenshot(rootPage || page); screenshots.push({ step: `Confirmed after forced submit: ${postSubmitCheck.evidence.slice(0,80)}`, screenshot: ss }); } catch { /* */ }
            return {
              success: true, platform: "ai-agent",
              message: `Application submitted after forced submit: ${postSubmitCheck.evidence}`,
              stepsCompleted: steps, screenshotSteps: screenshots,
              confirmationDetected: true, confirmationText: postSubmitCheck.evidence, iterationsUsed: iterations,
            };
          }
        }
        try { const ss = await safeScreenshot(rootPage || page); screenshots.push({ step: "Loop termination", screenshot: ss }); } catch { /* */ }
        return {
          success: false, platform: "ai-agent",
          message: `Could not complete: ${consecutiveLoopedIters} consecutive iterations had all actions blocked by loop detection.${submitClicked ? " Attempted submit click — no confirmation detected." : ""}`,
          stepsCompleted: steps, screenshotSteps: screenshots,
          confirmationDetected: false, confirmationText: "", iterationsUsed: iterations,
        };
      }
    } else {
      consecutiveLoopedIters = 0;
    }

    if (statusReported) {
      if (statusReported.status === "success") {
        // Independently verify the page actually shows a confirmation — don't trust agent alone
        const domCheck = await verifySubmissionOnPage(page);
        if (!domCheck.confirmed) {
          console.log(`[AI-Agent] Success claimed but DOM shows no confirmation — rejecting (iter ${iterations})`);
          toolResultContent.push({
            type: "tool_result",
            tool_use_id: "verify-check",
            content: `REJECTED: You called report_status("success") but the page does NOT show a submission confirmation. Current URL: ${await page.url().catch(() => "?")}.\n\nDo NOT call success until you see text like "Thank you for applying", "Application received", "Application submitted", or a confirmation page URL. If you see validation errors, fix them and re-submit. If redirected to a new page, describe what you see.`,
          });
          messages.push({ role: "user", content: toolResultContent });
          statusReported = null;
          continue;
        }
        console.log(`[AI-Agent] Submission confirmed by DOM: "${domCheck.evidence}"`);
        try {
          const finalSs = await safeScreenshot(rootPage || page);
          screenshots.push({ step: `Confirmed: ${domCheck.evidence.slice(0, 80)}`, screenshot: finalSs });
        } catch { /* */ }
        return {
          success: true, platform: "ai-agent",
          message: statusReported.message,
          stepsCompleted: steps, screenshotSteps: screenshots,
          confirmationDetected: true, confirmationText: domCheck.evidence,
          iterationsUsed: iterations,
        };
      }
      // Non-success status (failed/needs_manual)
      try {
        const finalSs = await safeScreenshot(rootPage || page);
        screenshots.push({ step: `Final: ${statusReported.message.slice(0, 80)}`, screenshot: finalSs });
      } catch { /* */ }
      return {
        success: false, platform: "ai-agent",
        message: statusReported.message,
        stepsCompleted: steps, screenshotSteps: screenshots,
        confirmationDetected: false, confirmationText: "",
        iterationsUsed: iterations,
      };
    }

    // Get new page state and merge with tool results into ONE user message
    // Claude requires strict alternating user/assistant — no consecutive user messages
    await page.waitForTimeout(500);
    const newState = await getPageState(page, rootPage);

    // Append page state text + image to the tool_result content array
    toolResultContent.push({
      type: "text",
      text: `Tool calls executed. Updated page state:\n\nURL: ${newState.url}\nTitle: ${newState.title}\n\nVisible text:\n${newState.visibleText.slice(0, 500)}\n\nInteractive elements:\n${newState.simplifiedHtml.slice(0, 3000)}\n\nContinue filling out the application. If submitted, call report_status("success").`,
    });
    if (newState.screenshot && newState.screenshot.length > 100) {
      toolResultContent.push({
        type: "image",
        source: { type: "base64", media_type: "image/png", data: newState.screenshot },
      });
    }

    messages.push({ role: "user", content: toolResultContent });
  }

  // Max iterations — do one final DOM check before giving up
  const finalDomCheck = await verifySubmissionOnPage(page);
  try {
    const finalSs = await safeScreenshot(rootPage || page);
    screenshots.push({ step: finalDomCheck.confirmed ? `Confirmed: ${finalDomCheck.evidence.slice(0,60)}` : "Max iterations reached", screenshot: finalSs });
  } catch { /* */ }
  if (finalDomCheck.confirmed) {
    console.log(`[AI-Agent] Confirmed on final DOM check: "${finalDomCheck.evidence}"`);
    return {
      success: true, platform: "ai-agent",
      message: `Application submitted (detected at max iterations): ${finalDomCheck.evidence}`,
      stepsCompleted: steps, screenshotSteps: screenshots,
      confirmationDetected: true, confirmationText: finalDomCheck.evidence,
      iterationsUsed: iterations,
    };
  }
  return {
    success: false, platform: "ai-agent",
    message: `AI agent reached maximum iterations (${MAX_ITERATIONS}).`,
    stepsCompleted: steps, screenshotSteps: screenshots,
    confirmationDetected: false, confirmationText: "", iterationsUsed: iterations,
  };
}

// ── OpenAI Agent Loop (fallback) ──

async function runOpenAILoop(
  client: any,
  page: any,
  rootPage: any,
  ctx: AgentContext,
  systemPrompt: string,
  steps: string[],
  screenshots: { step: string; screenshot: string }[],
  browserContext: any,
  agentStartTime: number,
): Promise<AgentResult> {
  const MAX_ITERATIONS = 40;
  const AGENT_TIMEOUT_MS = 12 * 60 * 1000; // 12min — Workday needs auth + multi-page form
  let iterations = 0;
  const fieldAttempts = new Map<string, number>();
  const recentActions: string[] = [];
  let anyLoopDetected = false;
  let consecutiveLoopedIters = 0;
  const tools = getOpenAITools();

  const messages: any[] = [
    { role: "system", content: systemPrompt },
  ];

  const initialState = await getPageState(page, rootPage);
  screenshots.push({ step: "1. Initial page state", screenshot: initialState.screenshot });
  steps.push(`Page loaded: ${initialState.title}`);

  const initialContent: any[] = [
    {
      type: "text",
      text: `I've navigated to the job application page.\n\nURL: ${initialState.url}\nTitle: ${initialState.title}\n\nVisible text:\n${initialState.visibleText.slice(0, 500)}\n\nInteractive elements:\n${initialState.simplifiedHtml.slice(0, 3000)}\n\nAnalyze the page and start filling out the application.`,
    },
  ];
  if (initialState.screenshot && initialState.screenshot.length > 100) {
    initialContent.push({
      type: "image_url",
      image_url: { url: `data:image/png;base64,${initialState.screenshot}`, detail: "low" },
    });
  }
  messages.push({ role: "user", content: initialContent });

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    if (Date.now() - agentStartTime > AGENT_TIMEOUT_MS) {
      console.log(`[AI-Agent] Hard timeout at iteration ${iterations}`);
      try { const ss = await safeScreenshot(rootPage || page); screenshots.push({ step: "Timeout", screenshot: ss }); } catch { /* */ }
      return {
        success: false, platform: "ai-agent",
        message: `AI agent timed out after ${Math.round((Date.now() - agentStartTime) / 1000)}s.`,
        stepsCompleted: steps, screenshotSteps: screenshots,
        confirmationDetected: false, confirmationText: "", iterationsUsed: iterations,
      };
    }

    console.log(`[AI-Agent] OpenAI iteration ${iterations}/${MAX_ITERATIONS}`);

    // Truncate old messages
    let foundLatestImg = false;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === "user" && Array.isArray(msg.content)) {
        if (!foundLatestImg) { foundLatestImg = true; }
        else {
          const textParts = msg.content.filter((c: any) => c.type === "text");
          if (textParts.length > 0) {
            for (const part of textParts) {
              if (typeof part.text === "string" && part.text.length > 800) {
                part.text = part.text.slice(0, 800) + "\n[...truncated...]";
              }
            }
            msg.content = textParts;
          }
        }
      }
    }

    let completion;
    try {
      completion = await client.chat.completions.create({
        model: "gpt-4o",
        messages,
        tools,
        tool_choice: "auto",
        max_tokens: 2000,
      });
    } catch (apiErr: any) {
      if (apiErr?.status === 429) {
        console.log(`[AI-Agent] OpenAI rate limited, waiting 10s...`);
        await page.waitForTimeout(10000);
        completion = await client.chat.completions.create({
          model: "gpt-4o", messages, tools, tool_choice: "auto", max_tokens: 2000,
        });
      } else { throw apiErr; }
    }

    const assistantMessage = completion.choices[0].message;
    messages.push(assistantMessage);

    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      const domCheck = await verifySubmissionOnPage(page);
      if (domCheck.confirmed) {
        return {
          success: true, platform: "ai-agent",
          message: (assistantMessage.content || "").slice(0, 500),
          stepsCompleted: steps, screenshotSteps: screenshots,
          confirmationDetected: true, confirmationText: domCheck.evidence,
          iterationsUsed: iterations,
        };
      }
      messages.push({ role: "user", content: "Please continue or call report_status if done." });
      continue;
    }

    const toolResults: any[] = [];
    let statusReported: { status: string; message: string; confirmationText?: string } | null = null;
    let loopedThisIter = 0;
    let totalThisIter = 0;

    for (const tc of assistantMessage.tool_calls) {
      totalThisIter++;
      const fnName = tc.function.name;
      let fnArgs: any;
      try { fnArgs = JSON.parse(tc.function.arguments); } catch { fnArgs = {}; }

      const normalizedKey = normalizeActionKey(fnName, fnArgs);
      console.log(`[AI-Agent] Tool call: ${fnName}(${JSON.stringify(fnArgs).slice(0, 200)})`);
      recentActions.push(normalizedKey);

      // Loop detection: only block THIS action if it specifically appears 5+ times in last 15
      if (recentActions.length > 30) recentActions.splice(0, recentActions.length - 30);
      const thisActionCount = recentActions.slice(-15).filter(a => a === normalizedKey).length;
      if (thisActionCount >= 3) {
        anyLoopDetected = true;
        loopedThisIter++;
        console.log(`[AI-Agent] Loop detected: "${normalizedKey.slice(0, 60)}" appeared ${thisActionCount}x — blocking this action`);
        toolResults.push({ role: "tool", tool_call_id: tc.id, content: `LOOP DETECTED: "${normalizedKey.slice(0, 60)}" failed ${thisActionCount} times. This field is OPTIONAL — stop retrying it entirely (no more selector variants). Move on immediately and click Submit/Next to continue the application.` });
        continue;
      }

      if (fnName === "report_status") {
        const terminalMsg = (fnArgs.message || fnArgs.confirmationText || "").toLowerCase();
        const isTerminalState = /spam|flagged|duplicate|already applied|already submitted|blacklist|expired|no longer (available|exists)|job (has been|is) closed|position.*filled|not accepting|does not exist|job not found|listing.*closed|been filled|page not found|404|this job.*no longer|no longer open/i.test(terminalMsg);
        const isEarlyGiveUp = fnArgs.status !== "success" && iterations < 12 && !anyLoopDetected && !isTerminalState;
        if (isEarlyGiveUp) {
          toolResults.push({ role: "tool", tool_call_id: tc.id, content: `REJECTED: Only used ${iterations}/${MAX_ITERATIONS} iterations. Keep trying: scroll down to find ALL form fields, fill checkbox groups and radio buttons with reasonable choices, then solve CAPTCHA and submit.` });
        } else if (fnArgs.status === "success") {
          // DOM verification before accepting success
          const domCheck = await verifySubmissionOnPage(page);
          if (!domCheck.confirmed) {
            console.log(`[AI-Agent] Success claimed but DOM shows no confirmation — rejecting (iter ${iterations})`);
            toolResults.push({ role: "tool", tool_call_id: tc.id, content: `REJECTED: You called report_status("success") but the page does NOT show a confirmation. Do NOT call success until you see "Thank you for applying", "Application received", or a confirmation URL. Fix any validation errors and re-submit.` });
          } else {
            console.log(`[AI-Agent] Submission confirmed by DOM: "${domCheck.confirmed}"`);
            statusReported = { ...fnArgs, confirmationText: domCheck.evidence };
            toolResults.push({ role: "tool", tool_call_id: tc.id, content: "Status reported." });
          }
        } else {
          statusReported = fnArgs;
          toolResults.push({ role: "tool", tool_call_id: tc.id, content: "Status reported." });
        }
      } else {
        const result = await executeTool(page, fnName, fnArgs, ctx, steps, screenshots, browserContext, fieldAttempts, rootPage);
        if (typeof result === "object" && result.newPage) {
          page = result.newPage;
          toolResults.push({ role: "tool", tool_call_id: tc.id, content: result.result });
        } else {
          toolResults.push({ role: "tool", tool_call_id: tc.id, content: typeof result === "string" ? result : result.result });
        }
        if (fnName === "navigate_to") recentActions.splice(0);
      }
    }

    messages.push(...toolResults);

    // Escalate when all tool calls were loop-detected (OpenAI loop)
    if (totalThisIter > 0 && loopedThisIter === totalThisIter) {
      consecutiveLoopedIters++;
      // After 2 consecutive fully-looped iterations, inject a strong "just submit" instruction
      if (consecutiveLoopedIters === 2) {
        console.log(`[AI-Agent] Escalating: injecting forced-submit instruction after ${consecutiveLoopedIters} looped iterations (OpenAI)`);
        messages.push({
          role: "user",
          content: "CRITICAL: You have been looping on optional fields. STOP trying to fill any more fields. The remaining unfilled fields are OPTIONAL. Your ONLY next action must be to click the Submit/Apply/Save button to submit the application. Try these selectors in order: button[type='submit'], input[type='submit'], button:has-text('Submit Application'), button:has-text('Submit'), button:has-text('Apply'), button:has-text('Save and Continue'), [data-automation-id='nextButton'], button.btn-success, button:has-text('Send Application'), button:has-text('Complete'), a:has-text('Submit'). If submit succeeds, call report_status('success'). If you see validation errors, report_status('needs_manual') with the error text.",
        });
      }
      if (consecutiveLoopedIters >= 4) {
        console.log(`[AI-Agent] Force terminating: ${consecutiveLoopedIters} consecutive fully-looped iterations (OpenAI)`);
        // Aggressive submit attempt before giving up — try many selectors
        let submitClicked = false;
        const submitSelectors = [
          "button[type='submit']", "input[type='submit']",
          "button:has-text('Submit Application')", "button:has-text('Submit')",
          "button:has-text('Apply')", "button:has-text('Apply Now')",
          "button:has-text('Send Application')", "button:has-text('Complete')",
          "button:has-text('Save and Continue')", "[data-automation-id='nextButton']",
          "button.btn-success", "a:has-text('Submit')", "a:has-text('Apply')",
          "button:has-text('Finish')", "button:has-text('Done')",
        ];
        for (const sel of submitSelectors) {
          if (submitClicked) break;
          try {
            const btn = await page.$(sel);
            if (btn) {
              await btn.scrollIntoViewIfNeeded().catch(() => {});
              await btn.click();
              await page.waitForTimeout(3000);
              submitClicked = true;
              steps.push(`Forced submit via ${sel}`);
              console.log(`[AI-Agent] Forced submit clicked: ${sel}`);
            }
          } catch { /* try next */ }
        }
        // Check if forced submit actually worked
        if (submitClicked) {
          const postSubmitCheck = await verifySubmissionOnPage(page);
          if (postSubmitCheck.confirmed) {
            try { const ss = await safeScreenshot(rootPage || page); screenshots.push({ step: `Confirmed after forced submit: ${postSubmitCheck.evidence.slice(0,80)}`, screenshot: ss }); } catch { /* */ }
            return {
              success: true, platform: "ai-agent",
              message: `Application submitted after forced submit: ${postSubmitCheck.evidence}`,
              stepsCompleted: steps, screenshotSteps: screenshots,
              confirmationDetected: true, confirmationText: postSubmitCheck.evidence, iterationsUsed: iterations,
            };
          }
        }
        try { const ss = await safeScreenshot(rootPage || page); screenshots.push({ step: "Loop termination", screenshot: ss }); } catch { /* */ }
        return {
          success: false, platform: "ai-agent",
          message: `Could not complete: ${consecutiveLoopedIters} consecutive iterations had all actions blocked by loop detection.${submitClicked ? " Attempted submit click — no confirmation detected." : ""}`,
          stepsCompleted: steps, screenshotSteps: screenshots,
          confirmationDetected: false, confirmationText: "", iterationsUsed: iterations,
        };
      }
    } else {
      consecutiveLoopedIters = 0;
    }

    if (statusReported) {
      try { const ss = await safeScreenshot(rootPage || page); screenshots.push({ step: `Final: ${statusReported.message.slice(0, 80)}`, screenshot: ss }); } catch { /* */ }
      return {
        success: statusReported.status === "success", platform: "ai-agent",
        message: statusReported.message,
        stepsCompleted: steps, screenshotSteps: screenshots,
        confirmationDetected: statusReported.status === "success",
        confirmationText: statusReported.confirmationText || "",
        iterationsUsed: iterations,
      };
    }

    await page.waitForTimeout(500);
    const newState = await getPageState(page, rootPage);
    const stateContent: any[] = [
      { type: "text", text: `Updated page state:\n\nURL: ${newState.url}\nTitle: ${newState.title}\n\nVisible text:\n${newState.visibleText.slice(0, 500)}\n\nInteractive elements:\n${newState.simplifiedHtml.slice(0, 3000)}\n\nContinue or call report_status.` },
    ];
    if (newState.screenshot && newState.screenshot.length > 100) {
      stateContent.push({ type: "image_url", image_url: { url: `data:image/png;base64,${newState.screenshot}`, detail: "low" } });
    }
    messages.push({ role: "user", content: stateContent });
  }

  // Final DOM check at max iterations
  const finalDomCheckOAI = await verifySubmissionOnPage(page);
  try { const ss = await safeScreenshot(rootPage || page); screenshots.push({ step: finalDomCheckOAI.confirmed ? `Confirmed: ${finalDomCheckOAI.evidence.slice(0,60)}` : "Max iterations", screenshot: ss }); } catch { /* */ }
  if (finalDomCheckOAI.confirmed) {
    return {
      success: true, platform: "ai-agent",
      message: `Application submitted: ${finalDomCheckOAI.evidence}`,
      stepsCompleted: steps, screenshotSteps: screenshots,
      confirmationDetected: true, confirmationText: finalDomCheckOAI.evidence, iterationsUsed: iterations,
    };
  }
  return {
    success: false, platform: "ai-agent",
    message: `AI agent reached maximum iterations (${MAX_ITERATIONS}).`,
    stepsCompleted: steps, screenshotSteps: screenshots,
    confirmationDetected: false, confirmationText: "", iterationsUsed: iterations,
  };
}

// ── Main Entry Point ──

export async function runAIAgent(
  aiClient: AgentAIClient | any,
  page: any,
  ctx: AgentContext,
  jobUrl: string,
  jobTitle: string,
  company: string,
  browserContext?: any,
): Promise<AgentResult> {
  const agentStartTime = Date.now();
  const steps: string[] = [];
  const screenshots: { step: string; screenshot: string }[] = [];
  resetScreenshotFailCount();
  const rootPage = page;

  // Determine provider
  let provider: "claude" | "openai";
  let client: any;
  if (aiClient && typeof aiClient === "object" && "provider" in aiClient) {
    provider = aiClient.provider;
    client = aiClient.client;
  } else {
    // Legacy: raw OpenAI client
    provider = "openai";
    client = aiClient;
  }

  console.log(`[AI-Agent] Using ${provider} for agent loop`);

  const systemPrompt = buildSystemPrompt(ctx, jobTitle, company, jobUrl);

  try {
    // Pre-processing
    const preprocessResult = await runPreprocessing(
      page, rootPage, ctx, steps, screenshots, browserContext,
    );
    page = preprocessResult.page;

    if (provider === "claude") {
      return await runClaudeLoop(client, page, rootPage, ctx, systemPrompt, steps, screenshots, browserContext, agentStartTime);
    } else {
      return await runOpenAILoop(client, page, rootPage, ctx, systemPrompt, steps, screenshots, browserContext, agentStartTime);
    }
  } catch (err) {
    console.error("[AI-Agent] Error:", err);
    try {
      const errorSs = await safeScreenshot(rootPage || page);
      screenshots.push({ step: `Error: ${(err as Error).message}`, screenshot: errorSs });
    } catch { /* */ }
    return {
      success: false, platform: "ai-agent",
      message: `AI agent error: ${(err as Error).message}`,
      stepsCompleted: steps, screenshotSteps: screenshots,
      confirmationDetected: false, confirmationText: "", iterationsUsed: 0,
    };
  }
}
