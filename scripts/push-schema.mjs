// Push schema to Turso using libsql client directly
import { createClient } from "@libsql/client";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const client = createClient({
  url: process.env.TURSO_DATABASE_URL || "file:./prisma/dev.db",
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const statements = [
  `CREATE TABLE IF NOT EXISTS "ScrapedJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "url" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "location" TEXT,
    "salary" TEXT,
    "description" TEXT,
    "source" TEXT NOT NULL,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "employmentType" TEXT,
    "isRemote" INTEGER NOT NULL DEFAULT 0,
    "postedAt" DATETIME,
    "expiresAt" DATETIME,
    "scrapedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "active" INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "ScrapedJob_url_key" ON "ScrapedJob"("url")`,
  `CREATE INDEX IF NOT EXISTS "ScrapedJob_source_idx" ON "ScrapedJob"("source")`,
  `CREATE INDEX IF NOT EXISTS "ScrapedJob_isRemote_idx" ON "ScrapedJob"("isRemote")`,
  `CREATE INDEX IF NOT EXISTS "ScrapedJob_active_idx" ON "ScrapedJob"("active")`,
  `CREATE INDEX IF NOT EXISTS "ScrapedJob_scrapedAt_idx" ON "ScrapedJob"("scrapedAt")`,
];

for (const sql of statements) {
  try {
    await client.execute(sql);
    console.log("✓", sql.substring(0, 60) + "...");
  } catch (err) {
    console.error("✗", sql.substring(0, 60), err.message);
  }
}

console.log("\nDone! ScrapedJob table created.");
process.exit(0);
