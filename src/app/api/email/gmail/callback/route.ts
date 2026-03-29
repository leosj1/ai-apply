// GET /api/email/gmail/callback — Handle Google OAuth callback
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { exchangeCodeForTokens } from "@/lib/email/gmail";
import { prisma } from "@/lib/prisma";
import { google } from "googleapis";

export async function GET(req: NextRequest) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.redirect(new URL("/sign-in", req.url));

  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");

  if (error) {
    console.error("[Gmail OAuth] Error:", error);
    return NextResponse.redirect(new URL("/dashboard/settings?gmail=error", req.url));
  }

  if (!code) {
    return NextResponse.redirect(new URL("/dashboard/settings?gmail=no_code", req.url));
  }

  try {
    const tokens = await exchangeCodeForTokens(code);

    // Get the user's Gmail address
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: tokens.access_token });
    const gmail = google.gmail({ version: "v1", auth: oauth2Client });
    const profile = await gmail.users.getProfile({ userId: "me" });
    const gmailEmail = profile.data.emailAddress || "";

    // Find our internal user
    const user = await prisma.user.findUnique({ where: { clerkId } });
    if (!user) {
      return NextResponse.redirect(new URL("/dashboard/settings?gmail=user_not_found", req.url));
    }

    // Upsert Gmail token
    await prisma.gmailToken.upsert({
      where: { userId: user.id },
      update: {
        accessToken: tokens.access_token!,
        refreshToken: tokens.refresh_token || "",
        expiresAt: new Date(tokens.expiry_date || Date.now() + 3600000),
        email: gmailEmail,
      },
      create: {
        userId: user.id,
        accessToken: tokens.access_token!,
        refreshToken: tokens.refresh_token || "",
        expiresAt: new Date(tokens.expiry_date || Date.now() + 3600000),
        email: gmailEmail,
      },
    });

    // Redirect back to auto-apply page (where the Connect Gmail button is)
    return NextResponse.redirect(new URL("/dashboard/auto-apply?gmail=connected", req.url));
  } catch (err) {
    console.error("[Gmail OAuth] Token exchange failed:", err);
    return NextResponse.redirect(new URL("/dashboard/settings?gmail=token_error", req.url));
  }
}
