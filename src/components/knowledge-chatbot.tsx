"use client";

import { useEffect, useRef, useState } from "react";

import { generateQuestionsAction, gradeTestAction } from "~/app/knowledge/actions";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";

type KnowledgeQuestion = {
  text: string;
  image_data?: string;
};

type ChatMessage = {
  id: number;
  role: "assistant" | "user";
  text: string;
  imageData?: string;
};

function normalizeImageSource(imageData: string): string {
  if (imageData.startsWith("http") || imageData.startsWith("data:")) {
    return imageData;
  }

  return `data:image/png;base64,${imageData}`;
}

export function KnowledgeChatbot() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [questions, setQuestions] = useState<KnowledgeQuestion[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [previouslyAsked, setPreviouslyAsked] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const nextMessageIdRef = useRef(1);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const appendMessage = (message: Omit<ChatMessage, "id">) => {
    const nextMessage: ChatMessage = {
      id: nextMessageIdRef.current,
      ...message,
    };

    nextMessageIdRef.current += 1;
    setMessages((prev) => [...prev, nextMessage]);
  };

  useEffect(() => {
    if (isOpen && messages.length === 0) {
      appendMessage({
        role: "assistant",
        text: "Hi! I can run your market readiness assessment here. Click Start Assessment to begin.",
      });
    }
  }, [isOpen, messages.length]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const startAssessment = async () => {
    setIsLoading(true);

    try {
      const res = await generateQuestionsAction(previouslyAsked);

      if (res.error) {
        appendMessage({
          role: "assistant",
          text:
            res.error === "Unauthorized"
              ? "Please log in to use the assessment chatbot."
              : res.error,
        });
        return;
      }

      if (res.questions.length === 0) {
        appendMessage({
          role: "assistant",
          text: "I could not generate questions right now. Please try again.",
        });
        return;
      }

      setQuestions(res.questions);
      setAnswers(new Array(res.questions.length).fill(""));
      setCurrentIndex(0);
      setPreviouslyAsked((prev) => [
        ...prev,
        ...res.questions.map((q) => q.text),
      ]);

      const firstQuestion = res.questions[0];
      if (firstQuestion) {
        appendMessage({
          role: "assistant",
          text: `Q1: ${firstQuestion.text}`,
          imageData: firstQuestion.image_data,
        });
      }
    } catch (error) {
      appendMessage({
        role: "assistant",
        text:
          error instanceof Error
            ? error.message
            : "Failed to start assessment. Please try again.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const submitCurrentAnswer = async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    appendMessage({ role: "user", text: trimmed });
    setInput("");

    if (questions.length === 0) {
      appendMessage({
        role: "assistant",
        text: "Click Start Assessment to generate your first question.",
      });
      return;
    }

    const updatedAnswers = [...answers];
    updatedAnswers[currentIndex] = trimmed;
    setAnswers(updatedAnswers);

    const nextIndex = currentIndex + 1;

    if (nextIndex < questions.length) {
      setCurrentIndex(nextIndex);
      const nextQuestion = questions[nextIndex];
      if (nextQuestion) {
        appendMessage({
          role: "assistant",
          text: `Q${nextIndex + 1}: ${nextQuestion.text}`,
          imageData: nextQuestion.image_data,
        });
      }
      return;
    }

    setIsLoading(true);

    try {
      const result = await gradeTestAction(questions, updatedAnswers);

      if (result.error) {
        appendMessage({ role: "assistant", text: `Grading failed: ${result.error}` });
        return;
      }

      appendMessage({
        role: "assistant",
        text: `Score: ${result.score}/10\n\n${result.feedback || "No feedback returned."}`,
      });

      if (result.passed) {
        appendMessage({
          role: "assistant",
          text: "Great work. You passed the assessment and your account is now unlocked.",
        });
      } else {
        appendMessage({
          role: "assistant",
          text: "You did not pass this attempt. You can click Start Assessment to try another set.",
        });
      }
    } catch (error) {
      appendMessage({
        role: "assistant",
        text:
          error instanceof Error
            ? error.message
            : "Failed to grade your answers. Please try again.",
      });
    } finally {
      setIsLoading(false);
      setQuestions([]);
      setAnswers([]);
      setCurrentIndex(0);
    }
  };

  return (
    <>
      {isOpen ? (
        <div className="fixed right-6 bottom-24 z-50 flex h-[min(70vh,560px)] w-[min(92vw,360px)] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <p className="text-sm font-semibold">Knowledge Assistant</p>
              <p className="text-muted-foreground text-xs">Assessment chat</p>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="text-muted-foreground hover:text-foreground rounded-full px-2 py-1 text-sm"
              aria-label="Close chatbot"
            >
              X
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${
                  message.role === "user"
                    ? "ml-auto bg-primary text-primary-foreground"
                    : "bg-muted text-foreground"
                }`}
              >
                <p>{message.text}</p>
                {message.imageData ? (
                  <div className="mt-2 overflow-hidden rounded-md border border-border bg-black/5 p-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={normalizeImageSource(message.imageData)}
                      alt="Question reference"
                      className="max-h-44 w-full rounded object-contain"
                    />
                  </div>
                ) : null}
              </div>
            ))}

            {isLoading ? (
              <div className="bg-muted max-w-[85%] rounded-xl px-3 py-2 text-sm text-foreground">
                Thinking...
              </div>
            ) : null}

            <div ref={messagesEndRef} />
          </div>

          <div className="space-y-2 border-t border-border p-3">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={startAssessment}
                disabled={isLoading}
              >
                Start Assessment
              </Button>
            </div>

            <div className="flex items-end gap-2">
              <Textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Type your answer..."
                className="min-h-12 max-h-28"
                disabled={isLoading}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void submitCurrentAnswer();
                  }
                }}
              />
              <Button
                type="button"
                onClick={() => void submitCurrentAnswer()}
                disabled={isLoading || input.trim().length === 0}
              >
                Send
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="fixed right-6 bottom-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-black text-white shadow-xl transition hover:scale-[1.03] dark:bg-white dark:text-black"
        aria-label="Open chatbot"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="h-6 w-6"
        >
          <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
        </svg>
      </button>
    </>
  );
}
