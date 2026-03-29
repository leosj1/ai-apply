"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles,
  ArrowRight,
  ArrowLeft,
  Upload,
  Briefcase,
  MapPin,
  DollarSign,
  CheckCircle2,
  Building2,
  Target,
  FileText,
  X,
} from "lucide-react";

const steps = [
  { id: 1, title: "Your Profile", subtitle: "Tell us about yourself" },
  { id: 2, title: "Job Preferences", subtitle: "What are you looking for?" },
  { id: 3, title: "Upload Resume", subtitle: "Let AI analyze your experience" },
  { id: 4, title: "You're All Set!", subtitle: "Start your job search" },
];

const locationOptions = [
  "San Francisco, CA", "New York, NY", "Seattle, WA", "Austin, TX",
  "Remote (US)", "Remote (Global)", "London, UK", "Berlin, Germany",
];

const companySizeOptions = [
  "Startup (1-50)", "Small (51-200)", "Medium (201-1000)",
  "Large (1001-5000)", "Enterprise (5000+)",
];

export default function OnboardingPage() {
  const router = useRouter();
  const [isCheckingStatus, setIsCheckingStatus] = useState(true);
  const [currentStep, setCurrentStep] = useState(1);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [yearsExp, setYearsExp] = useState("");
  const [linkedIn, setLinkedIn] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [titleSuggestions, setTitleSuggestions] = useState<string[]>([]);
  const [targetRoles, setTargetRoles] = useState<string[]>([]);
  const [isLoadingTitles, setIsLoadingTitles] = useState(false);
  const [isLoadingRoles, setIsLoadingRoles] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [selectedSizes, setSelectedSizes] = useState<string[]>([]);
  const [salary, setSalary] = useState("");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [workAuthorization, setWorkAuthorization] = useState("");
  const [needsSponsorship, setNeedsSponsorship] = useState(false);
  const [linkedInConnected, setLinkedInConnected] = useState(false);
  const [linkedInLoading, setLinkedInLoading] = useState(false);
  const [linkedInName, setLinkedInName] = useState<string | null>(null);
  const [onboardingStats, setOnboardingStats] = useState({ jobsMatched: "—", atsScore: "—", aiTools: "—" });

  useEffect(() => {
    async function checkStatus() {
      try {
        const res = await fetch("/api/user/onboarding");
        if (res.ok) {
          const data = await res.json();
          if (data.onboardingComplete) {
            router.replace("/dashboard");
            return;
          }
        }
      } catch { /* proceed with onboarding */ }
      // Check LinkedIn connection status
      try {
        const liRes = await fetch("/api/user/linkedin");
        if (liRes.ok) {
          const liData = await liRes.json();
          if (liData.connected) {
            setLinkedInConnected(true);
            setLinkedInName(liData.linkedInName || null);
            // Auto-fill name if empty
            if (liData.linkedInName) {
              const parts = liData.linkedInName.split(" ");
              if (!firstName && parts[0]) setFirstName(parts[0]);
              if (!lastName && parts.length > 1) setLastName(parts.slice(1).join(" "));
            }
          }
        }
      } catch { /* ignore */ }
      setIsCheckingStatus(false);
    }
    checkStatus();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const fetchTitleSuggestions = useCallback((query: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) { setTitleSuggestions([]); return; }
    debounceRef.current = setTimeout(async () => {
      setIsLoadingTitles(true);
      try {
        const res = await fetch("/api/ai/suggestions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "job_titles", query }),
        });
        if (res.ok) {
          const data = await res.json();
          setTitleSuggestions(data.suggestions || []);
        }
      } catch { /* ignore */ }
      finally { setIsLoadingTitles(false); }
    }, 300);
  }, []);

  const fetchTargetRoles = useCallback(async (title: string) => {
    if (!title.trim()) { setTargetRoles([]); return; }
    setIsLoadingRoles(true);
    try {
      const res = await fetch("/api/ai/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "target_roles", query: title }),
      });
      if (res.ok) {
        const data = await res.json();
        setTargetRoles(data.suggestions || []);
      }
    } catch { /* ignore */ }
    finally { setIsLoadingRoles(false); }
  }, []);

  useEffect(() => {
    if (currentStep === 2 && jobTitle.trim() && targetRoles.length === 0) {
      fetchTargetRoles(jobTitle);
    }
  }, [currentStep, jobTitle, targetRoles.length, fetchTargetRoles]);

  useEffect(() => {
    if (currentStep === 4) {
      (async () => {
        try {
          const res = await fetch("/api/user/onboarding/stats");
          if (res.ok) {
            const data = await res.json();
            setOnboardingStats({
              jobsMatched: String(data.jobsMatched ?? "—"),
              atsScore: data.atsScore ?? "—",
              aiTools: String(data.aiTools ?? "—"),
            });
          }
        } catch { /* use defaults */ }
      })();
    }
  }, [currentStep]);

  const handleFileSelect = async (file: File) => {
    const validTypes = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain",
    ];
    if (!validTypes.includes(file.type) || file.size > 10 * 1024 * 1024) return;

    setResumeFile(file);
    setIsUploading(true);
    setUploadSuccess(false);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload/resume", {
        method: "POST",
        body: formData,
      });
      if (res.ok) {
        setUploadSuccess(true);
      }
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  };

  const toggleItem = (
    item: string,
    list: string[],
    setter: (v: string[]) => void
  ) => {
    setter(
      list.includes(item) ? list.filter((i) => i !== item) : [...list, item]
    );
  };

  const nextStep = async () => {
    if (currentStep < 4) {
      setCurrentStep(currentStep + 1);
    } else {
      try {
        await fetch("/api/user/onboarding", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ firstName, lastName, jobTitle, yearsExp, linkedIn, phone, location, workAuthorization, needsSponsorship, selectedRoles, selectedLocations, selectedSizes, salary }),
        });
      } catch { /* proceed anyway */ }
      window.location.href = "/dashboard";
    }
  };

  const prevStep = () => {
    if (currentStep > 1) setCurrentStep(currentStep - 1);
  };

  if (isCheckingStatus) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50/50">
        <div className="w-8 h-8 border-3 border-violet-300 border-t-violet-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50/50 flex flex-col">
      {/* Header */}
      <header className="h-14 sm:h-16 bg-white border-b flex items-center px-4 sm:px-6">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg gradient-bg flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <span className="text-lg font-bold">
            Apply<span className="gradient-text">AI</span> Pro
          </span>
        </div>
      </header>

      {/* Progress */}
      <div className="bg-white border-b px-4 sm:px-6 py-3 sm:py-4">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-3">
            {steps.map((step) => (
              <div key={step.id} className="flex items-center gap-2">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                    currentStep >= step.id
                      ? "gradient-bg text-white"
                      : "bg-gray-200 text-gray-500"
                  }`}
                >
                  {currentStep > step.id ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : (
                    step.id
                  )}
                </div>
                <span
                  className={`text-xs font-medium hidden sm:block ${
                    currentStep >= step.id
                      ? "text-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  {step.title}
                </span>
              </div>
            ))}
          </div>
          <div className="w-full bg-gray-200 rounded-full h-1.5">
            <div
              className="gradient-bg h-1.5 rounded-full transition-all duration-500"
              style={{ width: `${((currentStep - 1) / (steps.length - 1)) * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-2xl">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              {currentStep === 1 && (
                <div className="space-y-6">
                  <div className="text-center mb-8">
                    <h2 className="text-2xl font-bold">Tell us about yourself</h2>
                    <p className="text-muted-foreground mt-1">
                      This helps us personalize your experience.
                    </p>
                  </div>
                  <div className="bg-white rounded-xl border p-6 space-y-4">
                    {/* LinkedIn Connect */}
                    <div className={`rounded-xl border-2 p-4 transition-all ${linkedInConnected ? "border-green-200 bg-green-50/50" : "border-[#0A66C2]/20 bg-[#0A66C2]/5"}`}>
                      {linkedInConnected ? (
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                            <CheckCircle2 className="w-5 h-5 text-green-600" />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-green-800">LinkedIn Connected</p>
                            <p className="text-xs text-green-600">{linkedInName || "Profile linked successfully"}</p>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-[#0A66C2] flex items-center justify-center">
                              <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-[#0A66C2]">Connect LinkedIn</p>
                              <p className="text-xs text-muted-foreground">Auto-fill your profile &amp; apply to jobs faster</p>
                            </div>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="border-[#0A66C2] text-[#0A66C2] hover:bg-[#0A66C2] hover:text-white shrink-0"
                            disabled={linkedInLoading}
                            onClick={async () => {
                              setLinkedInLoading(true);
                              // Redirect to Clerk's LinkedIn OAuth flow
                              // After connecting, user returns here and we detect the connection
                              window.location.href = `/sign-in?redirect_url=${encodeURIComponent(window.location.pathname)}&strategy=oauth_linkedin_oidc`;
                            }}
                          >
                            {linkedInLoading ? (
                              <div className="w-4 h-4 border-2 border-[#0A66C2] border-t-transparent rounded-full animate-spin" />
                            ) : (
                              "Connect"
                            )}
                          </Button>
                        </div>
                      )}
                    </div>
                    {!linkedInConnected && (
                      <div className="flex items-center gap-3">
                        <div className="flex-1 h-px bg-gray-200" />
                        <span className="text-xs text-muted-foreground">or fill in manually</span>
                        <div className="flex-1 h-px bg-gray-200" />
                      </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium mb-1.5 block">First Name</label>
                        <Input placeholder="Sarah" className="h-11" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-1.5 block">Last Name</label>
                        <Input placeholder="Chen" className="h-11" value={lastName} onChange={(e) => setLastName(e.target.value)} />
                      </div>
                    </div>
                    <div className="relative">
                      <label className="text-sm font-medium mb-1.5 block">Current Job Title</label>
                      <Input
                        placeholder="e.g., Product Manager"
                        className="h-11"
                        value={jobTitle}
                        onChange={(e) => { setJobTitle(e.target.value); setShowSuggestions(true); fetchTitleSuggestions(e.target.value); }}
                        onFocus={() => setShowSuggestions(true)}
                        onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                      />
                      {showSuggestions && (titleSuggestions.length > 0 || isLoadingTitles) && (
                        <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border rounded-xl shadow-lg overflow-hidden">
                          {isLoadingTitles ? (
                            <div className="px-4 py-3 text-sm text-muted-foreground flex items-center gap-2">
                              <div className="w-3 h-3 border-2 border-violet-300 border-t-violet-600 rounded-full animate-spin" />
                              Finding titles...
                            </div>
                          ) : (
                            titleSuggestions.map((suggestion) => (
                              <button
                                key={suggestion}
                                className="w-full text-left px-4 py-2.5 text-sm hover:bg-violet-50 hover:text-violet-700 transition-colors"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => { setJobTitle(suggestion); setShowSuggestions(false); setSelectedRoles([]); setTargetRoles([]); }}
                              >
                                {suggestion}
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">Years of Experience</label>
                      <div className="flex gap-2">
                        {["0-1", "2-4", "5-7", "8-10", "10+"].map((yr) => (
                          <button
                            key={yr}
                            onClick={() => setYearsExp(yr)}
                            className={`flex-1 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all focus:ring-2 focus:ring-violet-500/20 ${
                              yearsExp === yr
                                ? "bg-violet-50 border-violet-300 text-violet-700"
                                : "hover:border-violet-300 hover:bg-violet-50"
                            }`}
                          >
                            {yr}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium mb-1.5 block">Phone Number</label>
                        <Input placeholder="5551234567" className="h-11" value={phone} onChange={(e) => setPhone(e.target.value)} />
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-1.5 block">Location</label>
                        <Input placeholder="e.g., California" className="h-11" value={location} onChange={(e) => setLocation(e.target.value)} />
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">LinkedIn URL (Optional)</label>
                      <Input placeholder="https://linkedin.com/in/yourprofile" className="h-11" value={linkedIn} onChange={(e) => setLinkedIn(e.target.value)} />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">Work Authorization</label>
                      <select
                        value={workAuthorization}
                        onChange={(e) => {
                          setWorkAuthorization(e.target.value);
                          setNeedsSponsorship(e.target.value === "need_sponsorship" || e.target.value === "student_visa");
                        }}
                        className="w-full h-11 rounded-lg border border-input bg-background px-3 py-2 text-sm"
                      >
                        <option value="">Select work authorization...</option>
                        <option value="authorized">Authorized to work in the US (no sponsorship needed)</option>
                        <option value="need_sponsorship">Need employer sponsorship (H-1B, etc.)</option>
                        <option value="student_visa">Student visa (OPT/CPT)</option>
                        <option value="pending_ead">Pending EAD</option>
                      </select>
                    </div>
                    {(workAuthorization === "need_sponsorship" || workAuthorization === "student_visa") && (
                      <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-50 border border-amber-200">
                        <div className="w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center shrink-0">
                          <CheckCircle2 className="w-3 h-3 text-white" />
                        </div>
                        <p className="text-xs text-amber-800">
                          Jobs from companies unlikely to sponsor will be scored lower in your matches.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {currentStep === 2 && (
                <div className="space-y-6">
                  <div className="text-center mb-8">
                    <h2 className="text-2xl font-bold">What are you looking for?</h2>
                    <p className="text-muted-foreground mt-1">
                      Select your preferences to help AI find the best matches.
                    </p>
                  </div>
                  <div className="bg-white rounded-xl border p-6 space-y-6">
                    <div>
                      <label className="text-sm font-medium mb-3 flex items-center gap-2">
                        <Briefcase className="w-4 h-4 text-violet-600" />
                        Target Roles
                      </label>
                      {jobTitle && (
                        <p className="text-xs text-muted-foreground mb-2">AI-suggested based on: <span className="font-medium text-violet-600">{jobTitle}</span></p>
                      )}
                      {isLoadingRoles ? (
                        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                          <div className="w-4 h-4 border-2 border-violet-300 border-t-violet-600 rounded-full animate-spin" />
                          Generating role suggestions...
                        </div>
                      ) : targetRoles.length === 0 && !jobTitle ? (
                        <p className="text-sm text-muted-foreground py-2">Enter your current job title in the previous step to get personalized role suggestions.</p>
                      ) : targetRoles.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-2">No suggestions yet. Loading...</p>
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        {targetRoles.map((role) => (
                          <button
                            key={role}
                            onClick={() => toggleItem(role, selectedRoles, setSelectedRoles)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                              selectedRoles.includes(role)
                                ? "bg-violet-50 border-violet-300 text-violet-700"
                                : "bg-white border-gray-200 text-muted-foreground hover:border-gray-300"
                            }`}
                          >
                            {role}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-3 flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-blue-600" />
                        Preferred Locations
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {locationOptions.map((loc) => (
                          <button
                            key={loc}
                            onClick={() => toggleItem(loc, selectedLocations, setSelectedLocations)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                              selectedLocations.includes(loc)
                                ? "bg-blue-50 border-blue-300 text-blue-700"
                                : "bg-white border-gray-200 text-muted-foreground hover:border-gray-300"
                            }`}
                          >
                            {loc}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-3 flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-emerald-600" />
                        Company Size
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {companySizeOptions.map((size) => (
                          <button
                            key={size}
                            onClick={() => toggleItem(size, selectedSizes, setSelectedSizes)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                              selectedSizes.includes(size)
                                ? "bg-emerald-50 border-emerald-300 text-emerald-700"
                                : "bg-white border-gray-200 text-muted-foreground hover:border-gray-300"
                            }`}
                          >
                            {size}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1.5 flex items-center gap-2">
                        <DollarSign className="w-4 h-4 text-amber-600" />
                        Minimum Salary
                      </label>
                      <Input
                        placeholder="e.g., $150,000"
                        value={salary}
                        onChange={(e) => setSalary(e.target.value)}
                        className="h-11"
                      />
                    </div>
                  </div>
                </div>
              )}

              {currentStep === 3 && (
                <div className="space-y-6">
                  <div className="text-center mb-8">
                    <h2 className="text-2xl font-bold">Upload your resume</h2>
                    <p className="text-muted-foreground mt-1">
                      Our AI will analyze your experience and optimize it for ATS systems.
                    </p>
                  </div>
                  <div className="bg-white rounded-xl border p-6">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.docx,.txt"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileSelect(file);
                      }}
                    />
                    {resumeFile ? (
                      <div className={`border-2 rounded-xl p-8 text-center ${uploadSuccess ? "border-green-300 bg-green-50/30" : "border-violet-300 bg-violet-50/30"}`}>
                        {isUploading ? (
                          <>
                            <div className="w-12 h-12 border-4 border-violet-200 border-t-violet-500 rounded-full animate-spin mx-auto mb-4" />
                            <p className="text-sm font-semibold mb-1">Uploading...</p>
                          </>
                        ) : uploadSuccess ? (
                          <>
                            <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-4" />
                            <p className="text-sm font-semibold mb-1">{resumeFile.name}</p>
                            <p className="text-xs text-green-600 mb-4">Uploaded successfully</p>
                          </>
                        ) : (
                          <>
                            <FileText className="w-12 h-12 text-violet-500 mx-auto mb-4" />
                            <p className="text-sm font-semibold mb-1">{resumeFile.name}</p>
                            <p className="text-xs text-muted-foreground mb-4">
                              {(resumeFile.size / 1024).toFixed(1)} KB
                            </p>
                          </>
                        )}
                        {!isUploading && (
                          <button
                            onClick={() => {
                              setResumeFile(null);
                              setUploadSuccess(false);
                              if (fileInputRef.current) fileInputRef.current.value = "";
                            }}
                            className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-700 font-medium"
                          >
                            <X className="w-3 h-3" /> Remove
                          </button>
                        )}
                      </div>
                    ) : (
                      <div
                        onClick={() => fileInputRef.current?.click()}
                        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={handleDrop}
                        className={`border-2 border-dashed rounded-xl p-6 sm:p-12 text-center transition-all cursor-pointer ${
                          isDragging
                            ? "border-violet-500 bg-violet-50/50"
                            : "border-gray-300 hover:border-violet-400 hover:bg-violet-50/30"
                        }`}
                      >
                        <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                        <p className="text-sm font-semibold mb-1">
                          Drop your resume here or click to browse
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Supports PDF, DOCX, TXT (max 10MB)
                        </p>
                      </div>
                    )}
                    <div className="mt-4 text-center">
                      <button
                        onClick={nextStep}
                        className="text-sm text-violet-600 hover:text-violet-700 font-medium"
                      >
                        Or skip and build one from scratch →
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {currentStep === 4 && (
                <div className="text-center space-y-6">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 200, damping: 15 }}
                    className="w-20 h-20 rounded-2xl gradient-bg flex items-center justify-center mx-auto shadow-lg shadow-purple-500/25"
                  >
                    <CheckCircle2 className="w-10 h-10 text-white" />
                  </motion.div>
                  <div>
                    <h2 className="text-2xl font-bold">You&apos;re all set!</h2>
                    <p className="text-muted-foreground mt-2 max-w-md mx-auto">
                      Your account is ready. Start exploring your personalized dashboard
                      and let AI supercharge your job search.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-lg mx-auto">
                    {[
                      { label: "Jobs Matched", value: onboardingStats.jobsMatched, icon: Target },
                      { label: "ATS Score", value: onboardingStats.atsScore, icon: CheckCircle2 },
                      { label: "AI Tools", value: onboardingStats.aiTools, icon: Sparkles },
                    ].map((stat) => (
                      <div key={stat.label} className="p-4 rounded-xl bg-white border text-center">
                        <stat.icon className="w-5 h-5 text-violet-600 mx-auto mb-2" />
                        <p className="text-lg font-bold">{stat.value}</p>
                        <p className="text-[10px] text-muted-foreground">{stat.label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          {/* Navigation */}
          <div className="flex items-center justify-between mt-8">
            <Button
              variant="ghost"
              onClick={prevStep}
              disabled={currentStep === 1}
              className="gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </Button>
            <Button variant="gradient" onClick={nextStep} className="gap-2">
              {currentStep === 4 ? "Go to Dashboard" : "Continue"}
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
