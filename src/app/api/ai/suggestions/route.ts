import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

export async function POST(req: NextRequest) {
  try {
    const { type, query } = await req.json();

    if (!query || !type) {
      return NextResponse.json({ suggestions: [] });
    }

    if (!openai) {
      return NextResponse.json({ suggestions: [] });
    }

    if (type === "job_titles") {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a job title autocomplete engine. Given a partial job title query, return up to 8 real-world job titles that match. Include variations in seniority (e.g., Senior, Staff, Lead, VP). Return ONLY a JSON array of strings, no markdown.`,
          },
          {
            role: "user",
            content: `Autocomplete this job title: "${query}"`,
          },
        ],
        temperature: 0.3,
        max_tokens: 200,
      });

      const content = completion.choices[0]?.message?.content || "[]";
      const suggestions = JSON.parse(content);
      return NextResponse.json({ suggestions });
    }

    if (type === "target_roles") {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a career advisor. Given someone's current job title, suggest 8-10 realistic target roles they might want to transition to or advance into. Include lateral moves, promotions, and adjacent roles. Return ONLY a JSON array of strings, no markdown.`,
          },
          {
            role: "user",
            content: `Current job title: "${query}". What target roles should they consider?`,
          },
        ],
        temperature: 0.5,
        max_tokens: 200,
      });

      const content = completion.choices[0]?.message?.content || "[]";
      const roles = JSON.parse(content);
      return NextResponse.json({ suggestions: roles });
    }

    return NextResponse.json({ suggestions: [] });
  } catch (error) {
    console.error("Suggestions API error:", error);
    return NextResponse.json({ suggestions: [] });
  }
}
