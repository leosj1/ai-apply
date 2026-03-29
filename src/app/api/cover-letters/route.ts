import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const { userId: clerkId } = auth();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const dbUser = await prisma.user.findUnique({
      where: { clerkId },
    });

    if (!dbUser) {
      return NextResponse.json({ coverLetters: [] });
    }

    const coverLetters = await prisma.coverLetter.findMany({
      where: { userId: dbUser.id },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        companyName: true,
        roleName: true,
        tone: true,
        content: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ coverLetters });
  } catch (error) {
    console.error("Cover letters GET error:", error);
    return NextResponse.json(
      { error: "Failed to load cover letters" },
      { status: 500 }
    );
  }
}
