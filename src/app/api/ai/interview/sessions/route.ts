import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const { userId: clerkId } = auth();
    if (!clerkId) {
      return NextResponse.json({ sessions: [] });
    }

    const dbUser = await prisma.user.findUnique({ where: { clerkId } });
    if (!dbUser) {
      return NextResponse.json({ sessions: [] });
    }

    const sessions = await prisma.interviewSession.findMany({
      where: { userId: dbUser.id },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    return NextResponse.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        company: s.company || "Practice",
        type: s.interviewType,
        score: s.overallScore,
        questions: s.questionsCount,
        date: formatRelativeTime(s.createdAt),
      })),
    });
  } catch (error) {
    console.error("Interview sessions error:", error);
    return NextResponse.json({ sessions: [] });
  }
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return `${Math.floor(diffDays / 7)} week${Math.floor(diffDays / 7) > 1 ? "s" : ""} ago`;
}
