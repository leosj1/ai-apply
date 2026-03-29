// Email Hub API
// GET  /api/email — List emails (optionally filtered by jobId, category, unread)
// POST /api/email — Actions: sync, send, disconnect

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { clerkId } });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const { searchParams } = req.nextUrl;
  const jobId = searchParams.get("jobId");
  const category = searchParams.get("category");
  const unreadOnly = searchParams.get("unread") === "true";
  const threadId = searchParams.get("threadId");
  const limit = parseInt(searchParams.get("limit") || "50", 10);

  // Check email connection status (Gmail OAuth or IMAP)
  let emailToken = await prisma.gmailToken.findUnique({
    where: { userId: user.id },
    select: { email: true, lastSyncAt: true, refreshToken: true },
  });

  // Auto-connect: if not connected, try to grab Google OAuth token from Clerk
  if (!emailToken) {
    const { autoConnectGmailFromClerk } = await import("@/lib/email/gmail");
    const connected = await autoConnectGmailFromClerk(clerkId, user.id, user.email);
    if (connected) {
      emailToken = await prisma.gmailToken.findUnique({
        where: { userId: user.id },
        select: { email: true, lastSyncAt: true, refreshToken: true },
      });
    }
  }

  const isImap = emailToken?.refreshToken?.startsWith("imap://") || false;
  const provider = emailToken ? (isImap ? "imap" : "gmail") : null;

  // If requesting a specific thread
  if (threadId) {
    const { getEmailThread } = await import("@/lib/email/gmail");
    const emails = await getEmailThread(user.id, threadId);
    return NextResponse.json({ emails, gmailConnected: !!emailToken, gmailEmail: emailToken?.email, provider });
  }

  // If requesting emails for a specific job
  if (jobId) {
    const { getEmailsForJob } = await import("@/lib/email/gmail");
    const emails = await getEmailsForJob(user.id, jobId);
    return NextResponse.json({ emails, gmailConnected: !!emailToken, gmailEmail: emailToken?.email, provider });
  }

  // General email listing
  const { getAllEmails } = await import("@/lib/email/gmail");
  const emails = await getAllEmails(user.id, {
    category: category || undefined,
    unreadOnly,
    limit,
  });

  // Get email stats
  const totalEmails = await prisma.emailMessage.count({ where: { userId: user.id } });
  const unreadCount = await prisma.emailMessage.count({ where: { userId: user.id, isRead: false } });
  const linkedCount = await prisma.emailMessage.count({ where: { userId: user.id, jobApplicationId: { not: null } } });

  return NextResponse.json({
    emails,
    stats: { total: totalEmails, unread: unreadCount, linked: linkedCount },
    gmailConnected: !!emailToken,
    gmailEmail: emailToken?.email,
    lastSyncAt: emailToken?.lastSyncAt,
    provider,
  });
}

export async function POST(req: NextRequest) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { clerkId } });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const body = await req.json();
  const { action } = body;

  // ── SYNC — Pull new emails (auto-detect Gmail vs IMAP) ──
  if (action === "sync") {
    const token = await prisma.gmailToken.findUnique({ where: { userId: user.id } });
    if (!token) return NextResponse.json({ error: "No email provider connected" }, { status: 400 });

    const isImapProvider = token.refreshToken.startsWith("imap://");
    if (isImapProvider) {
      const { syncImapInbox } = await import("@/lib/email/imap");
      const result = await syncImapInbox(user.id);
      return NextResponse.json({ success: true, ...result });
    } else {
      const { syncGmailInbox } = await import("@/lib/email/gmail");
      const result = await syncGmailInbox(user.id);
      return NextResponse.json({ success: true, ...result });
    }
  }

  // ── CONNECT IMAP — For non-Gmail providers (Outlook, Yahoo, etc.) ──
  if (action === "connectImap") {
    const { email: imapEmail, password, host, port } = body;
    if (!imapEmail || !password) {
      return NextResponse.json({ error: "email and password are required" }, { status: 400 });
    }

    const { saveImapCredentials, getImapConfig } = await import("@/lib/email/imap");
    // Auto-detect IMAP config if host not provided
    const autoConfig = getImapConfig(imapEmail);
    const finalHost = host || autoConfig?.host;
    const finalPort = port || autoConfig?.port || 993;

    if (!finalHost) {
      return NextResponse.json({ error: "Could not auto-detect IMAP settings. Please provide host and port." }, { status: 400 });
    }

    await saveImapCredentials(user.id, {
      email: imapEmail,
      password,
      host: finalHost,
      port: finalPort,
      tls: true,
    });

    return NextResponse.json({ success: true, email: imapEmail, provider: "imap" });
  }

  // ── SEND — Send an email via connected provider ──
  if (action === "send") {
    const { to, subject, body: emailBody, jobApplicationId, replyToMessageId } = body;
    if (!to || !subject || !emailBody) {
      return NextResponse.json({ error: "to, subject, and body are required" }, { status: 400 });
    }

    const token = await prisma.gmailToken.findUnique({ where: { userId: user.id } });
    if (!token) return NextResponse.json({ error: "No email provider connected" }, { status: 400 });

    const isImapProvider = token.refreshToken.startsWith("imap://");
    if (isImapProvider) {
      // For IMAP providers, sending is done via SMTP (same credentials)
      // For now, return an error — SMTP sending for IMAP will be added later
      return NextResponse.json({ error: "Sending via IMAP providers is not yet supported. Use your email client to reply." }, { status: 400 });
    }

    const { sendEmailViaGmail } = await import("@/lib/email/gmail");
    const result = await sendEmailViaGmail(user.id, to, subject, emailBody, jobApplicationId, replyToMessageId);
    return NextResponse.json(result);
  }

  // ── MARK READ ──
  if (action === "markRead") {
    const { emailId } = body;
    if (!emailId) return NextResponse.json({ error: "emailId required" }, { status: 400 });

    await prisma.emailMessage.update({
      where: { id: emailId },
      data: { isRead: true },
    });
    return NextResponse.json({ success: true });
  }

  // ── DISCONNECT — Remove Gmail OAuth tokens ──
  if (action === "disconnect") {
    await prisma.gmailToken.deleteMany({ where: { userId: user.id } });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
