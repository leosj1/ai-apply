import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";

export async function POST(req: NextRequest) {
  try {
    const { userId } = auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }

    // Validate file type
    const validTypes = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain",
    ];
    if (!validTypes.includes(file.type)) {
      return NextResponse.json(
        { error: "Invalid file type. Supported: PDF, DOCX, TXT" },
        { status: 400 }
      );
    }

    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 10MB" },
        { status: 400 }
      );
    }

    // Extract text content based on file type
    let textContent = "";

    const buffer = Buffer.from(await file.arrayBuffer());

    if (file.type === "text/plain") {
      textContent = await file.text();
    } else if (file.type === "application/pdf") {
      const pdfData = await pdfParse(buffer);
      textContent = pdfData.text;
    } else if (
      file.type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      const result = await mammoth.extractRawText({ buffer });
      textContent = result.value;
    }

    // Ensure user exists in our database
    let dbUser = await prisma.user.findUnique({
      where: { clerkId: userId },
    });

    if (!dbUser) {
      dbUser = await prisma.user.create({
        data: {
          clerkId: userId,
          email: `${userId}@placeholder.com`,
        },
      });
    }

    // Store original PDF data as base64 for native rendering
    const isPdf = file.type === "application/pdf";
    const pdfBase64 = isPdf ? buffer.toString("base64") : null;

    // Save resume to database
    const resume = await prisma.resume.create({
      data: {
        userId: dbUser.id,
        name: file.name.replace(/\.[^/.]+$/, ""),
        content: textContent,
        template: "Modern",
        pdfData: pdfBase64,
        pdfMimeType: isPdf ? "application/pdf" : null,
      },
    });

    return NextResponse.json({
      resume: {
        id: resume.id,
        name: resume.name,
        template: resume.template,
        atsScore: resume.atsScore,
        lastOptimized: resume.lastOptimized,
        createdAt: resume.createdAt,
        updatedAt: resume.updatedAt,
      },
      message: "Resume uploaded successfully",
    });
  } catch (error) {
    console.error("Resume upload error:", error);
    return NextResponse.json(
      { error: "Failed to upload resume" },
      { status: 500 }
    );
  }
}
