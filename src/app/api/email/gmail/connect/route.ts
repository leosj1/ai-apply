// GET /api/email/gmail/connect — Redirect user to Google OAuth consent screen
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getGmailAuthUrl } from "@/lib/email/gmail";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const url = getGmailAuthUrl(userId);
    return NextResponse.redirect(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to generate auth URL";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
