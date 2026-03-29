import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

export async function POST(req: NextRequest) {
  try {
    const { jobDescription, companyName, roleName, tone, resumeText } =
      await req.json();

    if (!companyName || !roleName) {
      return NextResponse.json(
        { error: "Company name and role are required" },
        { status: 400 }
      );
    }

    let coverLetter: string;

    if (openai) {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are an expert cover letter writer. Write a compelling, personalized cover letter for the given role and company. Use a ${tone || "Professional"} tone. Include specific achievements and metrics. The letter should be 3-4 paragraphs. Return ONLY the cover letter text, no JSON wrapping.`,
          },
          {
            role: "user",
            content: `Company: ${companyName}\nRole: ${roleName}\n${jobDescription ? `Job Description:\n${jobDescription}\n` : ""}${resumeText ? `Resume:\n${resumeText}` : ""}`,
          },
        ],
        temperature: 0.8,
        max_tokens: 1500,
      });

      coverLetter = completion.choices[0]?.message?.content || "";
    } else {
      // Fallback: simulated response
      coverLetter = `Dear Hiring Manager,

I am writing to express my strong interest in the ${roleName} position at ${companyName}. With over 6 years of experience building scalable web applications and leading cross-functional engineering teams, I am confident that my technical expertise and leadership skills make me an excellent fit for this role.

In my current position at TechCorp, I have:
• Led the migration of a monolithic application to a microservices architecture, reducing deployment time by 75% and improving system reliability to 99.99% uptime
• Mentored a team of 8 engineers, implementing code review practices that reduced production bugs by 40%
• Designed and built a real-time data pipeline processing 2M+ events daily using Kafka and Redis
• Spearheaded the adoption of TypeScript across the organization, improving developer productivity by 30%

What excites me most about ${companyName} is your commitment to pushing the boundaries of technology while maintaining a strong engineering culture. I believe my experience in distributed systems and performance optimization would allow me to make immediate contributions to your team.

I would welcome the opportunity to discuss how my background and skills align with your team's goals. Thank you for considering my application.

Best regards,
Sarah Chen`;
    }

    // Save to DB
    let savedId: string | null = null;
    try {
      const { userId: clerkId } = auth();
      if (clerkId) {
        const dbUser = await prisma.user.findUnique({ where: { clerkId } });
        if (dbUser) {
          const saved = await prisma.coverLetter.create({
            data: {
              userId: dbUser.id,
              companyName,
              roleName,
              tone: tone || "Professional",
              content: coverLetter,
            },
          });
          savedId = saved.id;
        }
      }
    } catch {
      // Non-critical
    }

    return NextResponse.json({
      id: savedId,
      coverLetter,
      tone: tone || "Professional",
      wordCount: coverLetter.split(/\s+/).length,
      readingTime: Math.ceil(coverLetter.split(/\s+/).length / 200) + " min",
    });
  } catch (error) {
    console.error("Cover letter generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate cover letter" },
      { status: 500 }
    );
  }
}
