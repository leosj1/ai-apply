import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Webhook } from "svix";

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();

    // Verify webhook signature — required in production
    const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error("[webhook] CLERK_WEBHOOK_SECRET is not set — rejecting webhook");
      return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
    }
    {
      const svixId = req.headers.get("svix-id");
      const svixTimestamp = req.headers.get("svix-timestamp");
      const svixSignature = req.headers.get("svix-signature");

      if (!svixId || !svixTimestamp || !svixSignature) {
        return NextResponse.json(
          { error: "Missing svix headers" },
          { status: 400 }
        );
      }

      const wh = new Webhook(webhookSecret);
      try {
        wh.verify(body, {
          "svix-id": svixId,
          "svix-timestamp": svixTimestamp,
          "svix-signature": svixSignature,
        });
      } catch {
        return NextResponse.json(
          { error: "Invalid webhook signature" },
          { status: 401 }
        );
      }
    }

    const payload = JSON.parse(body);
    const { type, data } = payload;

    switch (type) {
      case "user.created": {
        await prisma.user.upsert({
          where: { clerkId: data.id },
          update: {
            email: data.email_addresses?.[0]?.email_address || "",
            firstName: data.first_name || null,
            lastName: data.last_name || null,
            imageUrl: data.image_url || null,
          },
          create: {
            clerkId: data.id,
            email: data.email_addresses?.[0]?.email_address || "",
            firstName: data.first_name || null,
            lastName: data.last_name || null,
            imageUrl: data.image_url || null,
          },
        });
        break;
      }

      case "user.updated": {
        await prisma.user.upsert({
          where: { clerkId: data.id },
          update: {
            email: data.email_addresses?.[0]?.email_address || "",
            firstName: data.first_name || null,
            lastName: data.last_name || null,
            imageUrl: data.image_url || null,
          },
          create: {
            clerkId: data.id,
            email: data.email_addresses?.[0]?.email_address || "",
            firstName: data.first_name || null,
            lastName: data.last_name || null,
            imageUrl: data.image_url || null,
          },
        });
        break;
      }

      case "user.deleted": {
        await prisma.user.deleteMany({
          where: { clerkId: data.id },
        });
        break;
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}
