import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { auth } from "~/server/better-auth";
import { db } from "~/server/db";
import { user } from "~/server/db/schema";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [row] = await db
    .select({ hasPassedKnowledgeCheck: user.hasPassedKnowledgeCheck })
    .from(user)
    .where(eq(user.id, session.user.id))
    .limit(1);

  return NextResponse.json({
    hasPassedKnowledgeCheck: row?.hasPassedKnowledgeCheck ?? false,
  });
}
