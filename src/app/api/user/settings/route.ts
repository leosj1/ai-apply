import { NextRequest, NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const { userId } = auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let dbUser = await prisma.user.findUnique({
      where: { clerkId: userId },
      include: { preferences: true },
    });

    if (!dbUser) {
      const clerkUser = await currentUser();
      dbUser = await prisma.user.create({
        data: {
          clerkId: userId,
          email: clerkUser?.emailAddresses[0]?.emailAddress || "",
          firstName: clerkUser?.firstName || null,
          lastName: clerkUser?.lastName || null,
          imageUrl: clerkUser?.imageUrl || null,
        },
        include: { preferences: true },
      });
    }

    const p = dbUser.preferences;
    return NextResponse.json({
      profile: {
        firstName: dbUser.firstName || "",
        lastName: dbUser.lastName || "",
        email: dbUser.email,
        jobTitle: dbUser.jobTitle || "",
        yearsExp: dbUser.yearsExp || "",
        linkedIn: dbUser.linkedIn || "",
        phone: dbUser.phone || "",
        location: dbUser.location || "",
        imageUrl: dbUser.imageUrl || "",
      },
      preferences: p
        ? {
            targetRoles: JSON.parse(p.targetRoles),
            preferredLocations: JSON.parse(p.preferredLocations),
            companySizes: JSON.parse(p.companySizes),
            minSalary: p.minSalary || "",
            skills: (() => { try { return JSON.parse(p.skills); } catch { return []; } })(),
            autoApplyActive: p.autoApplyActive,
            // Immigration & work authorization
            immigrationStatus: p.immigrationStatus || "",
            needsSponsorship: p.needsSponsorship,
            workAuthorization: p.workAuthorization || "",
            // Career pivot
            currentRole: p.currentRole || "",
            isPivoting: p.isPivoting,
            pivotFromRole: p.pivotFromRole || "",
            pivotToRole: p.pivotToRole || "",
            pivotTransferableSkills: (() => { try { return JSON.parse(p.pivotTransferableSkills || "[]"); } catch { return []; } })(),
            // Job type preferences
            employmentTypes: (() => { try { return JSON.parse(p.employmentTypes); } catch { return ["FULLTIME"]; } })(),
            experienceLevel: p.experienceLevel || "",
          }
        : {
            targetRoles: [],
            preferredLocations: [],
            companySizes: [],
            minSalary: "",
            skills: [],
            autoApplyActive: false,
            immigrationStatus: "",
            needsSponsorship: false,
            workAuthorization: "",
            currentRole: "",
            isPivoting: false,
            pivotFromRole: "",
            pivotToRole: "",
            pivotTransferableSkills: [],
            employmentTypes: ["FULLTIME"],
            experienceLevel: "",
          },
    });
  } catch (error) {
    console.error("Settings GET error:", error);
    return NextResponse.json(
      { error: "Failed to load settings" },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { userId } = auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { profile, preferences } = await req.json();

    const dbUser = await prisma.user.upsert({
      where: { clerkId: userId },
      update: {
        firstName: profile?.firstName,
        lastName: profile?.lastName,
        jobTitle: profile?.jobTitle,
        yearsExp: profile?.yearsExp,
        linkedIn: profile?.linkedIn,
        phone: profile?.phone,
        location: profile?.location,
      },
      create: {
        clerkId: userId,
        email: profile?.email || "",
        firstName: profile?.firstName,
        lastName: profile?.lastName,
        jobTitle: profile?.jobTitle,
        yearsExp: profile?.yearsExp,
        linkedIn: profile?.linkedIn,
        phone: profile?.phone,
        location: profile?.location,
      },
    });

    if (preferences) {
      const prefData = {
        targetRoles: JSON.stringify(preferences.targetRoles || []),
        preferredLocations: JSON.stringify(preferences.preferredLocations || []),
        companySizes: JSON.stringify(preferences.companySizes || []),
        minSalary: preferences.minSalary || null,
        skills: JSON.stringify(preferences.skills || []),
        autoApplyActive: preferences.autoApplyActive ?? false,
        // Immigration & work authorization
        immigrationStatus: preferences.immigrationStatus || null,
        needsSponsorship: preferences.needsSponsorship ?? false,
        workAuthorization: preferences.workAuthorization || null,
        // Career pivot
        currentRole: preferences.currentRole || null,
        isPivoting: preferences.isPivoting ?? false,
        pivotFromRole: preferences.pivotFromRole || null,
        pivotToRole: preferences.pivotToRole || null,
        pivotTransferableSkills: JSON.stringify(preferences.pivotTransferableSkills || []),
        // Job type preferences
        employmentTypes: JSON.stringify(preferences.employmentTypes || ["FULLTIME"]),
        experienceLevel: preferences.experienceLevel || null,
      };
      await prisma.userPreferences.upsert({
        where: { userId: dbUser.id },
        update: prefData,
        create: { userId: dbUser.id, ...prefData },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Settings PUT error:", error);
    return NextResponse.json(
      { error: "Failed to save settings" },
      { status: 500 }
    );
  }
}
