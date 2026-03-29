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
      return NextResponse.json({ resumes: [] });
    }

    const resumes = await prisma.resume.findMany({
      where: { userId: dbUser.id },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        template: true,
        atsScore: true,
        lastOptimized: true,
        createdAt: true,
        updatedAt: true,
        pdfMimeType: true,
      },
    });

    return NextResponse.json({ resumes: resumes.map((r) => ({ ...r, hasPdf: !!r.pdfMimeType })) });
  } catch (error) {
    console.error("Resumes GET error:", error);
    return NextResponse.json(
      { error: "Failed to load resumes" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId: clerkId } = auth();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { name, content, template, atsScore } = await req.json();

    let dbUser = await prisma.user.findUnique({
      where: { clerkId },
    });

    if (!dbUser) {
      dbUser = await prisma.user.create({
        data: { clerkId, email: "" },
      });
    }

    const resume = await prisma.resume.create({
      data: {
        userId: dbUser.id,
        name: name || "Untitled Resume",
        content: content || "",
        template: template || "Modern",
        atsScore: atsScore || null,
        lastOptimized: atsScore ? new Date() : null,
      },
    });

    return NextResponse.json({ resume });
  } catch (error) {
    console.error("Resume POST error:", error);
    return NextResponse.json(
      { error: "Failed to create resume" },
      { status: 500 }
    );
  }
}
