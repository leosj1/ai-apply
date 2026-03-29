// GET /api/ai/auto-apply/proof?jobId=xxx — Retrieve proof screenshots for a job application
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import fs from "fs";
import path from "path";

export async function GET(req: NextRequest) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { clerkId } });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 });

  // Verify the job belongs to this user
  const job = await prisma.jobApplication.findUnique({ where: { id: jobId } });
  if (!job || job.userId !== user.id) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  // Read proof file from disk
  const proofFile = path.join(process.cwd(), ".proof-screenshots", `${jobId}.json`);
  if (!fs.existsSync(proofFile)) {
    return NextResponse.json({
      hasProof: false,
      message: "No proof screenshots available for this application.",
      notes: job.notes || "",
    });
  }

  try {
    const proofData = JSON.parse(fs.readFileSync(proofFile, "utf-8"));
    return NextResponse.json({
      hasProof: true,
      company: proofData.company,
      role: proofData.role,
      platform: proofData.platform,
      appliedAt: proofData.appliedAt,
      email: proofData.email,
      url: proofData.url,
      steps: proofData.steps || [],
      screenshots: (proofData.screenshots || []).map((s: { step: string; screenshot: string }) => ({
        step: s.step,
        screenshot: `data:image/png;base64,${s.screenshot}`,
      })),
      notes: job.notes || "",
    });
  } catch {
    return NextResponse.json({ hasProof: false, message: "Failed to read proof data.", notes: job.notes || "" });
  }
}
