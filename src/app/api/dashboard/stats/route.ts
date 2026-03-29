import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const { userId: clerkId } = auth();

    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let dbUser = await prisma.user.findUnique({
      where: { clerkId },
    });

    // Auto-create user if they don't exist in DB (e.g. webhook didn't fire in local dev)
    if (!dbUser) {
      const clerkUser = await currentUser();
      if (clerkUser) {
        dbUser = await prisma.user.create({
          data: {
            clerkId,
            email: clerkUser.emailAddresses[0]?.emailAddress || `${clerkId}@placeholder.com`,
            firstName: clerkUser.firstName || null,
            lastName: clerkUser.lastName || null,
            imageUrl: clerkUser.imageUrl || null,
          },
        });
      }
    }

    if (!dbUser) {
      return NextResponse.json({
        user: { firstName: null },
        stats: {
          applicationsSent: 0,
          interviewsSched: 0,
          responseRate: 0,
          avgAtsScore: 0,
        },
        recentApplications: [],
        recentInterviews: [],
      });
    }

    // Counts
    const [appCount, appliedCount, interviewCount, resumeCount] = await Promise.all([
      prisma.jobApplication.count({ where: { userId: dbUser.id } }),
      prisma.jobApplication.count({ where: { userId: dbUser.id, status: { in: ["applied", "interview", "phone_screen", "offer"] } } }),
      prisma.interviewSession.count({ where: { userId: dbUser.id } }),
      prisma.resume.count({ where: { userId: dbUser.id } }),
    ]);

    // Interview-status apps
    const interviewApps = await prisma.jobApplication.count({
      where: { userId: dbUser.id, status: "interview" },
    });

    // Average ATS score from resumes
    const resumes = await prisma.resume.findMany({
      where: { userId: dbUser.id, atsScore: { not: null } },
      select: { atsScore: true },
    });
    const avgAts =
      resumes.length > 0
        ? Math.round(
            resumes.reduce((sum, r) => sum + (r.atsScore || 0), 0) /
              resumes.length
          )
        : 0;

    // Response rate (apps with status != queued and != applied)
    const respondedApps = await prisma.jobApplication.count({
      where: {
        userId: dbUser.id,
        status: { in: ["interview", "offer", "rejected"] },
      },
    });
    const responseRate =
      appCount > 0 ? Math.round((respondedApps / appCount) * 100) : 0;

    // Recent applications (last 6)
    const recentApps = await prisma.jobApplication.findMany({
      where: { userId: dbUser.id },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        id: true,
        company: true,
        role: true,
        status: true,
        matchScore: true,
        createdAt: true,
      },
    });

    // Recent interview sessions (last 2)
    const recentInterviews = await prisma.interviewSession.findMany({
      where: { userId: dbUser.id },
      orderBy: { createdAt: "desc" },
      take: 2,
      select: {
        id: true,
        interviewType: true,
        company: true,
        role: true,
        overallScore: true,
        createdAt: true,
      },
    });

    // Weekly activity — count applications per day for last 7 days
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const weekApps = await prisma.jobApplication.findMany({
      where: { userId: dbUser.id, createdAt: { gte: weekAgo } },
      select: { createdAt: true },
    });
    const dayNames = ["S", "M", "T", "W", "T", "F", "S"];
    const weeklyActivity: { day: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      const count = weekApps.filter((a) => a.createdAt >= dayStart && a.createdAt < dayEnd).length;
      weeklyActivity.push({ day: dayNames[d.getDay()], count });
    }

    // Top companies by application count
    const companyGroups: Record<string, { total: number; responded: number }> = {};
    const allApps = await prisma.jobApplication.findMany({
      where: { userId: dbUser.id },
      select: { company: true, status: true },
    });
    for (const a of allApps) {
      if (!companyGroups[a.company]) companyGroups[a.company] = { total: 0, responded: 0 };
      companyGroups[a.company].total++;
      if (["interview", "offer", "phone_screen"].includes(a.status)) companyGroups[a.company].responded++;
    }
    const topCompanies = Object.entries(companyGroups)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 5)
      .map(([name, d]) => ({ name, applications: d.total, responses: d.responded, rate: d.total > 0 ? `${Math.round((d.responded / d.total) * 100)}%` : "0%" }));

    // Top skills from job tags
    const tagApps = await prisma.jobApplication.findMany({
      where: { userId: dbUser.id, tags: { not: "" } },
      select: { tags: true },
    });
    const skillCounts: Record<string, number> = {};
    for (const a of tagApps) {
      try {
        const tags: string[] = JSON.parse(a.tags || "[]");
        for (const t of tags) { skillCounts[t] = (skillCounts[t] || 0) + 1; }
      } catch { /* */ }
    }
    const topSkills = Object.entries(skillCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([skill, mentions]) => ({ skill, mentions }));

    return NextResponse.json({
      user: { firstName: dbUser.firstName },
      stats: {
        applicationsSent: appliedCount,
        jobsFound: appCount,
        interviewsSched: interviewApps,
        responseRate,
        avgAtsScore: avgAts,
      },
      weeklyActivity,
      topCompanies,
      topSkills,
      recentApplications: recentApps.map((a) => ({
        id: a.id,
        company: a.company,
        role: a.role,
        status: a.status,
        match: a.matchScore || 0,
        time: formatRelativeTime(a.createdAt),
      })),
      recentInterviews: recentInterviews.map((i) => ({
        id: i.id,
        company: i.company || "Practice",
        role: i.role || i.interviewType,
        type: i.interviewType,
        score: i.overallScore,
        date: i.createdAt.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
      })),
    });
  } catch (error) {
    console.error("Dashboard stats error:", error);
    return NextResponse.json(
      { error: "Failed to load dashboard stats" },
      { status: 500 }
    );
  }
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}
