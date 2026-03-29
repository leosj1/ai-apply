import { createClient } from "@libsql/client";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const migrations = [
  // Add new columns to UserPreferences
  `ALTER TABLE "UserPreferences" ADD COLUMN "scanInterval" TEXT NOT NULL DEFAULT 'daily'`,
  `ALTER TABLE "UserPreferences" ADD COLUMN "lastScannedAt" DATETIME`,
  `ALTER TABLE "UserPreferences" ADD COLUMN "autoScanActive" BOOLEAN NOT NULL DEFAULT false`,
  // Add new columns to JobApplication
  `ALTER TABLE "JobApplication" ADD COLUMN "source" TEXT`,
  `ALTER TABLE "JobApplication" ADD COLUMN "matchBreakdown" TEXT`,
  // Create Notification table
  `ALTER TABLE "UserPreferences" ADD COLUMN "scanCredits" INTEGER NOT NULL DEFAULT 50`,
  `CREATE TABLE IF NOT EXISTS "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
];

for (const sql of migrations) {
  try {
    await client.execute(sql);
    console.log("✓", sql.slice(0, 80) + "...");
  } catch (err) {
    if (err.message?.includes("duplicate column") || err.message?.includes("already exists")) {
      console.log("⏭ Already exists:", sql.slice(0, 60) + "...");
    } else {
      console.error("✗", err.message, "\n  SQL:", sql.slice(0, 80));
    }
  }
}

console.log("\nDone! Generating Prisma client...");
