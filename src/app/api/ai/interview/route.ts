import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

export async function POST(req: NextRequest) {
  try {
    const { question, answer, interviewType, company, role, sessionId } = await req.json();

    if (!question || !answer) {
      return NextResponse.json(
        { error: "Question and answer are required" },
        { status: 400 }
      );
    }

    if (openai) {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are an expert interview coach. Evaluate the candidate's answer to the interview question. Return a JSON object with:
- overallScore (number 0-100)
- scores: { content (0-100), structure (0-100), delivery (0-100) }
- strengths (array of 3 specific strings)
- improvements (array of 3 specific, actionable strings)
- suggestedAnswer (a model answer string, 2-3 sentences using the STAR method)
Return ONLY valid JSON, no markdown.`,
          },
          {
            role: "user",
            content: `Interview type: ${interviewType || "behavioral"}${company ? `\nCompany: ${company}` : ""}${role ? `\nRole: ${role}` : ""}\n\nQuestion: ${question}\n\nCandidate's Answer: ${answer}`,
          },
        ],
        temperature: 0.7,
        max_tokens: 1000,
      });

      const content = completion.choices[0]?.message?.content || "";
      const parsed = JSON.parse(content);
      const savedSessionId = await saveInterviewAnswer(sessionId, interviewType, company, role, question, answer, parsed);
      return NextResponse.json({ ...parsed, sessionId: savedSessionId });
    }

    // Fallback: simulated response
    const feedback = {
      overallScore: Math.floor(Math.random() * 20) + 75,
      scores: {
        content: Math.floor(Math.random() * 15) + 80,
        structure: Math.floor(Math.random() * 20) + 70,
        delivery: Math.floor(Math.random() * 15) + 80,
      },
      strengths: [
        "Good use of specific examples and metrics",
        "Clear communication of the problem and solution",
        "Demonstrated leadership and initiative",
      ],
      improvements: [
        "Add more quantifiable results to strengthen impact",
        "Structure your answer using the STAR method more clearly",
        "Connect the outcome back to the company's goals",
      ],
      suggestedAnswer:
        "In my previous role at TechCorp, I encountered a situation where a senior team member consistently pushed back on code reviews. I scheduled a 1:1 meeting to understand their perspective, discovered they felt the review process was too slow, and collaboratively redesigned our review workflow. This reduced review time by 60% and improved team satisfaction scores by 25%.",
    };

    const savedSessionId = await saveInterviewAnswer(sessionId, interviewType, company, role, question, answer, feedback);
    return NextResponse.json({ ...feedback, sessionId: savedSessionId });
  } catch (error) {
    console.error("Interview feedback error:", error);
    return NextResponse.json(
      { error: "Failed to generate feedback" },
      { status: 500 }
    );
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function saveInterviewAnswer(
  sessionId: string | undefined,
  interviewType: string,
  company: string | undefined,
  role: string | undefined,
  question: string,
  answer: string,
  feedback: any
): Promise<string | undefined> {
  try {
    const { userId: clerkId } = auth();
    if (!clerkId) return undefined;

    const dbUser = await prisma.user.findUnique({ where: { clerkId } });
    if (!dbUser) return undefined;

    let session;
    if (sessionId) {
      session = await prisma.interviewSession.findUnique({ where: { id: sessionId } });
    }

    if (!session) {
      session = await prisma.interviewSession.create({
        data: {
          userId: dbUser.id,
          interviewType: interviewType || "behavioral",
          company: company || null,
          role: role || null,
          overallScore: feedback.overallScore,
          questionsCount: 1,
        },
      });
    } else {
      await prisma.interviewSession.update({
        where: { id: session.id },
        data: {
          overallScore: feedback.overallScore,
          questionsCount: { increment: 1 },
        },
      });
    }

    await prisma.interviewAnswer.create({
      data: {
        sessionId: session.id,
        question,
        answer,
        scoreContent: feedback.scores?.content,
        scoreStructure: feedback.scores?.structure,
        scoreDelivery: feedback.scores?.delivery,
        strengths: JSON.stringify(feedback.strengths || []),
        improvements: JSON.stringify(feedback.improvements || []),
        suggestedAnswer: feedback.suggestedAnswer || null,
      },
    });

    return session.id;
  } catch {
    return undefined;
  }
}
