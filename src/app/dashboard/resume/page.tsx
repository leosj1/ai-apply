"use client";

import { useState, useEffect } from "react";
import { useToast } from "@/components/ui/toast";
import { ResumeSkeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  FileText,
  Plus,
  Sparkles,
  Download,
  Eye,
  Trash2,
  Copy,
  MoreVertical,
  Upload,
  Wand2,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  X,
} from "lucide-react";

const templates = [
  { id: "modern", name: "Modern", color: "from-violet-500 to-purple-600", popular: true },
  { id: "minimal", name: "Minimal", color: "from-gray-600 to-gray-800", popular: false },
  { id: "creative", name: "Creative", color: "from-pink-500 to-rose-500", popular: false },
  { id: "executive", name: "Executive", color: "from-blue-600 to-indigo-600", popular: true },
  { id: "tech", name: "Tech Pro", color: "from-emerald-500 to-teal-600", popular: false },
  { id: "ats", name: "ATS Optimized", color: "from-amber-500 to-orange-500", popular: true },
];

interface SavedResume {
  id: string;
  name: string;
  template: string;
  atsScore: number | null;
  lastOptimized: string | null;
  createdAt: string;
  updatedAt: string;
  hasPdf?: boolean;
}

export default function ResumePage() {
  const [activeTab, setActiveTab] = useState<"resumes" | "builder">("resumes");
  const [jobDescription, setJobDescription] = useState("");
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [savedResumes, setSavedResumes] = useState<SavedResume[]>([]);
  const [isLoadingResumes, setIsLoadingResumes] = useState(true);

  useEffect(() => {
    async function loadResumes() {
      try {
        const res = await fetch("/api/resumes");
        if (res.ok) {
          const data = await res.json();
          setSavedResumes(data.resumes || []);
        }
      } catch {
        // use empty
      } finally {
        setIsLoadingResumes(false);
      }
    }
    loadResumes();
  }, []);
  const [optimizationResult, setOptimizationResult] = useState<null | {
    score: number;
    suggestions: string[];
    keywordsFound: string[];
    keywordsMissing: string[];
  }>(null);
  const [optimizeError, setOptimizeError] = useState("");
  const { toast } = useToast();
  const [selectedResumeId, setSelectedResumeId] = useState("");
  const [selectedResumeContent, setSelectedResumeContent] = useState("");
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [previewResume, setPreviewResume] = useState<{ name: string; content: string; pdfUrl?: string } | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  const handlePreview = async (resume: SavedResume) => {
    setIsLoadingPreview(true);
    setPreviewResume({ name: resume.name, content: "", pdfUrl: resume.hasPdf ? `/api/resumes/${resume.id}/pdf` : undefined });
    if (resume.hasPdf) {
      // PDF will render via iframe, no need to fetch text
      setIsLoadingPreview(false);
      return;
    }
    try {
      const res = await fetch(`/api/resumes/${resume.id}`);
      if (res.ok) {
        const data = await res.json();
        setPreviewResume({ name: resume.name, content: data.resume?.content || "No content available" });
      } else {
        setPreviewResume({ name: resume.name, content: "Failed to load content" });
      }
    } catch {
      setPreviewResume({ name: resume.name, content: "Failed to load content" });
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const handleDownload = async (resume: SavedResume) => {
    try {
      if (resume.hasPdf) {
        // Download original PDF
        const res = await fetch(`/api/resumes/${resume.id}/pdf`);
        if (!res.ok) throw new Error();
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${resume.name}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const res = await fetch(`/api/resumes/${resume.id}`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        const content = data.resume?.content || "";
        const blob = new Blob([content], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${resume.name}.txt`;
        a.click();
        URL.revokeObjectURL(url);
      }
      toast("Resume downloaded!", "success");
    } catch {
      toast("Failed to download resume", "error");
    }
  };

  const handleSelectResume = async (resumeId: string) => {
    setSelectedResumeId(resumeId);
    if (!resumeId) {
      setSelectedResumeContent("");
      return;
    }
    setIsLoadingContent(true);
    try {
      const res = await fetch(`/api/resumes/${resumeId}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedResumeContent(data.resume?.content || "");
      }
    } catch {
      toast("Failed to load resume content", "error");
    } finally {
      setIsLoadingContent(false);
    }
  };

  const handleCreateResume = async () => {
    try {
      const res = await fetch("/api/resumes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `Resume ${savedResumes.length + 1}`, template: "Modern", content: "" }),
      });
      if (!res.ok) throw new Error("Failed to create resume");
      const data = await res.json();
      setSavedResumes((prev) => [data.resume, ...prev]);
      toast("Resume created!", "success");
    } catch {
      toast("Failed to create resume", "error");
    }
  };

  const handleImportResume = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch("/api/upload/resume", { method: "POST", body: formData });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      setSavedResumes((prev) => [data.resume, ...prev]);
      toast("Resume imported successfully!", "success");
    } catch {
      toast("Failed to import resume", "error");
    }
    e.target.value = "";
  };

  const handleOptimize = async () => {
    setIsOptimizing(true);
    setOptimizeError("");
    try {
      const res = await fetch("/api/ai/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobDescription,
          resumeText: selectedResumeContent,
        }),
      });
      if (!res.ok) throw new Error("Failed to optimize resume");
      const data = await res.json();
      setOptimizationResult({
        score: data.atsScore,
        suggestions: data.suggestions,
        keywordsFound: data.keywordsFound || [],
        keywordsMissing: data.keywordsMissing || [],
      });
      toast(`ATS Score: ${data.atsScore}/100`, "success");
    } catch (err) {
      setOptimizeError("Something went wrong. Please try again.");
      toast("Failed to optimize resume", "error");
    } finally {
      setIsOptimizing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Resume Builder</h1>
          <p className="text-sm sm:text-base text-muted-foreground">
            Build ATS-optimized resumes tailored to each job description.
          </p>
        </div>
        <div className="flex gap-2 sm:gap-3 shrink-0">
          <input
            type="file"
            accept=".pdf,.docx,.txt"
            className="hidden"
            id="resume-upload"
            onChange={handleImportResume}
          />
          <Button variant="outline" className="gap-2" onClick={() => document.getElementById('resume-upload')?.click()}>
            <Upload className="w-4 h-4" />
            Import Resume
          </Button>
          <Button variant="gradient" className="gap-2" onClick={handleCreateResume}>
            <Plus className="w-4 h-4" />
            New Resume
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {(["resumes", "builder"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
              activeTab === tab
                ? "bg-white shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab === "resumes" ? "My Resumes" : "AI Builder"}
          </button>
        ))}
      </div>

      {activeTab === "resumes" ? (
        <div className="space-y-6">
          {/* Saved Resumes */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {isLoadingResumes ? (
              Array.from({ length: 3 }).map((_, i) => <ResumeSkeleton key={i} />)
            ) : (<>
            {savedResumes.map((resume) => (
              <motion.div
                key={resume.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <Card className="group hover:shadow-lg transition-all hover:-translate-y-0.5 cursor-pointer" onClick={() => handlePreview(resume)}>
                  <CardContent className="p-5">
                    {/* Preview area */}
                    <div className="aspect-[8.5/11] bg-gradient-to-b from-gray-50 to-gray-100 rounded-lg mb-4 relative overflow-hidden border">
                      <div className="p-4 space-y-2">
                        <div className="h-3 bg-gray-300 rounded w-1/3" />
                        <div className="h-2 bg-gray-200 rounded w-2/3" />
                        <div className="h-2 bg-gray-200 rounded w-1/2" />
                        <div className="mt-3 h-2 bg-gray-200 rounded w-full" />
                        <div className="h-2 bg-gray-200 rounded w-full" />
                        <div className="h-2 bg-gray-200 rounded w-3/4" />
                        <div className="mt-3 h-2 bg-gray-200 rounded w-full" />
                        <div className="h-2 bg-gray-200 rounded w-5/6" />
                      </div>
                      {/* Hover overlay */}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                        <Button size="sm" variant="secondary" className="text-xs h-8" onClick={(e) => { e.stopPropagation(); handlePreview(resume); }}>
                          <Eye className="w-3 h-3 mr-1" /> Preview
                        </Button>
                        <Button size="sm" variant="secondary" className="text-xs h-8" onClick={(e) => { e.stopPropagation(); handleDownload(resume); }}>
                          <Download className="w-3 h-3 mr-1" /> Download
                        </Button>
                      </div>
                    </div>

                    <div className="flex items-start justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">
                          {resume.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {resume.template} &middot; {new Date(resume.updatedAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 mt-3">
                      {resume.atsScore != null ? (
                        <div className="flex items-center gap-1.5">
                          <div
                            className={`w-2 h-2 rounded-full ${
                              resume.atsScore >= 90
                                ? "bg-green-500"
                                : resume.atsScore >= 70
                                ? "bg-amber-500"
                                : "bg-red-500"
                            }`}
                          />
                          <span className="text-xs font-medium">
                            ATS: {resume.atsScore}%
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not optimized yet</span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}

            {/* New Resume Card */}
            <Card className="border-dashed hover:border-violet-300 hover:bg-violet-50/30 transition-all cursor-pointer group" onClick={handleCreateResume}>
              <CardContent className="p-5 flex flex-col items-center justify-center h-full min-h-[300px]">
                <div className="w-12 h-12 rounded-xl bg-violet-100 flex items-center justify-center mb-3 group-hover:bg-violet-200 transition-colors">
                  <Plus className="w-6 h-6 text-violet-600" />
                </div>
                <p className="text-sm font-semibold text-muted-foreground group-hover:text-violet-600 transition-colors">
                  Create New Resume
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Start from scratch or use a template
                </p>
              </CardContent>
            </Card>
            </>)}
          </div>

          {/* Templates */}
          <div>
            <h2 className="text-lg font-semibold mb-4">Resume Templates</h2>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 sm:gap-3">
              {templates.map((template) => (
                <div
                  key={template.id}
                  className="relative group cursor-pointer"
                >
                  <div
                    className={`aspect-[8.5/11] rounded-xl bg-gradient-to-br ${template.color} p-3 transition-all hover:shadow-lg hover:-translate-y-1`}
                  >
                    <div className="space-y-1.5">
                      <div className="h-2 bg-white/30 rounded w-1/2" />
                      <div className="h-1.5 bg-white/20 rounded w-3/4" />
                      <div className="h-1.5 bg-white/20 rounded w-2/3" />
                      <div className="mt-2 h-1.5 bg-white/15 rounded w-full" />
                      <div className="h-1.5 bg-white/15 rounded w-full" />
                      <div className="h-1.5 bg-white/15 rounded w-4/5" />
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <p className="text-xs font-medium">{template.name}</p>
                    {template.popular && (
                      <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
                        Popular
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        /* AI Builder Tab */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Wand2 className="w-5 h-5 text-violet-600" />
                AI Resume Optimizer
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">
                  Select Resume
                </label>
                <select
                  value={selectedResumeId}
                  onChange={(e) => handleSelectResume(e.target.value)}
                  className="w-full h-10 rounded-xl border bg-gray-50/80 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-300 transition-all"
                >
                  <option value="">Choose a resume to optimize...</option>
                  {savedResumes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} {r.atsScore ? `(ATS: ${r.atsScore}%)` : ""}
                    </option>
                  ))}
                </select>
                {isLoadingContent && (
                  <p className="text-xs text-muted-foreground mt-1">Loading resume content...</p>
                )}
                {selectedResumeContent && !isLoadingContent && (
                  <p className="text-xs text-green-600 mt-1">✓ Resume loaded ({selectedResumeContent.length.toLocaleString()} characters)</p>
                )}
                {selectedResumeId && !selectedResumeContent && !isLoadingContent && (
                  <p className="text-xs text-amber-600 mt-1">This resume has no text content. Try importing a PDF/DOCX file.</p>
                )}
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">
                  Paste the Job Description
                </label>
                <textarea
                  value={jobDescription}
                  onChange={(e) => setJobDescription(e.target.value)}
                  placeholder="Paste the full job description here and our AI will optimize your resume to match..."
                  className="w-full h-48 rounded-xl border bg-gray-50/80 p-4 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-300 transition-all resize-none"
                />
              </div>
              <Button
                variant="gradient"
                className="w-full gap-2"
                onClick={handleOptimize}
                disabled={!jobDescription.trim() || !selectedResumeContent || isOptimizing}
              >
                {isOptimizing ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Analyzing & Optimizing...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Optimize My Resume
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Optimization Results</CardTitle>
            </CardHeader>
            <CardContent>
              {optimizationResult ? (
                <div className="space-y-4">
                  {/* Score */}
                  <div className="text-center p-6 rounded-xl bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200">
                    <p className="text-5xl font-bold text-green-600">
                      {optimizationResult.score}
                    </p>
                    <p className="text-sm text-green-700 font-medium mt-1">
                      ATS Compatibility Score
                    </p>
                    <div className="w-full bg-green-200 rounded-full h-2 mt-3">
                      <div
                        className="bg-green-500 h-2 rounded-full transition-all duration-1000"
                        style={{ width: `${optimizationResult.score}%` }}
                      />
                    </div>
                  </div>

                  {/* Keywords */}
                  {(optimizationResult.keywordsFound.length > 0 || optimizationResult.keywordsMissing.length > 0) && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 rounded-xl bg-green-50 border border-green-200">
                        <p className="text-xs font-semibold text-green-700 mb-2">Keywords Found</p>
                        <div className="flex flex-wrap gap-1">
                          {optimizationResult.keywordsFound.map((kw) => (
                            <Badge key={kw} className="bg-green-100 text-green-700 border-green-200 text-[10px]">{kw}</Badge>
                          ))}
                        </div>
                      </div>
                      <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
                        <p className="text-xs font-semibold text-amber-700 mb-2">Missing Keywords</p>
                        <div className="flex flex-wrap gap-1">
                          {optimizationResult.keywordsMissing.map((kw) => (
                            <Badge key={kw} className="bg-amber-100 text-amber-700 border-amber-200 text-[10px]">{kw}</Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Suggestions */}
                  <div className="space-y-2">
                    <p className="text-sm font-semibold">AI Suggestions</p>
                    {optimizationResult.suggestions.map((suggestion, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-2.5 p-3 rounded-lg bg-gray-50 text-sm"
                      >
                        <CheckCircle2 className="w-4 h-4 text-violet-500 mt-0.5 shrink-0" />
                        <span className="text-muted-foreground">
                          {suggestion}
                        </span>
                      </div>
                    ))}
                  </div>

                  <Button variant="gradient" className="w-full gap-2">
                    <Sparkles className="w-4 h-4" />
                    Apply All Suggestions
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-64 text-center">
                  {optimizeError && (
                    <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-600">
                      {optimizeError}
                    </div>
                  )}
                  <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
                    <FileText className="w-8 h-8 text-gray-400" />
                  </div>
                  <p className="text-sm font-medium text-muted-foreground">
                    Paste a job description to get AI-powered optimization
                    suggestions
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Our AI will analyze the job requirements and tailor your
                    resume
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Preview Modal */}
      {previewResume && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setPreviewResume(null)}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-2xl max-h-[85vh] sm:max-h-[80vh] flex flex-col sm:m-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-lg font-semibold">{previewResume.name}</h3>
              <button onClick={() => setPreviewResume(null)} className="p-1 rounded-lg hover:bg-gray-100 transition-colors">
                <X className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {isLoadingPreview ? (
                <div className="flex items-center justify-center h-32">
                  <div className="w-6 h-6 border-2 border-violet-300 border-t-violet-600 rounded-full animate-spin" />
                </div>
              ) : previewResume.pdfUrl ? (
                <iframe
                  src={previewResume.pdfUrl}
                  className="w-full h-[60vh] rounded-lg border"
                  title={`${previewResume.name} PDF`}
                />
              ) : (
                <pre className="whitespace-pre-wrap text-sm text-gray-700 font-sans leading-relaxed">
                  {previewResume.content}
                </pre>
              )}
            </div>
            <div className="flex justify-end gap-2 p-4 border-t">
              {!previewResume.pdfUrl && (
                <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(previewResume.content); toast("Copied to clipboard!", "success"); }}>
                  <Copy className="w-3.5 h-3.5 mr-1.5" /> Copy
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => setPreviewResume(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
