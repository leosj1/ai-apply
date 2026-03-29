import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// One-time migration endpoint — run once then delete
// POST /api/migrate
export async function POST() {
  const results: string[] = [];

  const alterStatements = [
    // UserPreferences new columns
    `ALTER TABLE "UserPreferences" ADD COLUMN "skills" TEXT NOT NULL DEFAULT '[]'`,
    `ALTER TABLE "UserPreferences" ADD COLUMN "immigrationStatus" TEXT`,
    `ALTER TABLE "UserPreferences" ADD COLUMN "needsSponsorship" BOOLEAN NOT NULL DEFAULT false`,
    `ALTER TABLE "UserPreferences" ADD COLUMN "workAuthorization" TEXT`,
    `ALTER TABLE "UserPreferences" ADD COLUMN "currentRole" TEXT`,
    `ALTER TABLE "UserPreferences" ADD COLUMN "isPivoting" BOOLEAN NOT NULL DEFAULT false`,
    `ALTER TABLE "UserPreferences" ADD COLUMN "pivotFromRole" TEXT`,
    `ALTER TABLE "UserPreferences" ADD COLUMN "pivotToRole" TEXT`,
    `ALTER TABLE "UserPreferences" ADD COLUMN "pivotTransferableSkills" TEXT`,
    `ALTER TABLE "UserPreferences" ADD COLUMN "employmentTypes" TEXT NOT NULL DEFAULT '["FULLTIME"]'`,
    `ALTER TABLE "UserPreferences" ADD COLUMN "experienceLevel" TEXT`,
    // User onboardingComplete (may already exist)
    `ALTER TABLE "User" ADD COLUMN "onboardingComplete" BOOLEAN NOT NULL DEFAULT false`,
    // User phone and location for auto-apply
    `ALTER TABLE "User" ADD COLUMN "phone" TEXT`,
    `ALTER TABLE "User" ADD COLUMN "location" TEXT`,
    // JobApplication notes for proof of application
    `ALTER TABLE "JobApplication" ADD COLUMN "notes" TEXT`,
    // Resume PDF storage
    `ALTER TABLE "Resume" ADD COLUMN "pdfData" TEXT`,
    `ALTER TABLE "Resume" ADD COLUMN "pdfMimeType" TEXT`,
    // Email Hub: proxyEmail on JobApplication
    `ALTER TABLE "JobApplication" ADD COLUMN "proxyEmail" TEXT`,
    // Email Hub: GmailToken table
    `CREATE TABLE IF NOT EXISTS "GmailToken" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL UNIQUE,
      "accessToken" TEXT NOT NULL,
      "refreshToken" TEXT NOT NULL,
      "expiresAt" DATETIME NOT NULL,
      "email" TEXT NOT NULL,
      "historyId" TEXT,
      "lastSyncAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      CONSTRAINT "GmailToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )`,
    // Email Hub: EmailMessage table
    `CREATE TABLE IF NOT EXISTS "EmailMessage" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "jobApplicationId" TEXT,
      "gmailMessageId" TEXT,
      "threadId" TEXT,
      "direction" TEXT NOT NULL,
      "fromEmail" TEXT NOT NULL,
      "fromName" TEXT,
      "toEmail" TEXT NOT NULL,
      "toName" TEXT,
      "subject" TEXT NOT NULL,
      "bodyText" TEXT,
      "bodyHtml" TEXT,
      "category" TEXT,
      "proxyTag" TEXT,
      "isRead" BOOLEAN NOT NULL DEFAULT false,
      "hasAttachments" BOOLEAN NOT NULL DEFAULT false,
      "attachments" TEXT,
      "sentAt" DATETIME NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "EmailMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "EmailMessage_jobApplicationId_fkey" FOREIGN KEY ("jobApplicationId") REFERENCES "JobApplication" ("id") ON DELETE SET NULL ON UPDATE CASCADE
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "EmailMessage_gmailMessageId_key" ON "EmailMessage"("gmailMessageId")`,
    `CREATE INDEX IF NOT EXISTS "EmailMessage_userId_idx" ON "EmailMessage"("userId")`,
    `CREATE INDEX IF NOT EXISTS "EmailMessage_jobApplicationId_idx" ON "EmailMessage"("jobApplicationId")`,
    `CREATE INDEX IF NOT EXISTS "EmailMessage_threadId_idx" ON "EmailMessage"("threadId")`,
    `CREATE INDEX IF NOT EXISTS "EmailMessage_proxyTag_idx" ON "EmailMessage"("proxyTag")`,
    `CREATE INDEX IF NOT EXISTS "EmailMessage_category_idx" ON "EmailMessage"("category")`,
  ];

  for (const sql of alterStatements) {
    try {
      await prisma.$executeRawUnsafe(sql);
      results.push(`OK: ${sql.substring(0, 60)}...`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("duplicate column") || msg.includes("already exists")) {
        results.push(`SKIP (exists): ${sql.substring(0, 60)}...`);
      } else {
        results.push(`ERR: ${sql.substring(0, 60)}... — ${msg}`);
      }
    }
  }

  // Seed phone/location for existing users that don't have them
  try {
    await prisma.$executeRawUnsafe(`UPDATE "User" SET phone = '5015024609' WHERE phone IS NULL`);
    await prisma.$executeRawUnsafe(`UPDATE "User" SET location = 'California' WHERE location IS NULL`);
    results.push("SEED: Updated users with phone/location");
  } catch (seedErr) {
    results.push(`SEED ERR: ${seedErr instanceof Error ? seedErr.message : String(seedErr)}`);
  }

  return NextResponse.json({ results });
}
