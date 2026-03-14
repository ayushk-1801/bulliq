"use server";

import { env } from "~/env";
import { getSession } from "~/server/better-auth/server";
import { db } from "~/server/db";
import { user } from "~/server/db/schema";
import { eq } from "drizzle-orm";

export async function generateQuestionsAction(previouslyAsked: string[]) {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");

  try {
    const res = await fetch(`${env.KNOWLEDGE_API_URL}/generate_questions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ previously_asked: previouslyAsked }),
    });

    if (!res.ok) {
      throw new Error(`API Error: ${await res.text()}`);
    }

    const data = await res.json();
    return {
      questions: data.questions || [],
      error: null,
    };
  } catch (error: any) {
    return {
      questions: [],
      error: `Failed to connect to Knowledge API: ${error.message}`,
    };
  }
}

export async function gradeTestAction(questions: any[], userAnswers: string[]) {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");

  let qaText = "";
  for (let i = 0; i < questions.length; i++) {
    qaText += `Q${i + 1}: ${questions[i].text}\nAnswer: ${userAnswers[i]}\n\n`;
  }

  try {
    const res = await fetch(`${env.KNOWLEDGE_API_URL}/grade_test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qa_pairs: qaText }),
    });

    if (!res.ok) {
      throw new Error("Error from API during grading");
    }

    const data = await res.json();
    const passed = data.score >= 8;

    if (passed) {
      // Update DB to flag that the user has passed the test
      await db
        .update(user)
        .set({ hasPassedKnowledgeCheck: true })
        .where(eq(user.id, session.user.id));
    }

    return {
      feedback: data.feedback as string,
      score: data.score as number,
      passed,
      error: null,
    };
  } catch (error: any) {
    return {
      feedback: "",
      score: 0,
      passed: false,
      error: error.message,
    };
  }
}

export async function skipTestAction() {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");

  await db
    .update(user)
    .set({ hasPassedKnowledgeCheck: true })
    .where(eq(user.id, session.user.id));

  return { success: true };
}
