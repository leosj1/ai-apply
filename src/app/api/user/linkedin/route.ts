import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

// GET: Check LinkedIn connection status and fetch profile data
export async function GET() {
  try {
    const { userId: clerkId } = auth();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get the user's OAuth accounts from Clerk
    const clerkUser = await clerkClient.users.getUser(clerkId);
    const linkedInAccount = clerkUser.externalAccounts?.find(
      (acc) => acc.provider === "oauth_linkedin" || acc.provider === "oauth_linkedin_oidc"
    );

    if (!linkedInAccount) {
      return NextResponse.json({
        connected: false,
        message: "LinkedIn not connected. Connect via your account settings.",
      });
    }

    // Try to get OAuth access token for LinkedIn
    let profileData = null;
    try {
      const tokens = await clerkClient.users.getUserOauthAccessToken(clerkId, "oauth_linkedin_oidc");
      const accessToken = tokens.data?.[0]?.token;

      if (accessToken) {
        // Fetch LinkedIn profile using the access token
        const profileRes = await fetch("https://api.linkedin.com/v2/userinfo", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (profileRes.ok) {
          const data = await profileRes.json();
          profileData = {
            firstName: data.given_name || null,
            lastName: data.family_name || null,
            email: data.email || null,
            picture: data.picture || null,
            headline: data.name || null,
            linkedInId: data.sub || null,
          };
        }
      }
    } catch (err) {
      console.error("Failed to fetch LinkedIn profile data:", err);
    }

    // Also include basic info from the Clerk external account
    return NextResponse.json({
      connected: true,
      provider: linkedInAccount.provider,
      linkedInEmail: linkedInAccount.emailAddress || null,
      linkedInName: `${linkedInAccount.firstName || ""} ${linkedInAccount.lastName || ""}`.trim() || null,
      linkedInImageUrl: linkedInAccount.imageUrl || null,
      profileData,
    });
  } catch (error) {
    console.error("LinkedIn status error:", error);
    return NextResponse.json({ error: "Failed to check LinkedIn status" }, { status: 500 });
  }
}

// POST: Import LinkedIn profile data into user profile
export async function POST() {
  try {
    const { userId: clerkId } = auth();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const clerkUser = await clerkClient.users.getUser(clerkId);
    const linkedInAccount = clerkUser.externalAccounts?.find(
      (acc) => acc.provider === "oauth_linkedin" || acc.provider === "oauth_linkedin_oidc"
    );

    if (!linkedInAccount) {
      return NextResponse.json({ error: "LinkedIn not connected" }, { status: 400 });
    }

    // Update user profile with LinkedIn data
    const updateData: Record<string, string | null> = {};

    if (linkedInAccount.firstName) updateData.firstName = linkedInAccount.firstName;
    if (linkedInAccount.lastName) updateData.lastName = linkedInAccount.lastName;
    if (linkedInAccount.imageUrl) updateData.imageUrl = linkedInAccount.imageUrl;

    // Build LinkedIn profile URL from the account
    const linkedInUrl = `https://www.linkedin.com/in/${linkedInAccount.username || linkedInAccount.externalId || ""}`;
    if (linkedInAccount.username || linkedInAccount.externalId) {
      updateData.linkedIn = linkedInUrl;
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.user.update({
        where: { clerkId },
        data: updateData,
      });
    }

    return NextResponse.json({
      success: true,
      imported: Object.keys(updateData),
      linkedInUrl: updateData.linkedIn || null,
    });
  } catch (error) {
    console.error("LinkedIn import error:", error);
    return NextResponse.json({ error: "Failed to import LinkedIn data" }, { status: 500 });
  }
}
