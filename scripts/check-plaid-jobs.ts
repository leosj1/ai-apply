#!/usr/bin/env npx tsx
import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local", override: true });

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";

const adapter = new PrismaLibSql({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const db = new (PrismaClient as any)({ adapter }) as PrismaClient;

async function main() {
  const plaidJobs = await (db as any).jobApplication.findMany({
    where: { company: { contains: "Plaid" } },
    select: {
      id: true,
      role: true,
      company: true,
      matchScore: true,
      status: true,
      url: true,
      createdAt: true,
    },
    orderBy: { matchScore: "desc" },
  });

  console.log(`\nFound ${plaidJobs.length} Plaid jobs in DB:\n`);
  for (const j of plaidJobs) {
    console.log(`  [${j.matchScore ?? "?"}%] ${j.role} — ${j.status}`);
    console.log(`    ${j.url}`);
    console.log(`    id: ${j.id}`);
    console.log();
  }

  // Show user profile (actual schema fields)
  const user = await (db as any).user.findFirst({
    select: { id: true, email: true, firstName: true, lastName: true, jobTitle: true, yearsExp: true, location: true, linkedIn: true },
  });
  console.log("User profile:", JSON.stringify(user, null, 2));

  // Show user preferences (skills, target roles)
  const prefs = await (db as any).userPreferences.findFirst({
    where: { userId: user?.id },
  });
  console.log("Preferences:", JSON.stringify(prefs, null, 2));
}

main().then(() => db.$disconnect()).catch(e => { console.error(e); db.$disconnect(); });
