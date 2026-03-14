"use server";

import { env } from "~/env";
import { getSession } from "~/server/better-auth/server";
import { db } from "~/server/db";
import { user } from "~/server/db/schema";
import { eq } from "drizzle-orm";

type KnowledgeQuestion = {
  text: string;
  image_data?: string;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function parseQuestionsResponse(data: unknown): KnowledgeQuestion[] {
  if (typeof data !== "object" || data === null) return [];

  const maybeQuestions = (data as { questions?: unknown }).questions;
  if (!Array.isArray(maybeQuestions)) return [];

  return maybeQuestions.flatMap((question) => {
    if (typeof question !== "object" || question === null) return [];

    const maybeText = (question as { text?: unknown }).text;
    const maybeImageData = (question as { image_data?: unknown }).image_data;

    if (typeof maybeText !== "string") return [];

    return [
      {
        text: maybeText,
        ...(typeof maybeImageData === "string"
          ? { image_data: maybeImageData }
          : {}),
      },
    ];
  });
}

function parseGradeResponse(data: unknown): { feedback: string; score: number } {
  if (typeof data !== "object" || data === null) {
    return { feedback: "", score: 0 };
  }

  const maybeFeedback = (data as { feedback?: unknown }).feedback;
  const maybeScore = (data as { score?: unknown }).score;

  return {
    feedback: typeof maybeFeedback === "string" ? maybeFeedback : "",
    score: typeof maybeScore === "number" ? maybeScore : 0,
  };
}

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

    const data: unknown = await res.json();
    const questions = parseQuestionsResponse(data);

    return {
      questions,
      error: null,
    };
  } catch (error: unknown) {
    return {
      questions: [],
      error: `Failed to connect to Knowledge API: ${getErrorMessage(error)}`,
    };
  }
}

export async function gradeTestAction(
  questions: KnowledgeQuestion[],
  userAnswers: string[],
) {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");

  let qaText = "";
  for (let i = 0; i < questions.length; i++) {
    const question = questions[i];
    if (!question) continue;

    qaText += `Q${i + 1}: ${question.text}\nAnswer: ${userAnswers[i] ?? ""}\n\n`;
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

    const data: unknown = await res.json();
    const { feedback, score } = parseGradeResponse(data);
    const passed = score >= 8;

    if (passed) {
      // Update DB to flag that the user has passed the test
      await db
        .update(user)
        .set({ hasPassedKnowledgeCheck: true })
        .where(eq(user.id, session.user.id));
    }

    return {
      feedback,
      score,
      passed,
      error: null,
    };
  } catch (error: unknown) {
    return {
      feedback: "",
      score: 0,
      passed: false,
      error: getErrorMessage(error),
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
