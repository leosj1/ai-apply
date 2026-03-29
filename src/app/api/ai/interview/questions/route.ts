import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

export async function POST(req: NextRequest) {
  try {
    const { interviewType, company, role, jobDescription } = await req.json();

    if (!openai) {
      return NextResponse.json({ questions: getFallbackQuestions(interviewType) });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are an expert interview coach. Generate 5 interview questions for a ${interviewType || "behavioral"} interview. Each question should be realistic and challenging. Return ONLY a JSON array where each object has: question (string), category (string — the interview type), difficulty (string — Easy/Medium/Hard), timeLimit (string like "3 min" or "5 min"). No markdown.`,
        },
        {
          role: "user",
          content: `Generate ${interviewType || "behavioral"} interview questions${company ? ` for ${company}` : ""}${role ? ` for the role: ${role}` : ""}${jobDescription ? `\n\nJob Description:\n${jobDescription}` : ""}`,
        },
      ],
      temperature: 0.8,
      max_tokens: 800,
    });

    const content = completion.choices[0]?.message?.content || "[]";
    let questions;
    try {
      questions = JSON.parse(content);
    } catch {
      questions = getFallbackQuestions(interviewType);
    }

    return NextResponse.json({ questions });
  } catch (error) {
    console.error("Interview questions error:", error);
    return NextResponse.json({ questions: getFallbackQuestions("behavioral") });
  }
}

function getFallbackQuestions(type: string) {
  const map: Record<string, Array<{ question: string; category: string; difficulty: string; timeLimit: string }>> = {
    behavioral: [
      { question: "Tell me about a time you had to deal with a difficult team member.", category: "Behavioral", difficulty: "Medium", timeLimit: "3 min" },
      { question: "Describe a situation where you had to meet a tight deadline.", category: "Behavioral", difficulty: "Medium", timeLimit: "3 min" },
      { question: "Give an example of a time you showed leadership.", category: "Behavioral", difficulty: "Easy", timeLimit: "3 min" },
      { question: "Tell me about a time you failed and what you learned.", category: "Behavioral", difficulty: "Medium", timeLimit: "3 min" },
      { question: "Describe a conflict you resolved at work.", category: "Behavioral", difficulty: "Hard", timeLimit: "5 min" },
    ],
    technical: [
      { question: "Explain the difference between REST and GraphQL.", category: "Technical", difficulty: "Medium", timeLimit: "5 min" },
      { question: "How would you optimize a slow database query?", category: "Technical", difficulty: "Hard", timeLimit: "5 min" },
      { question: "What is the event loop in JavaScript?", category: "Technical", difficulty: "Medium", timeLimit: "3 min" },
      { question: "Explain microservices vs monolithic architecture.", category: "Technical", difficulty: "Medium", timeLimit: "5 min" },
      { question: "How does HTTPS work?", category: "Technical", difficulty: "Easy", timeLimit: "3 min" },
    ],
    "system-design": [
      { question: "Design a URL shortening service like bit.ly.", category: "System Design", difficulty: "Hard", timeLimit: "15 min" },
      { question: "Design a real-time chat application.", category: "System Design", difficulty: "Hard", timeLimit: "15 min" },
      { question: "Design a rate limiter.", category: "System Design", difficulty: "Medium", timeLimit: "10 min" },
      { question: "Design a notification system.", category: "System Design", difficulty: "Medium", timeLimit: "10 min" },
      { question: "Design a file storage service like Dropbox.", category: "System Design", difficulty: "Hard", timeLimit: "15 min" },
    ],
    "case-study": [
      { question: "How would you increase user engagement for a social media app?", category: "Case Study", difficulty: "Medium", timeLimit: "10 min" },
      { question: "A company's revenue dropped 20% last quarter. How would you diagnose the issue?", category: "Case Study", difficulty: "Hard", timeLimit: "10 min" },
      { question: "Should a startup expand to a new market or deepen its current one?", category: "Case Study", difficulty: "Medium", timeLimit: "10 min" },
      { question: "How would you prioritize features for a new product launch?", category: "Case Study", difficulty: "Easy", timeLimit: "5 min" },
      { question: "Estimate the number of gas stations in the United States.", category: "Case Study", difficulty: "Medium", timeLimit: "5 min" },
    ],
  };
  return map[type] || map.behavioral;
}
