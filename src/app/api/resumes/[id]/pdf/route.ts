import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

// GET /api/resumes/[id]/pdf — serve the original uploaded PDF
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { userId: clerkId } = auth();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const dbUser = await prisma.user.findUnique({ where: { clerkId } });
    if (!dbUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const resume = await prisma.resume.findUnique({
      where: { id: params.id },
      select: { userId: true, pdfData: true, pdfMimeType: true, name: true },
    });

    if (!resume || resume.userId !== dbUser.id) {
      return NextResponse.json({ error: "Resume not found" }, { status: 404 });
    }

    if (!resume.pdfData) {
      return NextResponse.json({ error: "No PDF data available for this resume" }, { status: 404 });
    }

    const pdfBuffer = Buffer.from(resume.pdfData, "base64");

    return new NextResponse(pdfBuffer, {
      headers: {
        "Content-Type": resume.pdfMimeType || "application/pdf",
        "Content-Disposition": `inline; filename="${resume.name}.pdf"`,
        "Content-Length": String(pdfBuffer.length),
      },
    });
  } catch (error) {
    console.error("PDF serve error:", error);
    return NextResponse.json({ error: "Failed to serve PDF" }, { status: 500 });
  }
}
