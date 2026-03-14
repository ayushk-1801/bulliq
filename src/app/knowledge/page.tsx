"use client";

import { useState, useEffect } from "react";
import { generateQuestionsAction, gradeTestAction, skipTestAction } from "./actions";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";

export default function KnowledgeCheckPage() {
  const [questions, setQuestions] = useState<any[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [attempt, setAttempt] = useState(1);
  const [passed, setPassed] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [score, setScore] = useState(0);

  const [isLoading, setIsLoading] = useState(false);
  const [userAnswers, setUserAnswers] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (questions.length === 0 && !passed) {
      loadQuestions();
    }
  }, [questions, passed, attempt]);

  async function loadQuestions() {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await generateQuestionsAction(history);
      if (res.error) {
        setErrorMsg(res.error);
        setIsLoading(false);
        return;
      }
      setQuestions(res.questions);
      setHistory((prev) => [...prev, ...res.questions.map((q: any) => q.text)]);
      setUserAnswers(new Array(res.questions.length).fill(""));
      setCurrentIndex(0);
    } catch (e: any) {
      setErrorMsg(e.message);
    }
    setIsLoading(false);
  }

  async function handleSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (userAnswers.some((ans) => ans.trim() === "")) {
      setErrorMsg("Please answer all questions before submitting.");
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);

    try {
      const res = await gradeTestAction(questions, userAnswers);
      if (res.error) {
        setErrorMsg(res.error);
        setIsLoading(false);
        return;
      }

      setFeedback(res.feedback);
      setScore(res.score);
      
      if (res.passed) {
        setPassed(true);
      } else {
        setQuestions([]);
        setAttempt((prev) => prev + 1);
      }
    } catch (e: any) {
      setErrorMsg("Error grading test: " + e.message);
    }

    setIsLoading(false);
  }

  async function handleSkip() {
    setIsLoading(true);
    try {
      await skipTestAction();
      window.location.href = "/";
    } catch (e) {
      setErrorMsg("Failed to skip the assessment.");
      setIsLoading(false);
    }
  }

  const currentQuestion = questions[currentIndex];
  const isLastQuestion = currentIndex === questions.length - 1;

  function goNext() {
    if ((userAnswers[currentIndex] || "").trim() === "") {
      setErrorMsg("Please provide an answer before continuing.");
      return;
    }
    setErrorMsg(null);
    setCurrentIndex((prev) => prev + 1);
  }

  function goPrev() {
    setErrorMsg(null);
    setCurrentIndex((prev) => Math.max(0, prev - 1));
  }

  return (
    <div className="min-h-[calc(100vh-5rem)] flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-2xl space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
        
        {/* Header Section */}
        <div className="text-center space-y-3">
          <h1 className="text-3xl font-medium tracking-tight">Market Readiness Assessment</h1>
          <p className="text-muted-foreground text-sm sm:text-base">
            Score 8/10 or higher to unlock unrestricted trading.
          </p>
        </div>

        <div className="w-full">
          {passed ? (
            <div className="space-y-8 animate-in fade-in duration-700">
              <div className="text-center space-y-2">
                <h2 className="text-2xl font-medium">Assessment Passed</h2>
                <div className="text-lg text-muted-foreground">Final Score: {score}/10</div>
              </div>
              
              <div className="bg-muted/30 p-6 rounded-lg border border-border/50 text-sm leading-relaxed text-muted-foreground">
                <h3 className="font-medium text-foreground mb-3">Feedback Summary</h3>
                <p className="whitespace-pre-wrap">{feedback}</p>
              </div>

              <div className="pt-4 flex justify-center">
                <Button size="lg" onClick={() => window.location.href = "/"} className="px-12 w-full sm:w-auto">
                  Go to Dashboard
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-8">
              {/* Status Bar */}
              <div className="flex items-center justify-between pb-4 border-b border-border/50 text-sm font-medium text-muted-foreground">
                <span className="tracking-wide uppercase text-xs">Attempt {attempt}</span>
                {questions.length > 0 && !isLoading && (
                  <span className="tracking-wide uppercase text-xs">
                    {currentIndex + 1} / {questions.length}
                  </span>
                )}
              </div>

              {/* Feedback from previous failed attempt */}
              {!isLoading && feedback && questions.length > 0 && currentIndex === 0 && (
                <div className="bg-destructive/10 text-destructive text-sm p-4 rounded-md border border-destructive/20 leading-relaxed">
                  <span className="font-semibold">Previous Attempt ({score}/10): </span>
                  {feedback}
                </div>
              )}

              {/* Loading States */}
              {isLoading && questions.length === 0 && (
                <div className="py-20 text-center text-muted-foreground/70 animate-pulse">
                  Preparing your questions...
                </div>
              )}

              {isLoading && questions.length > 0 && (
                <div className="py-20 text-center text-muted-foreground/70 animate-pulse">
                  Grading your responses...
                </div>
              )}

              {/* Question Area */}
              {!isLoading && questions.length > 0 && currentQuestion && (
                <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-500">
                  <h2 className="text-xl sm:text-2xl font-medium leading-normal tracking-tight">
                    {currentQuestion.text}
                  </h2>
                  
                  {currentQuestion.image_data && (
                    <div className="mt-4 border rounded-md overflow-hidden bg-white/5 p-4 flex items-center justify-center">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img 
                        src={currentQuestion.image_data.startsWith('http') || currentQuestion.image_data.startsWith('data:') 
                          ? currentQuestion.image_data 
                          : `data:image/jpeg;base64,${currentQuestion.image_data}`} 
                        alt="Question Reference" 
                        className="rounded object-contain max-h-[350px]" 
                      />
                    </div>
                  )}

                  <div className="space-y-3">
                    <Textarea
                      value={userAnswers[currentIndex] || ""}
                      onChange={(e) => {
                        const newAns = [...userAnswers];
                        newAns[currentIndex] = e.target.value;
                        setUserAnswers(newAns);
                        if (errorMsg) setErrorMsg(null);
                      }}
                      placeholder="Type your answer here..."
                      className="w-full min-h-[140px] text-base resize-y transition-all"
                      disabled={isLoading}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          if (isLastQuestion) {
                            handleSubmit();
                          } else {
                            goNext();
                          }
                        }
                      }}
                    />
                    {errorMsg && (
                      <p className="text-sm text-destructive font-medium animate-in fade-in slide-in-from-top-1">
                        {errorMsg}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Navigation Actions */}
              {!isLoading && questions.length > 0 && (
                <div className="flex flex-col-reverse sm:flex-row items-center justify-between pt-8 gap-6 sm:gap-4">
                  <Button 
                    variant="link"
                    onClick={handleSkip} 
                    disabled={isLoading}
                    className="text-muted-foreground hover:text-foreground underline-offset-4 px-0 font-normal"
                  >
                    Skip assessment
                  </Button>
                  
                  <div className="flex gap-3 w-full sm:w-auto">
                    <Button 
                      variant="ghost" 
                      onClick={goPrev} 
                      disabled={currentIndex === 0 || isLoading}
                      className="w-full sm:w-auto h-11 px-6 font-medium"
                    >
                      Previous
                    </Button>
                    
                    {isLastQuestion ? (
                      <Button 
                        onClick={() => handleSubmit()} 
                        disabled={isLoading} 
                        className="w-full sm:w-auto h-11 px-8 font-medium"
                      >
                        Submit 
                      </Button>
                    ) : (
                      <Button 
                        onClick={goNext} 
                        disabled={isLoading}
                        className="w-full sm:w-auto h-11 px-8 font-medium"
                      >
                        Next
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
