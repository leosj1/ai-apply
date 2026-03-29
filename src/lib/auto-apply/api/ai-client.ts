// Unified AI Client for Question Answering
// Supports Claude (preferred) and OpenAI (fallback) for answering
// custom application questions across all ATS platforms.
//
// Replaces the 4 duplicate answerXxxQuestions functions in:
//   greenhouse.ts, lever.ts, ashby.ts, workable.ts

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { ApplicantData, FormField } from "./types";

// ── AI Client Interface ──

export interface AIClient {
  provider: "claude" | "openai";
  client: any;
}

/**
 * Create an AI client, preferring Claude over OpenAI.
 * Returns null if neither API key is available.
 */
export function createAIClient(options?: {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  openaiClient?: any;
}): AIClient | null {
  const anthropicKey = options?.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
  const openaiKey = options?.openaiApiKey || process.env.OPENAI_API_KEY;

  // Prefer Claude
  if (anthropicKey) {
    try {
      // Dynamic import to avoid bundling issues
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Anthropic = require("@anthropic-ai/sdk").default || require("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey: anthropicKey });
      return { provider: "claude", client };
    } catch (err) {
      console.error("[AI-Client] Failed to create Claude client:", (err as Error).message);
    }
  }

  // Fallback: use provided OpenAI client or create one
  if (options?.openaiClient) {
    return { provider: "openai", client: options.openaiClient };
  }
  if (openaiKey) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const OpenAI = require("openai").default || require("openai");
      const client = new OpenAI({ apiKey: openaiKey });
      return { provider: "openai", client };
    } catch (err) {
      console.error("[AI-Client] Failed to create OpenAI client:", (err as Error).message);
    }
  }

  return null;
}

// ── Unified Question Answering ──

/**
 * Answer custom application questions using Claude (preferred) or OpenAI (fallback).
 * Works across all ATS platforms — Greenhouse, Lever, Ashby, Workable, etc.
 */
export async function answerQuestions(
  aiClient: AIClient | any,
  questions: FormField[],
  applicant: ApplicantData,
  jobTitle: string,
  company: string,
): Promise<Map<string, string>> {
  if (questions.length === 0) return new Map();

  // Determine if we got an AIClient or a raw OpenAI instance (backward compat)
  let provider: "claude" | "openai";
  let client: any;

  if (aiClient && typeof aiClient === "object" && "provider" in aiClient) {
    provider = aiClient.provider;
    client = aiClient.client;
  } else {
    // Legacy: raw OpenAI client passed directly
    provider = "openai";
    client = aiClient;
  }

  const questionsText = questions.map((q, i) =>
    `${i + 1}. "${q.label}" (${q.type}${q.required ? ", REQUIRED" : ""})${q.options ? ` Options: [${q.options.join(", ")}]` : ""}`
  ).join("\n");

  const prompt = `You are filling out a job application for "${jobTitle}" at "${company}".

Applicant profile:
- Name: ${applicant.firstName} ${applicant.lastName}
- Email: ${applicant.email}
- Phone: ${applicant.phone || "N/A"}
- LinkedIn: ${applicant.linkedIn || "N/A"}
- Location: ${applicant.location || "N/A"}
- Current Title: ${applicant.currentTitle || "Software Engineer"}
- Years of Experience: ${applicant.yearsExp || "2"}
- Needs Sponsorship: ${applicant.needsSponsorship ? "Yes" : "No"}
- Work Authorization: ${applicant.needsSponsorship ? "Not authorized without sponsorship" : "Authorized to work (no sponsorship needed)"}
- Resume excerpt: ${applicant.resumeText?.slice(0, 500) || "N/A"}

CRITICAL RULES — answer these question types accurately:
1. "Legally authorized to work" / "work authorization" → Answer "${applicant.needsSponsorship ? "No" : "Yes"}" (based on sponsorship status)
2. "Need sponsorship" / "require sponsorship" / "visa sponsorship" → Answer "${applicant.needsSponsorship ? "Yes" : "No"}"
3. "Based in [city/area]" / "located in [city/area]" / "reside in [region]" → Compare the job's city/area against applicant location "${applicant.location || "N/A"}". Only answer "Yes" if the applicant is actually in that specific area. Oakland is NOT Los Angeles. Be precise.
4. For select/dropdown fields, pick the EXACT option text from the provided options.
5. For boolean fields, answer "Yes" or "No".
6. For text/textarea fields, give concise professional answers.
7. For URL fields, provide the LinkedIn URL if asked.

Questions:
${questionsText}

Respond in JSON format: { "answers": { "1": "answer1", "2": "answer2", ... } }
Only the JSON, no explanation.`;

  try {
    let content: string;

    if (provider === "claude") {
      const response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      });
      content = response.content
        .filter((block: any) => block.type === "text")
        .map((block: any) => block.text)
        .join("");
    } else {
      const completion = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1000,
        response_format: { type: "json_object" },
      });
      content = completion.choices[0]?.message?.content || "{}";
    }

    // Extract JSON from response (Claude may wrap in markdown)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("[AI-Client] No JSON found in response");
      return new Map();
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const answers = parsed.answers || parsed;

    const result = new Map<string, string>();
    questions.forEach((q, i) => {
      const answer = answers[String(i + 1)] || answers[q.id];
      if (answer) result.set(q.id, String(answer));
    });

    console.log(`[AI-Client] ${provider} answered ${result.size}/${questions.length} questions`);
    return result;
  } catch (err) {
    console.error(`[AI-Client] ${provider} question answering failed:`, err);
    return new Map();
  }
}
