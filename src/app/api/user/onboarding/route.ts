import { NextRequest, NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const { userId: clerkId } = auth();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let user = await prisma.user.findUnique({
      where: { clerkId },
      select: { onboardingComplete: true },
    });

    // Auto-create user if they don't exist in DB (e.g. webhook didn't fire in local dev)
    if (!user) {
      const clerkUser = await currentUser();
      if (clerkUser) {
        user = await prisma.user.create({
          data: {
            clerkId,
            email: clerkUser.emailAddresses[0]?.emailAddress || `${clerkId}@placeholder.com`,
            firstName: clerkUser.firstName || null,
            lastName: clerkUser.lastName || null,
            imageUrl: clerkUser.imageUrl || null,
          },
          select: { onboardingComplete: true },
        });
      }
    }

    return NextResponse.json({
      onboardingComplete: user?.onboardingComplete ?? false,
    });
  } catch (error) {
    console.error("Onboarding check error:", error);
    return NextResponse.json({ onboardingComplete: false });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId: clerkId } = auth();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { firstName, lastName, jobTitle, yearsExp, linkedIn, phone, location, workAuthorization, needsSponsorship, selectedRoles, selectedLocations, selectedSizes, salary } = body;

    let user = await prisma.user.findUnique({ where: { clerkId } });

    if (user) {
      user = await prisma.user.update({
        where: { clerkId },
        data: {
          firstName: firstName || user.firstName,
          lastName: lastName || user.lastName,
          jobTitle: jobTitle || user.jobTitle,
          yearsExp: yearsExp || user.yearsExp,
          linkedIn: linkedIn || user.linkedIn,
          phone: phone || user.phone,
          location: location || user.location,
          onboardingComplete: true,
        },
      });
    } else {
      const clerkUser = await currentUser();
      user = await prisma.user.create({
        data: {
          clerkId,
          email: clerkUser?.emailAddresses[0]?.emailAddress || `${clerkId}@placeholder.com`,
          firstName: firstName || clerkUser?.firstName || null,
          lastName: lastName || clerkUser?.lastName || null,
          imageUrl: clerkUser?.imageUrl || null,
          jobTitle,
          yearsExp,
          linkedIn,
          phone,
          location,
          onboardingComplete: true,
        },
      });
    }

    // Save preferences
    const prefsData: Record<string, unknown> = {
      targetRoles: JSON.stringify(selectedRoles || []),
      preferredLocations: JSON.stringify(selectedLocations || []),
      companySizes: JSON.stringify(selectedSizes || []),
      minSalary: salary || null,
    };
    if (workAuthorization) prefsData.workAuthorization = workAuthorization;
    if (typeof needsSponsorship === "boolean") prefsData.needsSponsorship = needsSponsorship;

    const existingPrefs = await prisma.userPreferences.findUnique({ where: { userId: user.id } });
    if (existingPrefs) {
      await prisma.userPreferences.update({ where: { userId: user.id }, data: prefsData });
    } else {
      await prisma.userPreferences.create({ data: { userId: user.id, ...prefsData } });
    }

    return NextResponse.json({ success: true, user });
  } catch (error) {
    console.error("Onboarding complete error:", error);
    return NextResponse.json(
      { error: "Failed to save onboarding data" },
      { status: 500 }
    );
  }
}
