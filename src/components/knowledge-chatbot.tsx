"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";

type ChatMessage = {
  id: number;
  role: "assistant" | "user";
  text: string;
};

const CHAT_API_URL = "/api/chat";

function extractAssistantReply(data: unknown): string {
  if (typeof data === "string") return data;

  if (typeof data !== "object" || data === null) {
    return "I could not understand the response from the chat server.";
  }

  const candidate = data as {
    reply?: unknown;
    response?: unknown;
    message?: unknown;
    answer?: unknown;
    content?: unknown;
  };

  const fields = [
    candidate.reply,
    candidate.response,
    candidate.message,
    candidate.answer,
    candidate.content,
  ];

  for (const value of fields) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return "The chat server responded, but no text reply was found.";
}

export function KnowledgeChatbot() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
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
        text: "Hi! I am your chat assistant. Ask me anything.",
      });
    }
  }, [isOpen, messages.length]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    appendMessage({ role: "user", text: trimmed });
    setInput("");

    setIsLoading(true);

    try {
      const response = await fetch(CHAT_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        appendMessage({
          role: "assistant",
          text: `Chat API error (${response.status}): ${errorText || "Unknown error"}`,
        });
        return;
      }

      const data: unknown = await response.json();
      const assistantReply = extractAssistantReply(data);
      appendMessage({ role: "assistant", text: assistantReply });
    } catch (error) {
      appendMessage({
        role: "assistant",
        text:
          error instanceof Error
            ? error.message
            : "Failed to connect to chat server.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      {isOpen ? (
        <div className="fixed right-6 bottom-24 z-50 flex h-[min(70vh,560px)] w-[min(92vw,360px)] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <p className="text-sm font-semibold">Knowledge Assistant</p>
              <p className="text-muted-foreground text-xs">Chat assistant</p>
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
                {message.role === "assistant" ? (
                  <div className="space-y-2 wrap-break-word [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold [&_ol]:ml-4 [&_ol]:list-decimal [&_p]:leading-relaxed [&_ul]:ml-4 [&_ul]:list-disc [&_li]:leading-relaxed [&_code]:rounded [&_code]:bg-black/10 [&_code]:px-1 [&_code]:py-0.5 dark:[&_code]:bg-white/10">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {message.text}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <p>{message.text}</p>
                )}
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
            <div className="flex items-end gap-2">
              <Textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Type your message..."
                className="min-h-12 max-h-28"
                disabled={isLoading}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
              />
              <Button
                type="button"
                onClick={() => void sendMessage()}
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
          <rect x="5" y="8" width="14" height="11" rx="2" />
          <path d="M12 4v4" />
          <path d="M9 4h6" />
          <circle cx="10" cy="13" r="1" />
          <circle cx="14" cy="13" r="1" />
          <path d="M9 16h6" />
        </svg>
      </button>
    </>
  );
}
