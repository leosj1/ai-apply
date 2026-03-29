"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Mic,
  MicOff,
  Play,
  RotateCcw,
  Sparkles,
  MessageSquare,
  ThumbsUp,
  Clock,
  Target,
  Brain,
  Lightbulb,
  ChevronRight,
  Loader2,
} from "lucide-react";

const interviewTypes = [
  { id: "behavioral", label: "Behavioral", icon: MessageSquare, color: "from-violet-500 to-purple-600" },
  { id: "technical", label: "Technical", icon: Brain, color: "from-blue-500 to-cyan-500" },
  { id: "system-design", label: "System Design", icon: Target, color: "from-emerald-500 to-green-500" },
  { id: "case-study", label: "Case Study", icon: Lightbulb, color: "from-amber-500 to-orange-500" },
];

interface PastSession {
  id: string;
  company: string;
  type: string;
  score: number | null;
  date: string;
  questions: number;
}

interface GeneratedQuestion {
  question: string;
  category: string;
  difficulty: string;
  timeLimit: string;
}

export default function InterviewPage() {
  const [selectedType, setSelectedType] = useState("behavioral");
  const [isInterviewing, setIsInterviewing] = useState(false);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [userAnswer, setUserAnswer] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<GeneratedQuestion[]>([]);
  const [isGeneratingQuestions, setIsGeneratingQuestions] = useState(false);
  const [pastSessions, setPastSessions] = useState<PastSession[]>([]);
  const [feedback, setFeedback] = useState<null | {
    overallScore: number;
    scores: { content: number; structure: number; delivery: number };
    strengths: string[];
    improvements: string[];
    suggestedAnswer: string;
  }>(null);

  useEffect(() => {
    async function loadSessions() {
      try {
        const res = await fetch("/api/ai/interview/sessions");
        if (res.ok) {
          const data = await res.json();
          setPastSessions(data.sessions || []);
        }
      } catch { /* use empty */ }
    }
    loadSessions();
  }, [isInterviewing]);

  const startInterview = async () => {
    setIsGeneratingQuestions(true);
    setSessionId(null);
    setCurrentQuestion(0);
    setShowFeedback(false);
    setUserAnswer("");
    setFeedback(null);

    try {
      const res = await fetch("/api/ai/interview/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interviewType: selectedType, company, role, jobDescription }),
      });
      if (res.ok) {
        const data = await res.json();
        setQuestions(data.questions || []);
        setIsInterviewing(true);
      }
    } catch (err) {
      console.error("Failed to generate questions:", err);
    }
    setIsGeneratingQuestions(false);
  };

  const submitAnswer = async () => {
    if (!questions[currentQuestion]) return;
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/ai/interview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: questions[currentQuestion].question,
          answer: userAnswer,
          interviewType: selectedType,
          company: company || undefined,
          role: role || undefined,
          sessionId: sessionId || undefined,
        }),
      });
      if (!res.ok) throw new Error("Failed to get feedback");
      const data = await res.json();
      setFeedback(data);
      if (data.sessionId) setSessionId(data.sessionId);
      setShowFeedback(true);
    } catch (err) {
      console.error("Interview feedback error:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">AI Interview Coach</h1>
        <p className="text-sm sm:text-base text-muted-foreground">
          Practice with AI-powered mock interviews and get instant feedback.
        </p>
      </div>

      {!isInterviewing ? (
        <>
          {/* Interview Type Selection */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {interviewTypes.map((type) => (
              <motion.div
                key={type.id}
                whileHover={{ y: -2 }}
                onClick={() => setSelectedType(type.id)}
              >
                <Card
                  className={`cursor-pointer transition-all ${
                    selectedType === type.id
                      ? "border-violet-300 shadow-lg shadow-violet-500/10 ring-1 ring-violet-200"
                      : "hover:shadow-md"
                  }`}
                >
                  <CardContent className="p-5 text-center">
                    <div
                      className={`w-12 h-12 rounded-xl bg-gradient-to-br ${type.color} flex items-center justify-center mx-auto mb-3`}
                    >
                      <type.icon className="w-6 h-6 text-white" />
                    </div>
                    <p className="text-sm font-semibold">{type.label}</p>
                    <p className="text-xs text-muted-foreground mt-1">Interview</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Start Session */}
            <div className="lg:col-span-2">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Start a Practice Session</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Target Company (Optional)</label>
                    <Input placeholder="e.g., Google, Stripe, Meta..." value={company} onChange={(e) => setCompany(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Target Role (Optional)</label>
                    <Input placeholder="e.g., Senior Software Engineer" value={role} onChange={(e) => setRole(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">Job Description (Optional)</label>
                    <textarea
                      placeholder="Paste the job description for role-specific questions..."
                      value={jobDescription}
                      onChange={(e) => setJobDescription(e.target.value)}
                      className="w-full h-28 rounded-xl border bg-gray-50/80 p-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-300 transition-all resize-none"
                    />
                  </div>
                  <Button variant="gradient" className="w-full gap-2" size="lg" onClick={startInterview} disabled={isGeneratingQuestions}>
                    {isGeneratingQuestions ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Generating Questions...</>
                    ) : (
                      <><Play className="w-4 h-4" /> Start {interviewTypes.find((t) => t.id === selectedType)?.label} Interview</>
                    )}
                  </Button>
                </CardContent>
              </Card>
            </div>

            {/* Past Sessions */}
            <div>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Past Sessions</CardTitle>
                </CardHeader>
                <CardContent>
                  {pastSessions.length === 0 ? (
                    <div className="text-center py-6 text-muted-foreground">
                      <Mic className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      <p className="text-xs">No interview sessions yet.</p>
                      <p className="text-[10px] mt-1">Start a practice session to see your history.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {pastSessions.map((session) => (
                        <div key={session.id} className="p-3 rounded-xl border hover:shadow-sm transition-all">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-sm font-semibold">{session.company || "Practice"}</p>
                            <Badge variant="outline" className="text-[10px]">{session.type}</Badge>
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                              <span>{session.questions} question{session.questions !== 1 ? "s" : ""}</span>
                              <span>{session.date}</span>
                            </div>
                            {session.score != null && (
                              <div className={`text-sm font-bold ${
                                session.score >= 90 ? "text-green-600" : session.score >= 80 ? "text-blue-600" : "text-amber-600"
                              }`}>
                                {session.score}%
                              </div>
                            )}
                          </div>
                          {session.score != null && (
                            <div className="w-full bg-gray-100 rounded-full h-1.5 mt-2">
                              <div
                                className={`h-1.5 rounded-full ${
                                  session.score >= 90 ? "bg-green-500" : session.score >= 80 ? "bg-blue-500" : "bg-amber-500"
                                }`}
                                style={{ width: `${session.score}%` }}
                              />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Tips */}
              <Card className="mt-6">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Lightbulb className="w-4 h-4 text-amber-500" />
                    Interview Tips
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-xs text-muted-foreground">
                    <p>• Use the STAR method for behavioral questions</p>
                    <p>• Think out loud during technical interviews</p>
                    <p>• Ask clarifying questions before diving in</p>
                    <p>• Practice with a timer to build time awareness</p>
                    <p>• Review your feedback after each session</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      ) : (
        /* Active Interview Session */
        <div className="max-w-4xl mx-auto space-y-6">
          <Card>
            <CardContent className="p-8">
              <div className="flex items-center justify-between mb-6">
                <Badge variant="outline" className="text-xs">
                  Question {currentQuestion + 1} of {questions.length}
                </Badge>
                {questions[currentQuestion] && (
                  <div className="flex items-center gap-3">
                    <Badge variant="secondary" className="text-[10px]">{questions[currentQuestion].category}</Badge>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      <span>{questions[currentQuestion].timeLimit}</span>
                    </div>
                  </div>
                )}
              </div>

              <h2 className="text-xl font-semibold mb-8">
                {questions[currentQuestion]?.question || "Loading..."}
              </h2>

              {!showFeedback ? (
                <div className="space-y-4">
                  <textarea
                    value={userAnswer}
                    onChange={(e) => setUserAnswer(e.target.value)}
                    placeholder="Type your answer here..."
                    className="w-full h-40 rounded-xl border bg-gray-50/80 p-4 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-300 transition-all resize-none"
                  />
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                    <Button
                      variant={isRecording ? "destructive" : "outline"}
                      className="gap-2"
                      onClick={() => setIsRecording(!isRecording)}
                    >
                      {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                      {isRecording ? "Stop Recording" : "Record Answer"}
                    </Button>
                    <div className="flex gap-2 sm:gap-3">
                      <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => { setIsInterviewing(false); setSessionId(null); }}>
                        End Session
                      </Button>
                      <Button variant="gradient" className="gap-2 flex-1 sm:flex-none" onClick={submitAnswer} disabled={!userAnswer.trim() || isSubmitting}>
                        {isSubmitting ? (
                          <><Loader2 className="w-4 h-4 animate-spin" /> Analyzing...</>
                        ) : (
                          <><Sparkles className="w-4 h-4" /> Get AI Feedback</>
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                  {feedback && (
                    <>
                      {/* Score */}
                      <div className="grid grid-cols-3 gap-4">
                        {[
                          { label: "Content", score: feedback.scores.content, color: "text-blue-600" },
                          { label: "Structure", score: feedback.scores.structure, color: "text-violet-600" },
                          { label: "Delivery", score: feedback.scores.delivery, color: "text-emerald-600" },
                        ].map((metric) => (
                          <div key={metric.label} className="text-center p-4 rounded-xl bg-gray-50 border">
                            <p className={`text-2xl font-bold ${metric.color}`}>{metric.score}%</p>
                            <p className="text-xs text-muted-foreground mt-1">{metric.label}</p>
                          </div>
                        ))}
                      </div>

                      {/* Feedback */}
                      <div className="p-4 rounded-xl bg-green-50 border border-green-200">
                        <div className="flex items-center gap-2 mb-2">
                          <ThumbsUp className="w-4 h-4 text-green-600" />
                          <p className="text-sm font-semibold text-green-700">Strengths</p>
                        </div>
                        <ul className="text-sm text-green-700 space-y-1">
                          {feedback.strengths.map((s, i) => (
                            <li key={i}>• {s}</li>
                          ))}
                        </ul>
                      </div>

                      <div className="p-4 rounded-xl bg-amber-50 border border-amber-200">
                        <div className="flex items-center gap-2 mb-2">
                          <Lightbulb className="w-4 h-4 text-amber-600" />
                          <p className="text-sm font-semibold text-amber-700">Areas to Improve</p>
                        </div>
                        <ul className="text-sm text-amber-700 space-y-1">
                          {feedback.improvements.map((s, i) => (
                            <li key={i}>• {s}</li>
                          ))}
                        </ul>
                      </div>

                      <div className="p-4 rounded-xl bg-violet-50 border border-violet-200">
                        <div className="flex items-center gap-2 mb-2">
                          <Sparkles className="w-4 h-4 text-violet-600" />
                          <p className="text-sm font-semibold text-violet-700">AI-Suggested Answer</p>
                        </div>
                        <p className="text-sm text-violet-700 leading-relaxed">
                          &quot;{feedback.suggestedAnswer}&quot;
                        </p>
                      </div>
                    </>
                  )}

                  <div className="flex gap-3">
                    <Button variant="outline" className="flex-1 gap-2" onClick={() => { setShowFeedback(false); setUserAnswer(""); setFeedback(null); }}>
                      <RotateCcw className="w-4 h-4" /> Try Again
                    </Button>
                    <Button
                      variant="gradient"
                      className="flex-1 gap-2"
                      onClick={() => {
                        if (currentQuestion < questions.length - 1) {
                          setCurrentQuestion(currentQuestion + 1);
                          setShowFeedback(false);
                          setUserAnswer("");
                          setFeedback(null);
                        } else {
                          setIsInterviewing(false);
                          setSessionId(null);
                        }
                      }}
                    >
                      {currentQuestion < questions.length - 1 ? "Next Question" : "Finish Session"}
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </motion.div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
