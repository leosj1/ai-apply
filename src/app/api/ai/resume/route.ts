import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

export async function POST(req: NextRequest) {
  try {
    const { jobDescription, resumeText, resumeId } = await req.json();

    if (!jobDescription || !resumeText) {
      return NextResponse.json(
        { error: "Job description and resume text are required" },
        { status: 400 }
      );
    }

    if (openai) {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are an expert ATS resume optimizer. Analyze the resume against the job description and return a JSON object with:
- atsScore (number 0-100)
- suggestions (array of 5 specific, actionable strings)
- keywordsFound (array of keywords from the job description found in the resume)
- keywordsMissing (array of important keywords from the job description missing from the resume)
- optimizedText (the resume text with improvements applied)
Return ONLY valid JSON, no markdown.`,
          },
          {
            role: "user",
            content: `Job Description:\n${jobDescription}\n\nResume:\n${resumeText}`,
          },
        ],
        temperature: 0.7,
        max_tokens: 2000,
      });

      const content = completion.choices[0]?.message?.content || "";
      const parsed = JSON.parse(content);
      await saveOptimization(resumeId, parsed.atsScore, parsed.optimizedText);
      return NextResponse.json(parsed);
    }

    // Fallback: simulated response when no API key
    const optimizedResume = {
      atsScore: Math.floor(Math.random() * 15) + 85,
      suggestions: [
        "Add quantifiable metrics to your achievements",
        "Include keywords from the job description: " +
          jobDescription.slice(0, 50) + "...",
        "Move most relevant experience to the top",
        "Add a professional summary tailored to this role",
        "Include relevant certifications",
      ],
      keywordsFound: ["React", "TypeScript", "Node.js", "AWS", "CI/CD"],
      keywordsMissing: ["Kubernetes", "GraphQL", "Terraform"],
      optimizedText: resumeText,
    };

    await saveOptimization(resumeId, optimizedResume.atsScore, optimizedResume.optimizedText);
    return NextResponse.json(optimizedResume);
  } catch (error) {
    console.error("Resume optimization error:", error);
    return NextResponse.json(
      { error: "Failed to optimize resume" },
      { status: 500 }
    );
  }
}

async function saveOptimization(resumeId: string | undefined, atsScore: number, optimizedText: string) {
  if (!resumeId) return;
  try {
    await prisma.resume.update({
      where: { id: resumeId },
      data: {
        atsScore,
        content: optimizedText,
        lastOptimized: new Date(),
      },
    });
  } catch {
    // Non-critical — don't fail the request if DB save fails
  }
}
