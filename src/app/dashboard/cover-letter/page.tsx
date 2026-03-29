"use client";

import { useState, useEffect } from "react";
import { useToast } from "@/components/ui/toast";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Mail,
  Sparkles,
  Download,
  Copy,
  RefreshCw,
  CheckCircle2,
  FileText,
  Wand2,
  ArrowRight,
} from "lucide-react";

interface SavedLetter {
  id: string;
  companyName: string;
  roleName: string;
  tone: string;
  content: string;
  createdAt: string;
}

const toneOptions = ["Professional", "Enthusiastic", "Confident", "Conversational", "Formal"];

export default function CoverLetterPage() {
  const [jobDescription, setJobDescription] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [roleName, setRoleName] = useState("");
  const [tone, setTone] = useState("Professional");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedLetter, setGeneratedLetter] = useState("");
  const [copied, setCopied] = useState(false);

  const [generateError, setGenerateError] = useState("");
  const { toast } = useToast();
  const [savedLetters, setSavedLetters] = useState<SavedLetter[]>([]);
  const [resumeText, setResumeText] = useState("");

  useEffect(() => {
    async function loadData() {
      try {
        const [lettersRes, resumesRes] = await Promise.all([
          fetch("/api/cover-letters"),
          fetch("/api/resumes"),
        ]);
        if (lettersRes.ok) {
          const data = await lettersRes.json();
          setSavedLetters(data.coverLetters || []);
        }
        if (resumesRes.ok) {
          const data = await resumesRes.json();
          const resumes = data.resumes || [];
          if (resumes.length > 0) {
            const latest = resumes.sort((a: { updatedAt: string }, b: { updatedAt: string }) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
            if (latest.id) {
              const detailRes = await fetch(`/api/resumes/${latest.id}`);
              if (detailRes.ok) {
                const detail = await detailRes.json();
                setResumeText(detail.resume?.content || "");
              }
            }
          }
        }
      } catch {
        // use empty
      }
    }
    loadData();
  }, []);

  const handleGenerate = async () => {
    setIsGenerating(true);
    setGenerateError("");
    try {
      const res = await fetch("/api/ai/cover-letter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobDescription,
          companyName: companyName || "your company",
          roleName: roleName || "Software Engineer",
          tone,
          resumeText: resumeText || "Experienced professional seeking new opportunities.",
        }),
      });
      if (!res.ok) throw new Error("Failed to generate cover letter");
      const data = await res.json();
      setGeneratedLetter(data.coverLetter);
      if (data.id) {
        setSavedLetters((prev) => [
          { id: data.id, companyName: companyName || "Company", roleName: roleName || "Role", tone, content: data.coverLetter, createdAt: new Date().toISOString() },
          ...prev,
        ]);
      }
      toast("Cover letter generated successfully!", "success");
    } catch (err) {
      setGenerateError("Something went wrong. Please try again.");
      toast("Failed to generate cover letter", "error");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(generatedLetter);
    setCopied(true);
    toast("Copied to clipboard!", "success");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Cover Letter Generator</h1>
        <p className="text-sm sm:text-base text-muted-foreground">
          Generate personalized, compelling cover letters in seconds.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Input Panel */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Wand2 className="w-5 h-5 text-violet-600" />
                Generate Cover Letter
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Company Name</label>
                <Input
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="e.g., Google"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Role Title</label>
                <Input
                  value={roleName}
                  onChange={(e) => setRoleName(e.target.value)}
                  placeholder="e.g., Senior Software Engineer"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Tone</label>
                <div className="flex flex-wrap gap-2">
                  {toneOptions.map((t) => (
                    <button
                      key={t}
                      onClick={() => setTone(t)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                        tone === t
                          ? "bg-violet-50 border-violet-300 text-violet-700"
                          : "bg-white border-gray-200 text-muted-foreground hover:border-gray-300"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Job Description</label>
                <textarea
                  value={jobDescription}
                  onChange={(e) => setJobDescription(e.target.value)}
                  placeholder="Paste the job description here for a more tailored cover letter..."
                  className="w-full h-36 rounded-xl border bg-gray-50/80 p-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-300 transition-all resize-none"
                />
              </div>
              <Button
                variant="gradient"
                className="w-full gap-2"
                onClick={handleGenerate}
                disabled={isGenerating}
              >
                {isGenerating ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Generate Cover Letter
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Saved Letters */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Recent Cover Letters</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {savedLetters.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">No cover letters yet.</p>
                ) : savedLetters.map((letter) => (
                  <div
                    key={letter.id}
                    onClick={() => setGeneratedLetter(letter.content)}
                    className="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 transition-colors cursor-pointer"
                  >
                    <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
                      <Mail className="w-4 h-4 text-emerald-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold truncate">{letter.companyName}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{letter.roleName}</p>
                    </div>
                    <span className="text-[10px] text-muted-foreground">{new Date(letter.createdAt).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Output Panel */}
        <div className="lg:col-span-3">
          <Card className="h-full">
            <CardHeader className="pb-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <CardTitle className="text-lg">Generated Cover Letter</CardTitle>
                {generatedLetter && (
                  <div className="flex gap-2 flex-wrap">
                    <Button variant="outline" size="sm" className="text-xs gap-1" onClick={handleCopy}>
                      {copied ? <CheckCircle2 className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                      {copied ? "Copied!" : "Copy"}
                    </Button>
                    <Button variant="outline" size="sm" className="text-xs gap-1">
                      <Download className="w-3 h-3" /> Export PDF
                    </Button>
                    <Button variant="outline" size="sm" className="text-xs gap-1" onClick={handleGenerate}>
                      <RefreshCw className="w-3 h-3" /> Regenerate
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {generatedLetter ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="bg-white border rounded-xl p-8 min-h-[500px] shadow-inner"
                >
                  <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-gray-700">
                    {generatedLetter}
                  </pre>
                </motion.div>
              ) : (
                <div className="flex flex-col items-center justify-center min-h-[500px] text-center">
                  {generateError && (
                    <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-600">
                      {generateError}
                    </div>
                  )}
                  <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
                    <Mail className="w-8 h-8 text-gray-400" />
                  </div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Your generated cover letter will appear here
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                    Fill in the details on the left and click &quot;Generate&quot; to create a
                    personalized, compelling cover letter.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
