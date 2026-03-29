"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { useClerk } from "@clerk/nextjs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ResumePreview } from "@/components/resume-preview";
import {
  Zap,
  Play,
  Pause,
  MapPin,
  DollarSign,
  Briefcase,
  CheckCircle2,
  Clock,
  Filter,
  RefreshCw,
  ExternalLink,
  Loader2,
  Search,
  FileText,
  Send,
  X,
  Eye,
  SkipForward,
  Package,
  Pencil,
  Save,
  XCircle,
  Bell,
  Download,
  ArrowUpDown,
  Phone,
  Award,
  TrendingUp,
  BarChart3,
  ChevronDown,
  Info,
  Trash2,
  Link2 as LinkIcon,
  Plus,
  Shield,
  RotateCcw,
} from "lucide-react";

interface MatchBreakdown {
  skills: number;
  location: number;
  salary: number;
  experience: number;
}

interface JobMatch {
  id: string;
  company: string;
  role: string;
  location: string | null;
  salary: string | null;
  match: number;
  status: string;
  appliedAt: string | null;
  tags: string[];
  url: string | null;
  source: string | null;
  matchBreakdown: MatchBreakdown | null;
  hasPackage: boolean;
  tailoredResume: string | null;
  generatedCoverLetter: string | null;
  jobDescription: string | null;
  createdAt: string;
}

interface Preferences {
  targetRoles: string[];
  locations: string[];
  companySizes: string[];
  minSalary: string | null;
}

interface AppNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

interface ApplicationPackage {
  company: string;
  role: string;
  jobDescription: string | null;
  tailoredResume: string | null;
  coverLetter: string | null;
}

interface Analytics {
  daily: { day: string; applied: number; matched: number }[];
}

export default function AutoApplyPage() {
  const { openUserProfile } = useClerk();
  const [isRunning, setIsRunning] = useState(false);
  const [appliedToday, setAppliedToday] = useState(0);
  const [appliedThisWeek, setAppliedThisWeek] = useState(0);
  const [avgMatch, setAvgMatch] = useState(0);
  const [jobs, setJobs] = useState<JobMatch[]>([]);
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<{ percent: number; label: string } | null>(null);
  const [isToggling, setIsToggling] = useState(false);
  const [preparingJobId, setPreparingJobId] = useState<string | null>(null);
  const [prepareProgress, setPrepareProgress] = useState(0);
  const [applyingJobId, setApplyingJobId] = useState<string | null>(null);
  const [viewPackage, setViewPackage] = useState<ApplicationPackage | null>(null);
  const [viewPackageJobId, setViewPackageJobId] = useState<string | null>(null);
  const [packageTab, setPackageTab] = useState<"resume" | "cover" | "jd">("resume");
  const [isBatchPreparing, setIsBatchPreparing] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const [editedResume, setEditedResume] = useState("");
  const [editedCoverLetter, setEditedCoverLetter] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const batchCancelRef = useRef(false);
  // New state for enhanced features
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);
  const [scanDue, setScanDue] = useState(false);
  const [scanInterval, setScanInterval] = useState("daily");
  const [lastScannedAt, setLastScannedAt] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [searchText, setSearchText] = useState("");
  const [filterSource, setFilterSource] = useState<string>("all");
  const [filterMinMatch, setFilterMinMatch] = useState<number>(0);
  const [sortBy, setSortBy] = useState<string>("date");
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [isBulkApplying, setIsBulkApplying] = useState(false);
  const [expandedBreakdown, setExpandedBreakdown] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [totalInterviewing, setTotalInterviewing] = useState(0);
  const [totalOffers, setTotalOffers] = useState(0);
  const [autoScanActive, setAutoScanActive] = useState(false);
  const [isTogglingScan, setIsTogglingScan] = useState(false);
  const [scanCredits, setScanCredits] = useState(50);
  const [linkedInConnected, setLinkedInConnected] = useState(false);
  const [linkedInDismissed, setLinkedInDismissed] = useState(false);
  const [gmailConnected, setGmailConnected] = useState(true); // assume true until API says otherwise
  const [gmailDismissed, setGmailDismissed] = useState(false);
  const [linkedInPrompt, setLinkedInPrompt] = useState<string | null>(null); // holds the URL to open
  const [detailJob, setDetailJob] = useState<JobMatch | null>(null); // job detail slide-out panel
  const [detailTab, setDetailTab] = useState<"overview" | "compare" | "cover">("overview");
  const [showAddJob, setShowAddJob] = useState(false);
  const [addJobForm, setAddJobForm] = useState({ company: "", role: "", url: "", location: "", salary: "" });
  const [isAddingJob, setIsAddingJob] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [showCompare, setShowCompare] = useState(false);
  const [compareTab, setCompareTab] = useState<"overview" | "resumes">("overview");
  const toggleCompare = (id: string) => {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 3) return prev; // max 3
      return [...prev, id];
    });
  };

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/ai/auto-apply");
      if (!res.ok) return;
      const data = await res.json();
      setIsRunning(data.isActive);
      setAppliedToday(data.appliedToday);
      setAppliedThisWeek(data.appliedThisWeek);
      setAvgMatch(data.averageMatchScore);
      setJobs(data.jobs || []);
      setPreferences(data.preferences || null);
      setNotifications(data.notifications || []);
      setUnreadCount(data.unreadCount || 0);
      setScanDue(data.scanDue || false);
      setScanInterval(data.scanInterval || "daily");
      setLastScannedAt(data.lastScannedAt || null);
      setAnalytics(data.analytics || null);
      setTotalInterviewing(data.totalInterviewing || 0);
      setTotalOffers(data.totalOffers || 0);
      setAutoScanActive(data.autoScanActive || false);
      setScanCredits(data.scanCredits ?? 50);
      if (data.gmailConnected !== undefined) setGmailConnected(data.gmailConnected);
      // Restore scan-in-progress state from server (survives page refresh)
      if (data.scanInProgress && data.scanProgress) {
        setIsScanning(true);
        setScanProgress({ percent: data.scanProgress.percent, label: data.scanProgress.label });
      } else if (isScanning && !data.scanInProgress) {
        // Scan finished while we were polling
        setIsScanning(false);
        setScanProgress(null);
      }
      return data;
    } catch (err) {
      console.error("Failed to fetch auto-apply status:", err);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchStatus().finally(() => setIsLoading(false));
    // Check LinkedIn connection status
    fetch("/api/user/linkedin").then(r => r.ok ? r.json() : null).then(d => {
      if (d?.connected) setLinkedInConnected(true);
    }).catch(() => {});
    // Restore auto-apply progress from localStorage (survives page refresh)
    try {
      const saved = localStorage.getItem("autoApplyProgress");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.result) {
          // Completed — show the result
          setAutoApplyResult(parsed.result);
          setAutoApplyJobName(parsed.jobName || "");
        } else if (parsed.startedAt && !parsed.completedAt) {
          // Still in progress (another tab may be running it)
          setAutoApplyingJobId(parsed.jobId);
          setAutoApplyJobName(parsed.jobName || "");
          setAutoApplyStartedAt(parsed.startedAt);
        }
      }
    } catch { /* */ }
  }, [fetchStatus]);

  // Poll for scan progress while scanning (handles page refresh reconnection)
  useEffect(() => {
    if (!isScanning) return;
    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch("/api/ai/auto-apply");
        if (!res.ok) return;
        const data = await res.json();
        if (data.scanInProgress && data.scanProgress) {
          setScanProgress({ percent: data.scanProgress.percent, label: data.scanProgress.label });
        } else {
          // Scan finished
          setIsScanning(false);
          setScanProgress(null);
          // Refresh all data
          fetchStatus();
        }
      } catch { /* */ }
    }, 5000);
    return () => clearInterval(pollInterval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isScanning]);

  // Auto-scan: poll every 30s to check if scan is due, and trigger it
  const scanningRef = useRef(false);
  useEffect(() => {
    if (!autoScanActive) return;
    const poll = async () => {
      if (scanningRef.current) return;
      // Re-fetch status to get latest scanDue
      try {
        const res = await fetch("/api/ai/auto-apply");
        if (!res.ok) return;
        const data = await res.json();
        // Always sync credits and scan state
        setScanCredits(data.scanCredits ?? 50);
        setAutoScanActive(data.autoScanActive || false);

        if (data.scanDue && data.autoScanActive && (data.scanCredits ?? 50) > 0 && !scanningRef.current) {
          scanningRef.current = true;
          setIsScanning(true);
          try {
            const sr = await fetch("/api/ai/auto-apply", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "scan" }),
            });
            if (sr.ok) {
              await fetchStatus();
            } else {
              const err = await sr.json().catch(() => ({}));
              if (err.noCredits) {
                setScanCredits(0);
                setAutoScanActive(false);
              }
            }
          } catch { /* */ }
          setIsScanning(false);
          scanningRef.current = false;
        } else {
          // Still update UI with latest data
          setJobs(data.jobs || []);
          setNotifications(data.notifications || []);
          setUnreadCount(data.unreadCount || 0);
          setLastScannedAt(data.lastScannedAt || null);
          setScanDue(data.scanDue || false);
        }
      } catch { /* */ }
    };
    // Run immediately on toggle
    poll();
    const id = setInterval(poll, 30000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoScanActive]);

  const postAction = async (action: string, extra?: Record<string, unknown>) => {
    const res = await fetch("/api/ai/auto-apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    });
    return res;
  };

  const handleToggle = async () => {
    setIsToggling(true);
    try {
      const res = await postAction("toggle");
      if (res.ok) { const d = await res.json(); setIsRunning(d.isActive); }
    } catch { /* */ }
    setIsToggling(false);
  };

  const handleToggleScan = async () => {
    // Prevent enabling scan when out of credits
    if (!autoScanActive && scanCredits <= 0) return;
    setIsTogglingScan(true);
    try {
      const res = await postAction("toggleScan");
      if (res.ok) { const d = await res.json(); setAutoScanActive(d.autoScanActive); }
    } catch { /* */ }
    setIsTogglingScan(false);
  };

  const handleScan = async () => {
    setIsScanning(true);
    setScanProgress({ percent: 0, label: "Starting scan..." });
    try {
      const res = await fetch("/api/ai/auto-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "scan" }),
      });

      if (res.headers.get("content-type")?.includes("text/event-stream")) {
        // SSE streaming response
        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (line.startsWith("event: ")) {
                const eventType = line.slice(7);
                const nextLine = lines[lines.indexOf(line) + 1];
                if (nextLine?.startsWith("data: ")) {
                  try {
                    const data = JSON.parse(nextLine.slice(6));
                    if (eventType === "progress") {
                      setScanProgress({ percent: data.percent || 0, label: data.label || "" });
                    } else if (eventType === "done") {
                      setScanDue(false);
                      await fetchStatus();
                    } else if (eventType === "error") {
                      if (data.noCredits) {
                        setScanCredits(0);
                        setAutoScanActive(false);
                      }
                    }
                  } catch { /* ignore parse errors */ }
                }
              }
            }
          }
        }
      } else {
        // Non-streaming response (error or already-in-progress)
        const err = await res.json().catch(() => ({}));
        if (res.status === 409 && err.scanInProgress) {
          // Scan already running — just keep polling, don't reset
          setScanProgress(err.scanProgress || { percent: 0, label: "Scan in progress..." });
          return; // Don't clear isScanning — the poll effect will handle it
        } else if (res.ok) {
          setScanDue(false);
          await fetchStatus();
        } else {
          if (err.noCredits) {
            setScanCredits(0);
            setAutoScanActive(false);
          }
        }
      }
    } catch { /* */ }
    setIsScanning(false);
    setScanProgress(null);
  };

  const handlePrepare = async (jobId: string) => {
    setPreparingJobId(jobId);
    setPrepareProgress(0);
    const steps = [5, 12, 20, 30, 40, 50, 58, 65, 72, 78, 83, 87, 90, 93, 95];
    let stepIdx = 0;
    const interval = setInterval(() => { if (stepIdx < steps.length) { setPrepareProgress(steps[stepIdx]); stepIdx++; } }, 600);
    try {
      const res = await postAction("prepare", { jobId });
      clearInterval(interval);
      setPrepareProgress(100);
      if (res.ok) { await new Promise((r) => setTimeout(r, 400)); await fetchStatus(); }
    } catch { clearInterval(interval); }
    setPrepareProgress(0);
    setPreparingJobId(null);
  };

  const handleBatchPrepare = async () => {
    const BATCH_MIN_SCORE = 50;
    const matched = filteredJobs.filter((j) => j.status === "matched" && (!j.match || j.match >= BATCH_MIN_SCORE));
    if (!matched.length) return;
    setIsBatchPreparing(true);
    batchCancelRef.current = false;
    setBatchProgress({ current: 0, total: matched.length });
    for (let i = 0; i < matched.length; i++) {
      if (batchCancelRef.current) break;
      setBatchProgress({ current: i + 1, total: matched.length });
      setPreparingJobId(matched[i].id);
      setPrepareProgress(0);
      const steps = [10, 25, 45, 60, 75, 88, 95];
      let si = 0;
      const iv = setInterval(() => { if (si < steps.length) { setPrepareProgress(steps[si]); si++; } }, 500);
      try {
        const res = await postAction("prepare", { jobId: matched[i].id });
        clearInterval(iv); setPrepareProgress(100);
        if (res.ok) { await new Promise((r) => setTimeout(r, 300)); await fetchStatus(); }
      } catch { clearInterval(iv); }
      setPrepareProgress(0); setPreparingJobId(null);
    }
    setIsBatchPreparing(false);
    setBatchProgress({ current: 0, total: 0 });
  };

  const handleViewPackage = async (jobId: string) => {
    setViewPackageJobId(jobId);
    setIsEditing(false);
    try {
      const res = await postAction("getPackage", { jobId });
      if (res.ok) {
        const data = await res.json();
        setViewPackage(data);
        setEditedResume(data.tailoredResume || "");
        setEditedCoverLetter(data.coverLetter || "");
        setPackageTab("resume");
      }
    } catch { /* */ }
  };

  const handleSaveEdits = async () => {
    if (!viewPackageJobId) return;
    setIsSavingEdit(true);
    try {
      await postAction("updatePackage", { jobId: viewPackageJobId, tailoredResume: editedResume, coverLetter: editedCoverLetter });
      setViewPackage((p) => p ? { ...p, tailoredResume: editedResume, coverLetter: editedCoverLetter } : null);
      setIsEditing(false);
    } catch { /* */ }
    setIsSavingEdit(false);
  };

  const handleApply = async (jobId: string) => {
    setApplyingJobId(jobId);
    try {
      const res = await postAction("apply", { jobId });
      if (res.ok) { setViewPackage(null); setViewPackageJobId(null); await fetchStatus(); }
    } catch { /* */ }
    setApplyingJobId(null);
  };

  const [autoApplyingJobId, setAutoApplyingJobId] = useState<string | null>(null);
  const [autoApplyResult, setAutoApplyResult] = useState<{ success: boolean; verifiedSuccess?: boolean; message: string; platform: string; method?: string; fieldsCompleted?: number; iterationsUsed?: number; screenshot?: string; stepsCompleted?: string[]; screenshotSteps?: { step: string; screenshot: string }[]; emailUsed?: string; trackingTag?: string; confirmationDetected?: boolean; confirmationText?: string } | null>(null);
  const [autoApplyStartedAt, setAutoApplyStartedAt] = useState<number | null>(null);
  const [autoApplyJobName, setAutoApplyJobName] = useState<string>("");
  const [autoApplyElapsed, setAutoApplyElapsed] = useState(0);

  // Elapsed timer for auto-apply progress
  useEffect(() => {
    if (!autoApplyStartedAt) return;
    const timer = setInterval(() => {
      setAutoApplyElapsed(Math.floor((Date.now() - autoApplyStartedAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [autoApplyStartedAt]);

  // Proof viewer for previously applied jobs
  const [proofData, setProofData] = useState<{ hasProof: boolean; steps?: string[]; screenshots?: { step: string; screenshot: string }[]; notes?: string; platform?: string; email?: string; appliedAt?: string } | null>(null);
  const [isLoadingProof, setIsLoadingProof] = useState(false);
  const handleViewProof = async (jobId: string) => {
    setIsLoadingProof(true);
    setProofData(null);
    try {
      const res = await fetch(`/api/ai/auto-apply/proof?jobId=${jobId}`);
      if (res.ok) {
        const data = await res.json();
        setProofData(data);
      }
    } catch { /* */ }
    setIsLoadingProof(false);
  };
  const handleAutoApply = async (jobId: string) => {
    // Warn if Gmail not connected — verification codes may need manual entry
    if (!gmailConnected && !confirm("Gmail is not connected. Some job sites require email verification codes that we can only enter automatically if Gmail is connected.\n\nDo you want to continue anyway? (You may need to enter the code manually)")) {
      window.location.href = "/api/email/gmail/connect";
      return;
    }
    const job = jobs.find(j => j.id === jobId);
    const jobName = job ? `${job.role} @ ${job.company}` : jobId;
    setAutoApplyingJobId(jobId);
    setAutoApplyResult(null);
    setAutoApplyJobName(jobName);
    const now = Date.now();
    setAutoApplyStartedAt(now);
    setAutoApplyElapsed(0);
    // Persist to localStorage so progress survives refresh
    try { localStorage.setItem("autoApplyProgress", JSON.stringify({ jobId, jobName, startedAt: now })); } catch { /* */ }
    try {
      const res = await postAction("autoApply", { jobId });
      let result;
      if (res.ok) {
        result = await res.json();
        setAutoApplyResult(result);
        if (result.success) await fetchStatus();
      } else {
        const data = await res.json();
        result = { success: false, message: data.error || "Auto-apply failed", platform: "unknown" };
        setAutoApplyResult(result);
      }
      // Save result to localStorage
      try { localStorage.setItem("autoApplyProgress", JSON.stringify({ jobId, jobName, startedAt: now, completedAt: Date.now(), result })); } catch { /* */ }
    } catch {
      const result = { success: false, message: "Network error", platform: "unknown" };
      setAutoApplyResult(result);
      try { localStorage.setItem("autoApplyProgress", JSON.stringify({ jobId, jobName, startedAt: now, completedAt: Date.now(), result })); } catch { /* */ }
    }
    setAutoApplyingJobId(null);
    setAutoApplyStartedAt(null);
  };

  const handleBulkApply = async () => {
    setIsBulkApplying(true);
    try {
      const res = await postAction("bulkApply");
      if (res.ok) await fetchStatus();
    } catch { /* */ }
    setIsBulkApplying(false);
  };

  const handleSkip = async (jobId: string) => {
    try { await postAction("skip", { jobId }); await fetchStatus(); } catch { /* */ }
  };

  const handleUpdateStatus = async (jobId: string, status: string) => {
    try { await postAction("updateStatus", { jobId, status }); await fetchStatus(); } catch { /* */ }
  };

  const handleMarkNotificationsRead = async () => {
    try { await postAction("markNotificationsRead"); setUnreadCount(0); setNotifications((n) => n.map((x) => ({ ...x, read: true }))); } catch { /* */ }
  };

  const handleUpdateScanInterval = async (interval: string) => {
    try { await postAction("updateScanInterval", { interval }); setScanInterval(interval); } catch { /* */ }
  };

  const handleDeleteJob = async (jobId: string) => {
    try { await postAction("deleteJob", { jobId }); setJobs((prev) => prev.filter((j) => j.id !== jobId)); } catch { /* */ }
  };

  const [isClearingAll, setIsClearingAll] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const handleClearAllJobs = async () => {
    setIsClearingAll(true);
    try { await postAction("clearAllJobs"); setJobs([]); setShowClearConfirm(false); } catch { /* */ }
    setIsClearingAll(false);
  };

  const handleAddJob = async () => {
    if (!addJobForm.company.trim() || !addJobForm.role.trim()) return;
    setIsAddingJob(true);
    try {
      const res = await postAction("addJob", addJobForm);
      if (res.ok) {
        setAddJobForm({ company: "", role: "", url: "", location: "", salary: "" });
        setShowAddJob(false);
        await fetchStatus();
      }
    } catch { /* */ }
    setIsAddingJob(false);
  };

  const [isValidatingUrls, setIsValidatingUrls] = useState(false);
  const [validateResult, setValidateResult] = useState<{ checked: number; deleted: number; expired?: number } | null>(null);
  const handleValidateUrls = async () => {
    setIsValidatingUrls(true);
    setValidateResult(null);
    try {
      const res = await postAction("validateExistingUrls");
      if (res.ok) {
        const data = await res.json();
        setValidateResult({ checked: data.checked, deleted: data.deleted || 0, expired: data.expired || 0 });
        if ((data.expired || data.deleted) > 0) await fetchStatus();
      }
    } catch { /* */ }
    setIsValidatingUrls(false);
  };

  const handleDownloadPDF = (content: string, filename: string) => {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  // Filtering & sorting
  const sortFns: Record<string, (a: JobMatch, b: JobMatch) => number> = {
    date: (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    match: (a, b) => b.match - a.match,
    company: (a, b) => a.company.localeCompare(b.company),
    salary: (a, b) => {
      const parse = (s: string | null) => { if (!s) return 0; const m = s.match(/(\d+)/); return m ? parseInt(m[1]) : 0; };
      return parse(b.salary) - parse(a.salary);
    },
    status: (a, b) => {
      const order = ["offer", "interview", "phone_screen", "applied", "ready", "matched", "skipped", "rejected"];
      return order.indexOf(a.status) - order.indexOf(b.status);
    },
    source: (a, b) => (a.source || "").localeCompare(b.source || ""),
  };
  const filteredJobs = jobs
    .filter((j) => filterStatus === "all" || j.status === filterStatus)
    .filter((j) => filterSource === "all" || (j.source || "").toLowerCase() === filterSource.toLowerCase())
    .filter((j) => j.match >= filterMinMatch)
    .filter((j) => {
      if (!searchText.trim()) return true;
      const q = searchText.toLowerCase();
      return (j.company.toLowerCase().includes(q) || j.role.toLowerCase().includes(q) ||
        (j.location || "").toLowerCase().includes(q) || j.tags.some(t => t.toLowerCase().includes(q)));
    })
    .sort(sortFns[sortBy] || sortFns.date);

  // Unique sources for filter dropdown
  const availableSources = Array.from(new Set(jobs.map(j => j.source).filter(Boolean) as string[])).sort();

  const JOBS_PER_PAGE = 25;
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(filteredJobs.length / JOBS_PER_PAGE));
  // Reset page when filter/sort changes
  useEffect(() => { setCurrentPage(1); }, [filterStatus, sortBy, searchText, filterSource, filterMinMatch]);
  const paginatedJobs = filteredJobs.slice((currentPage - 1) * JOBS_PER_PAGE, currentPage * JOBS_PER_PAGE);

  const statusConfig: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
    matched: { label: "Matched", color: "bg-amber-100 text-amber-700 border-amber-200", icon: <Search className="w-2.5 h-2.5 mr-1" /> },
    ready: { label: "Ready", color: "bg-violet-100 text-violet-700 border-violet-200", icon: <Package className="w-2.5 h-2.5 mr-1" /> },
    applied: { label: "Applied", color: "bg-blue-100 text-blue-700 border-blue-200", icon: <Send className="w-2.5 h-2.5 mr-1" /> },
    phone_screen: { label: "Phone Screen", color: "bg-cyan-100 text-cyan-700 border-cyan-200", icon: <Phone className="w-2.5 h-2.5 mr-1" /> },
    interview: { label: "Interview", color: "bg-emerald-100 text-emerald-700 border-emerald-200", icon: <CheckCircle2 className="w-2.5 h-2.5 mr-1" /> },
    offer: { label: "Offer", color: "bg-green-100 text-green-700 border-green-200", icon: <Award className="w-2.5 h-2.5 mr-1" /> },
    rejected: { label: "Rejected", color: "bg-red-100 text-red-700 border-red-200", icon: <XCircle className="w-2.5 h-2.5 mr-1" /> },
    skipped: { label: "Skipped", color: "bg-gray-100 text-gray-500 border-gray-200", icon: <SkipForward className="w-2.5 h-2.5 mr-1" /> },
  };

  const sourceColors: Record<string, string> = {
    LinkedIn: "bg-blue-50 text-blue-700 border-blue-200",
    Indeed: "bg-purple-50 text-purple-700 border-purple-200",
    Glassdoor: "bg-green-50 text-green-700 border-green-200",
    Greenhouse: "bg-emerald-50 text-emerald-700 border-emerald-200",
    "Company Website": "bg-gray-50 text-gray-700 border-gray-200",
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-violet-600" />
      </div>
    );
  }

  const matchedCount = jobs.filter((j) => j.status === "matched").length;
  const readyCount = jobs.filter((j) => j.status === "ready").length;

  return (
    <div className="space-y-6">
      {/* Floating auto-apply progress banner */}
      {(autoApplyingJobId || autoApplyResult) && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`sticky top-0 z-40 p-3 rounded-xl border shadow-lg ${
            autoApplyingJobId ? "bg-gradient-to-r from-violet-50 to-blue-50 border-violet-200" :
            autoApplyResult?.success ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"
          }`}
        >
          <div className="flex items-center gap-3">
            {autoApplyingJobId ? (
              <>
                <div className="relative">
                  <Loader2 className="w-5 h-5 text-violet-600 animate-spin" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-violet-800 truncate">AI Agent applying: {autoApplyJobName}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex-1 h-1.5 bg-violet-100 rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-gradient-to-r from-violet-500 to-blue-500 rounded-full"
                        initial={{ width: "5%" }}
                        animate={{ width: `${Math.min(5 + autoApplyElapsed * 3, 95)}%` }}
                        transition={{ duration: 1, ease: "linear" }}
                      />
                    </div>
                    <span className="text-[10px] text-violet-600 font-mono shrink-0">
                      {Math.floor(autoApplyElapsed / 60)}:{(autoApplyElapsed % 60).toString().padStart(2, "0")}
                    </span>
                  </div>
                  <p className="text-[10px] text-violet-500 mt-0.5">Analyzing page, filling forms, handling verification...</p>
                </div>
              </>
            ) : autoApplyResult ? (
              <>
                {autoApplyResult.success ? (
                  <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
                ) : (
                  <XCircle className="w-5 h-5 text-red-600 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate">
                    {autoApplyResult.success ? "Application submitted!" : "Auto-apply issue"}{autoApplyJobName ? ` — ${autoApplyJobName}` : ""}
                  </p>
                  <p className="text-[10px] text-muted-foreground truncate">{autoApplyResult.message}</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {autoApplyResult.platform && <Badge variant="outline" className="text-[9px] h-4">{autoApplyResult.platform}</Badge>}
                    {autoApplyResult.confirmationDetected && <Badge className="text-[9px] h-4 bg-green-100 text-green-700 border-green-200">Confirmed</Badge>}
                    {autoApplyResult.stepsCompleted && <Badge variant="outline" className="text-[9px] h-4">{autoApplyResult.stepsCompleted.length} steps</Badge>}
                    {autoApplyResult.emailUsed && <span className="text-[9px] text-muted-foreground">as {autoApplyResult.emailUsed}</span>}
                  </div>
                </div>
                <button
                  onClick={() => { setAutoApplyResult(null); setAutoApplyJobName(""); try { localStorage.removeItem("autoApplyProgress"); } catch { /* */ } }}
                  className="p-1 rounded hover:bg-black/5 shrink-0"
                >
                  <X className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </>
            ) : null}
          </div>
        </motion.div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Smart Auto-Apply</h1>
          <p className="text-sm sm:text-base text-muted-foreground">AI finds jobs, tailors your resume, and prepares applications for you to review.</p>
        </div>
        <div className="flex gap-2 items-center shrink-0">
          {/* Notifications bell */}
          <div className="relative">
            <button onClick={() => { setShowNotifications(!showNotifications); if (!showNotifications && unreadCount > 0) handleMarkNotificationsRead(); }} className="relative p-2 rounded-lg hover:bg-gray-100 transition-colors">
              <Bell className="w-5 h-5 text-muted-foreground" />
              {unreadCount > 0 && <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 rounded-full text-[9px] text-white flex items-center justify-center font-bold">{unreadCount}</span>}
            </button>
            {showNotifications && (
              <div className="absolute right-0 top-11 w-80 bg-white rounded-xl shadow-2xl border z-50 max-h-80 overflow-y-auto">
                <div className="p-3 border-b font-semibold text-sm">Notifications</div>
                {notifications.length === 0 ? (
                  <div className="p-4 text-xs text-muted-foreground text-center">No notifications yet.</div>
                ) : notifications.map((n) => (
                  <div key={n.id} className={`p-3 border-b last:border-0 ${n.read ? "" : "bg-violet-50/50"}`}>
                    <p className="text-xs font-semibold">{n.title}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{n.message}</p>
                    <p className="text-[9px] text-muted-foreground mt-1">{n.createdAt}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
          <Button
            variant={isRunning ? "destructive" : "default"}
            className={`gap-2 ${!isRunning ? "bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white" : ""}`}
            onClick={handleToggle} disabled={isToggling}
          >
            {isToggling ? <Loader2 className="w-4 h-4 animate-spin" /> : isRunning ? <><Pause className="w-4 h-4" /> Pause Auto-Apply</> : <><Play className="w-4 h-4" /> Start Auto-Apply</>}
          </Button>
        </div>
      </div>

      {/* Auto Scan Settings Card */}
      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${autoScanActive ? "bg-emerald-100" : "bg-gray-100"}`}>
                <Search className={`w-5 h-5 ${autoScanActive ? "text-emerald-600" : "text-gray-400"}`} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">Auto Job Scanner</h3>
                  <Badge variant="outline" className={`text-[9px] px-1.5 py-0 h-4 ${autoScanActive ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-gray-50 text-gray-500"}`}>
                    {autoScanActive ? "Active" : "Off"}
                  </Badge>
                  <Badge variant="outline" className={`text-[9px] px-1.5 py-0 h-4 ${scanCredits > 10 ? "bg-blue-50 text-blue-700 border-blue-200" : scanCredits > 0 ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-red-50 text-red-700 border-red-200"}`}>
                    {scanCredits} credit{scanCredits !== 1 ? "s" : ""}
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5 hidden sm:block">
                  Searches LinkedIn, Glassdoor, Indeed, ZipRecruiter, Greenhouse, Lever, and company career pages for real job postings.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
              {/* Interval selector — only when scan is active */}
              {autoScanActive && (
                <div className="flex items-center gap-1 px-2 py-1 rounded-lg border bg-gray-50 text-xs overflow-x-auto">
                  <Clock className="w-3 h-3 text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground mr-0.5">Every:</span>
                  {[
                    { value: "1min", label: "1m" },
                    { value: "5min", label: "5m" },
                    { value: "10min", label: "10m" },
                    { value: "30min", label: "30m" },
                    { value: "hourly", label: "1h" },
                    { value: "daily", label: "24h" },
                    { value: "weekly", label: "7d" },
                  ].map((iv) => (
                    <button key={iv.value} onClick={() => handleUpdateScanInterval(iv.value)} className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${scanInterval === iv.value ? "bg-emerald-100 text-emerald-700" : "text-muted-foreground hover:bg-gray-100"}`}>
                      {iv.label}
                    </button>
                  ))}
                </div>
              )}
              {/* Manual scan button */}
              <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs" onClick={handleScan} disabled={isScanning || scanCredits <= 0}>
                {isScanning ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Scanning...</> : <><Search className="w-3.5 h-3.5" /> Scan Now</>}
              </Button>
              {/* Toggle scan on/off */}
              <button
                onClick={handleToggleScan}
                disabled={isTogglingScan}
                className={`relative w-11 h-6 rounded-full transition-colors ${autoScanActive ? "bg-emerald-500" : "bg-gray-300"} ${isTogglingScan ? "opacity-50" : ""}`}
              >
                <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${autoScanActive ? "translate-x-[22px]" : "translate-x-0.5"}`} />
              </button>
            </div>
          </div>
          {/* Scan progress bar */}
          {isScanning && scanProgress && (
            <div className="mt-3 pt-3 border-t">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-medium text-violet-700">{scanProgress.label}</span>
                <span className="text-[10px] text-muted-foreground font-mono">{scanProgress.percent}%</span>
              </div>
              <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-violet-500 to-purple-500 rounded-full transition-all duration-700 ease-out"
                  style={{ width: `${scanProgress.percent}%` }}
                />
              </div>
              <div className="flex items-center gap-1.5 mt-1.5">
                <Loader2 className="w-3 h-3 animate-spin text-violet-500" />
                <span className="text-[10px] text-muted-foreground">Searching LinkedIn, Indeed, Glassdoor, Greenhouse, Lever, ZipRecruiter...</span>
              </div>
            </div>
          )}
          {/* Last scanned info + scan due banner */}
          {!isScanning && (lastScannedAt || (scanDue && autoScanActive)) && (
            <div className="mt-3 pt-3 border-t flex items-center justify-between">
              {lastScannedAt && <span className="text-[10px] text-muted-foreground">Last scanned: {new Date(lastScannedAt).toLocaleString()}</span>}
              {scanDue && autoScanActive && !isScanning && (
                <div className="flex items-center gap-2 text-[11px] text-amber-600 font-medium">
                  <Clock className="w-3 h-3" /> Scheduled scan is due
                </div>
              )}
            </div>
          )}
          {/* No credits warning */}
          {scanCredits <= 0 && (
            <div className="mt-3 pt-3 border-t">
              <div className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-red-50 border border-red-200">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-red-100 flex items-center justify-center shrink-0">
                    <Zap className="w-3.5 h-3.5 text-red-600" />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-red-700">Out of scan credits</p>
                    <p className="text-[10px] text-red-600">Auto-scanning has been paused. Get more credits to continue finding jobs.</p>
                  </div>
                </div>
                <Button size="sm" className="h-7 text-[10px] px-3 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white shrink-0" onClick={async () => { await postAction("addCredits", { amount: 50 }); await fetchStatus(); }}>
                  Get 50 Credits
                </Button>
              </div>
            </div>
          )}
          {/* Low credits warning */}
          {scanCredits > 0 && scanCredits <= 5 && (
            <div className="mt-3 pt-3 border-t">
              <div className="flex items-center justify-between gap-3 p-2 rounded-lg bg-amber-50 border border-amber-200">
                <p className="text-[10px] text-amber-700 flex items-center gap-1.5">
                  <Zap className="w-3 h-3 shrink-0" />
                  Only {scanCredits} scan credit{scanCredits !== 1 ? "s" : ""} remaining.
                </p>
                <Button size="sm" variant="outline" className="h-6 text-[10px] px-2 border-amber-300 text-amber-700 hover:bg-amber-100" onClick={async () => { await postAction("addCredits", { amount: 25 }); await fetchStatus(); }}>
                  +25 Credits
                </Button>
              </div>
            </div>
          )}
          {/* Source disclaimer */}
          <div className="mt-3 pt-3 border-t">
            <p className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Info className="w-3 h-3 shrink-0" />
              Jobs are found by searching the web in real-time using AI. Links open actual job postings on LinkedIn, Glassdoor, Indeed, ZipRecruiter, Greenhouse, Lever, company career pages, and more. Verify details before applying.
            </p>
          </div>
          {/* LinkedIn connection prompt */}
          {!linkedInConnected && !linkedInDismissed && (
            <div className="mt-3 pt-3 border-t">
              <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-[#0A66C2]/5 border border-[#0A66C2]/20">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-[#0A66C2] flex items-center justify-center shrink-0">
                    <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-[#0A66C2]">Connect your LinkedIn account</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">View LinkedIn job postings seamlessly and apply with Easy Apply — all while logged in to your account.</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    className="h-7 text-[10px] px-3 bg-[#0A66C2] hover:bg-[#004182] text-white"
                    onClick={() => openUserProfile({ customPages: [], additionalOAuthScopes: {} })}
                  >
                    Connect
                  </Button>
                  <button onClick={() => setLinkedInDismissed(true)} className="text-muted-foreground hover:text-gray-600 p-1">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}
          {linkedInConnected && (
            <div className="mt-3 pt-3 border-t">
              <div className="flex items-center gap-2 p-2 rounded-lg bg-green-50/50 border border-green-200/50">
                <svg className="w-3.5 h-3.5 text-[#0A66C2] shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                <p className="text-[10px] text-green-700 font-medium">LinkedIn connected — click any LinkedIn job to view and apply directly in your browser.</p>
              </div>
            </div>
          )}
          {/* Gmail connection prompt — needed for verification code retrieval */}
          {!gmailConnected && !gmailDismissed && (
            <div className="mt-3 pt-3 border-t">
              <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-red-50 border border-red-200">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-red-500 flex items-center justify-center shrink-0">
                    <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z"/></svg>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-red-700">Connect Gmail for seamless applications</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Some job sites require email verification codes. Connect Gmail so we can automatically read and enter these codes for you — fully hands-free.</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    className="h-7 text-[10px] px-3 bg-red-500 hover:bg-red-600 text-white"
                    onClick={() => window.location.href = "/api/email/gmail/connect"}
                  >
                    Connect Gmail
                  </Button>
                  <button onClick={() => setGmailDismissed(true)} className="text-muted-foreground hover:text-gray-600 p-1">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}
          {gmailConnected && (
            <div className="mt-3 pt-3 border-t">
              <div className="flex items-center gap-2 p-2 rounded-lg bg-green-50/50 border border-green-200/50">
                <svg className="w-3.5 h-3.5 text-red-500 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z"/></svg>
                <p className="text-[10px] text-green-700 font-medium">Gmail connected — verification codes will be read and entered automatically during applications.</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stats row */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 sm:gap-3">
        <div className="rounded-xl border bg-white p-3 text-center">
          <p className="text-2xl font-bold text-amber-600">{matchedCount}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Found</p>
        </div>
        <div className="rounded-xl border bg-white p-3 text-center">
          <p className="text-2xl font-bold text-violet-600">{readyCount}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Ready</p>
        </div>
        <div className="rounded-xl border bg-white p-3 text-center">
          <p className="text-2xl font-bold text-blue-600">{appliedToday}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Applied Today</p>
        </div>
        <div className="rounded-xl border bg-white p-3 text-center">
          <p className="text-2xl font-bold text-cyan-600">{totalInterviewing}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Interviewing</p>
        </div>
        <div className="rounded-xl border bg-white p-3 text-center">
          <p className="text-2xl font-bold text-green-600">{totalOffers}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Offers</p>
        </div>
        <div className="rounded-xl border bg-white p-3 text-center">
          <p className="text-2xl font-bold text-emerald-600">{avgMatch > 0 ? `${avgMatch}%` : "—"}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Avg Match</p>
        </div>
      </div>

      {/* Filters row */}
      <div className="flex items-center gap-2 sm:gap-3 flex-wrap pb-1">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search jobs..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="pl-7 pr-7 py-1.5 rounded-lg border bg-white text-xs w-40 sm:w-52 focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-300"
          />
          {searchText && (
            <button onClick={() => setSearchText("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-gray-600">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        {/* Status filter */}
        <div className="flex items-center gap-1 px-2 sm:px-3 py-1.5 rounded-lg border bg-white text-xs overflow-x-auto">
          <Filter className="w-3 h-3 text-muted-foreground shrink-0" />
          {["all", "matched", "ready", "applied", "phone_screen", "interview", "offer", "rejected", "skipped", "expired"].map((s) => (
            <button key={s} onClick={() => setFilterStatus(s)} className={`px-2 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${filterStatus === s ? "bg-violet-100 text-violet-700" : s === "expired" ? "text-orange-500 hover:bg-orange-50" : "text-muted-foreground hover:bg-gray-100"}`}>
              {s === "all" ? "All" : s === "phone_screen" ? "Phone" : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
          {filterStatus === "expired" && (
            <button
              onClick={async () => {
                try {
                  const res = await postAction("resetExpired");
                  if (res.ok) { const d = await res.json(); alert(`Reset ${d.reset} expired jobs back to matched.`); await fetchStatus(); setFilterStatus("matched"); }
                } catch { /* */ }
              }}
              className="px-2 py-0.5 rounded text-[10px] font-medium whitespace-nowrap bg-orange-100 text-orange-700 hover:bg-orange-200 ml-1"
            >
              Reset All Expired → Matched
            </button>
          )}
        </div>
        {/* Source filter */}
        {availableSources.length > 1 && (
          <select
            value={filterSource}
            onChange={(e) => setFilterSource(e.target.value)}
            className="px-2 py-1.5 rounded-lg border bg-white text-xs text-muted-foreground focus:outline-none focus:ring-2 focus:ring-violet-200 cursor-pointer"
          >
            <option value="all">All Sources</option>
            {availableSources.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        )}
        {/* Min match filter */}
        <select
          value={filterMinMatch}
          onChange={(e) => setFilterMinMatch(Number(e.target.value))}
          className="px-2 py-1.5 rounded-lg border bg-white text-xs text-muted-foreground focus:outline-none focus:ring-2 focus:ring-violet-200 cursor-pointer"
        >
          <option value={0}>Any Match</option>
          <option value={60}>60%+</option>
          <option value={70}>70%+</option>
          <option value={80}>80%+</option>
          <option value={90}>90%+</option>
        </select>
        {/* Sort dropdown */}
        <div className="relative">
          <button onClick={() => setShowSortMenu(!showSortMenu)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg border bg-white text-xs text-muted-foreground hover:bg-gray-50 whitespace-nowrap">
            <ArrowUpDown className="w-3 h-3" /> Sort: {{ date: "Newest", match: "Best Match", company: "Company", salary: "Salary", status: "Status", source: "Source" }[sortBy] || "Newest"}
            <ChevronDown className="w-3 h-3" />
          </button>
          {showSortMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowSortMenu(false)} />
              <div className="absolute top-9 left-0 bg-white rounded-lg shadow-xl border z-50 py-1 min-w-[150px]">
                {[
                  { value: "date", label: "Newest First" },
                  { value: "match", label: "Best Match" },
                  { value: "company", label: "Company A-Z" },
                  { value: "salary", label: "Highest Salary" },
                  { value: "status", label: "Status" },
                  { value: "source", label: "Source" },
                ].map((opt) => (
                  <button key={opt.value} onClick={() => { setSortBy(opt.value); setShowSortMenu(false); }} className={`w-full text-left px-3 py-1.5 text-[11px] hover:bg-gray-50 ${sortBy === opt.value ? "text-violet-700 font-semibold bg-violet-50" : ""}`}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        {/* Active filter indicators */}
        {(searchText || filterSource !== "all" || filterMinMatch > 0) && (
          <button
            onClick={() => { setSearchText(""); setFilterSource("all"); setFilterMinMatch(0); setFilterStatus("all"); }}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium text-red-600 hover:bg-red-50 border border-red-200"
          >
            <X className="w-3 h-3" /> Clear Filters
          </button>
        )}
        {/* Preference pills */}
        {preferences?.targetRoles && preferences.targetRoles.length > 0 && (
          <div className="flex items-center gap-1 px-3 py-1.5 rounded-lg border bg-white text-xs">
            <Briefcase className="w-3 h-3" /> {preferences.targetRoles.slice(0, 2).join(", ")}
          </div>
        )}
        {preferences?.locations && preferences.locations.length > 0 && (
          <div className="flex items-center gap-1 px-3 py-1.5 rounded-lg border bg-white text-xs">
            <MapPin className="w-3 h-3" /> {preferences.locations.slice(0, 2).join(", ")}
          </div>
        )}
        {preferences?.minSalary && (
          <div className="flex items-center gap-1 px-3 py-1.5 rounded-lg border bg-white text-xs">
            <DollarSign className="w-3 h-3" /> ${preferences.minSalary}+
          </div>
        )}
      </div>

      {/* Job Matches */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <CardTitle className="text-lg">Job Matches</CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              {matchedCount > 0 && (
                isBatchPreparing ? (
                  <Button variant="outline" size="sm" className="text-xs gap-1 h-7 text-red-600 border-red-200 hover:bg-red-50" onClick={() => { batchCancelRef.current = true; }}>
                    <XCircle className="w-3 h-3" /> Cancel ({batchProgress.current}/{batchProgress.total})
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" className="text-xs gap-1 h-7 text-violet-600 border-violet-200 hover:bg-violet-50" onClick={handleBatchPrepare} disabled={!!preparingJobId}>
                    <Zap className="w-3 h-3" /> Prepare All ({matchedCount})
                  </Button>
                )
              )}
              {readyCount > 0 && (
                <Button variant="outline" size="sm" className="text-xs gap-1 h-7 text-green-600 border-green-200 hover:bg-green-50" onClick={handleBulkApply} disabled={isBulkApplying}>
                  {isBulkApplying ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Send className="w-3 h-3" /> Apply All ({readyCount})</>}
                </Button>
              )}
              {compareIds.length >= 2 && (
                <Button variant="outline" size="sm" className="text-xs gap-1 h-7 text-violet-600 border-violet-200 hover:bg-violet-50" onClick={() => setShowCompare(true)}>
                  <Eye className="w-3 h-3" /> Compare ({compareIds.length})
                </Button>
              )}
              {compareIds.length > 0 && (
                <Button variant="ghost" size="sm" className="text-xs gap-1 h-7 text-muted-foreground" onClick={() => setCompareIds([])}>
                  <X className="w-3 h-3" /> Clear
                </Button>
              )}
              <Button variant="outline" size="sm" className="text-xs gap-1 h-7 text-emerald-600 border-emerald-200 hover:bg-emerald-50" onClick={() => setShowAddJob(true)}>
                <Plus className="w-3 h-3" /> Add Job
              </Button>
              <Badge variant="secondary" className="text-xs">{filteredJobs.length} shown</Badge>
              {jobs.length > 0 && (
                <>
                  <Button variant="outline" size="sm" className="text-xs gap-1 h-7 text-blue-600 border-blue-200 hover:bg-blue-50" onClick={handleValidateUrls} disabled={isValidatingUrls}>
                    {isValidatingUrls ? <><Loader2 className="w-3 h-3 animate-spin" /> Checking URLs...</> : <><LinkIcon className="w-3 h-3" /> Validate URLs</>}
                  </Button>
                  {validateResult && (
                    <span className={`text-[10px] font-medium ${(validateResult.expired || validateResult.deleted) > 0 ? "text-orange-600" : "text-green-600"}`}>
                      {(validateResult.expired || validateResult.deleted) > 0 ? `${validateResult.expired || validateResult.deleted} marked expired` : `All ${validateResult.checked} URLs valid`}
                    </span>
                  )}
                  {showClearConfirm ? (
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-red-600 font-medium">Delete all?</span>
                      <Button variant="outline" size="sm" className="text-xs gap-1 h-6 px-2 text-red-600 border-red-200 hover:bg-red-50" onClick={handleClearAllJobs} disabled={isClearingAll}>
                        {isClearingAll ? <Loader2 className="w-3 h-3 animate-spin" /> : "Yes"}
                      </Button>
                      <Button variant="ghost" size="sm" className="text-xs h-6 px-2" onClick={() => setShowClearConfirm(false)}>No</Button>
                    </div>
                  ) : (
                    <Button variant="ghost" size="sm" className="text-xs gap-1 h-7 text-red-500 hover:text-red-700 hover:bg-red-50" onClick={() => setShowClearConfirm(true)}>
                      <Trash2 className="w-3 h-3" /> Clear All
                    </Button>
                  )}
                </>
              )}
              <Button variant="ghost" size="sm" className="text-xs gap-1 h-7" onClick={async () => { setIsRefreshing(true); await fetchStatus(); setIsRefreshing(false); }} disabled={isRefreshing}>
                <RefreshCw className={`w-3 h-3 ${isRefreshing ? "animate-spin" : ""}`} /> Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredJobs.length === 0 ? (
            <div className="text-center py-12">
              <Search className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm font-medium text-muted-foreground">{filterStatus !== "all" ? `No ${filterStatus} jobs` : "No job matches yet"}</p>
              {filterStatus === "all" && (
                <>
                  <p className="text-xs text-muted-foreground mt-1 mb-4">Click &quot;Find Jobs&quot; to scan for positions that match your profile</p>
                  <Button onClick={handleScan} disabled={isScanning} className="gap-2 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white">
                    {isScanning ? <><Loader2 className="w-4 h-4 animate-spin" /> Scanning...</> : <><Search className="w-4 h-4" /> Find Jobs Now</>}
                  </Button>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {paginatedJobs.map((job) => {
                const sc = statusConfig[job.status] || statusConfig.matched;
                const isExpanded = expandedBreakdown === job.id;
                return (
                  <motion.div key={`${job.id}-${sortBy}`} layout initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ layout: { duration: 0.2 }, opacity: { duration: 0.15 } }}>
                    <div onClick={() => setDetailJob(job)} className={`flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-3 sm:p-4 rounded-xl border hover:shadow-md transition-all group cursor-pointer ${compareIds.includes(job.id) ? "border-violet-400 bg-violet-50/30" : ""} ${job.status === "skipped" || job.status === "rejected" ? "opacity-50" : "hover:border-violet-200"}`}>
                      <div className="flex items-center gap-3 sm:contents">
                        <input
                          type="checkbox"
                          checked={compareIds.includes(job.id)}
                          onChange={(e) => { e.stopPropagation(); toggleCompare(job.id); }}
                          onClick={(e) => e.stopPropagation()}
                          className="w-3.5 h-3.5 rounded border-gray-300 text-violet-600 focus:ring-violet-500 shrink-0 cursor-pointer"
                          title={compareIds.length >= 3 && !compareIds.includes(job.id) ? "Max 3 jobs" : "Compare"}
                          disabled={compareIds.length >= 3 && !compareIds.includes(job.id)}
                        />
                        <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center text-sm font-bold text-gray-600 shrink-0">
                          {job.company[0]}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                            <p className="text-sm font-semibold">{job.company}</p>
                            {job.url && (
                              <a href={job.url} target="_blank" rel="noopener noreferrer" onClick={(e) => {
                                e.stopPropagation();
                                if (job.url?.includes("linkedin.com") && !linkedInConnected) {
                                  e.preventDefault();
                                  setLinkedInPrompt(job.url);
                                }
                              }}><ExternalLink className="w-3 h-3 text-muted-foreground hover:text-violet-600" /></a>
                            )}
                            {job.url?.includes("linkedin.com/jobs/view") && (
                              <button onClick={(e) => {
                                e.stopPropagation();
                                if (!linkedInConnected) { setLinkedInPrompt(job.url!); } else { window.open(job.url!, "_blank"); }
                              }} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-[#0A66C2]/10 text-[#0A66C2] text-[8px] font-semibold hover:bg-[#0A66C2]/20 transition-colors cursor-pointer">
                                <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>LinkedIn
                              </button>
                            )}
                            {job.source && <Badge variant="outline" className={`text-[8px] px-1 py-0 h-4 ${sourceColors[job.source] || ""}`}>{job.source}</Badge>}
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{job.role}</p>
                          <div className="flex items-center gap-3 mt-1">
                            {job.location && <span className="text-[10px] text-muted-foreground flex items-center gap-1"><MapPin className="w-2.5 h-2.5" /> {job.location}</span>}
                            {job.salary && <span className="text-[10px] text-muted-foreground flex items-center gap-1"><DollarSign className="w-2.5 h-2.5" /> {job.salary}</span>}
                          </div>
                        </div>
                        {/* Match score - visible inline on mobile */}
                        <div className="text-center shrink-0 w-12 sm:hidden">
                          <div className={`text-lg font-bold ${job.match >= 90 ? "text-green-600" : job.match >= 80 ? "text-blue-600" : "text-amber-600"}`}>{job.match}%</div>
                        </div>
                      </div>
                      <div className="hidden sm:flex items-center gap-1.5 shrink-0">
                        {job.tags.slice(0, 3).map((tag) => <Badge key={tag} variant="secondary" className="text-[9px] px-1.5 py-0 h-5">{tag}</Badge>)}
                      </div>
                      {/* Match score with breakdown toggle - desktop */}
                      <div className="text-center shrink-0 w-14 hidden sm:block">
                        <button onClick={() => setExpandedBreakdown(isExpanded ? null : job.id)} className="group/match">
                          <div className={`text-lg font-bold ${job.match >= 90 ? "text-green-600" : job.match >= 80 ? "text-blue-600" : "text-amber-600"}`}>{job.match}%</div>
                          <p className="text-[9px] text-muted-foreground flex items-center justify-center gap-0.5">match {job.matchBreakdown && <Info className="w-2 h-2" />}</p>
                        </button>
                      </div>
                      {/* Status with pipeline dropdown */}
                      <div className="shrink-0 sm:w-24 sm:text-center">
                        <div className="relative group/status">
                          <Badge className={`${sc.color} text-[10px] cursor-pointer`}>{sc.icon} {sc.label}</Badge>
                          {(job.status === "applied" || job.status === "phone_screen" || job.status === "interview") && (
                            <div className="hidden group-hover/status:block absolute top-6 right-0 bg-white rounded-lg shadow-xl border z-30 py-1 min-w-[120px]">
                              {["phone_screen", "interview", "offer", "rejected"].filter((s) => s !== job.status).map((s) => (
                                <button key={s} onClick={() => handleUpdateStatus(job.id, s)} className="w-full text-left px-3 py-1.5 text-[10px] hover:bg-gray-50 capitalize">
                                  {s.replace("_", " ")}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        {job.appliedAt && <p className="text-[9px] text-muted-foreground mt-1">{job.appliedAt}</p>}
                      </div>
                      {/* Actions */}
                      <div className="shrink-0 flex items-center gap-1.5 flex-wrap">
                        {job.status === "matched" && preparingJobId !== job.id && (
                          <>
                            {job.url?.includes("linkedin.com/jobs/view") && (
                              <Button size="sm" className="h-7 text-[10px] px-2 gap-1 bg-[#0A66C2] hover:bg-[#004182] text-white" onClick={(e) => {
                                e.stopPropagation();
                                if (!linkedInConnected) { setLinkedInPrompt(job.url!); } else { window.open(job.url!, "_blank"); }
                              }}>
                                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg> Easy Apply
                              </Button>
                            )}
                            <Button size="sm" className="h-7 text-[10px] px-2 gap-1 bg-violet-600 hover:bg-violet-700 text-white" onClick={(e) => { e.stopPropagation(); handlePrepare(job.id); }} disabled={!!preparingJobId}>
                              <FileText className="w-3 h-3" /> Prepare
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 text-[10px] px-2" onClick={(e) => { e.stopPropagation(); handleSkip(job.id); }}>
                              <SkipForward className="w-3 h-3" />
                            </Button>
                          </>
                        )}
                        {preparingJobId === job.id && (
                          <div className="w-40">
                            <div className="flex items-center gap-2 mb-1">
                              <Loader2 className="w-3 h-3 animate-spin text-violet-600" />
                              <span className="text-[10px] text-violet-600 font-medium">
                                {prepareProgress < 30 ? "Analyzing JD..." : prepareProgress < 60 ? "Tailoring resume..." : prepareProgress < 90 ? "Writing cover letter..." : "Finalizing..."}
                              </span>
                            </div>
                            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full bg-gradient-to-r from-violet-500 to-purple-500 rounded-full transition-all duration-500 ease-out" style={{ width: `${prepareProgress}%` }} />
                            </div>
                          </div>
                        )}
                        {job.status === "ready" && (
                          <>
                            <Button size="sm" variant="outline" className="h-7 text-[10px] px-2 gap-1" onClick={(e) => { e.stopPropagation(); handleViewPackage(job.id); }}>
                              <Eye className="w-3 h-3" /> Review
                            </Button>
                            <Button size="sm" className="h-7 text-[10px] px-2 gap-1 bg-green-600 hover:bg-green-700 text-white" onClick={(e) => { e.stopPropagation(); handleAutoApply(job.id); }} disabled={autoApplyingJobId === job.id}>
                              {autoApplyingJobId === job.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Zap className="w-3 h-3" /> Apply</>}
                            </Button>
                          </>
                        )}
                        {job.status === "expired" && preparingJobId !== job.id && (
                          <>
                            <Button size="sm" className="h-7 text-[10px] px-2 gap-1 bg-amber-600 hover:bg-amber-700 text-white" onClick={async (e) => { e.stopPropagation(); await postAction("updateStatus", { jobId: job.id, status: "matched" }); await fetchStatus(); }} >
                              <RotateCcw className="w-3 h-3" /> Restore
                            </Button>
                            <Button size="sm" className="h-7 text-[10px] px-2 gap-1 bg-violet-600 hover:bg-violet-700 text-white" onClick={async (e) => { e.stopPropagation(); await postAction("updateStatus", { jobId: job.id, status: "matched" }); await fetchStatus(); handlePrepare(job.id); }} disabled={!!preparingJobId}>
                              <FileText className="w-3 h-3" /> Prepare
                            </Button>
                          </>
                        )}
                        {/* Delete button — always available */}
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600 hover:bg-red-50 sm:opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => { e.stopPropagation(); handleDeleteJob(job.id); }}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                    {/* Match breakdown expandable */}
                    {isExpanded && job.matchBreakdown && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mx-2 sm:mx-4 mb-2 p-3 rounded-b-xl border border-t-0 bg-gray-50">
                        <p className="text-[10px] font-semibold text-muted-foreground mb-2">Match Score Breakdown</p>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          {[
                            { label: "Skills", value: job.matchBreakdown.skills, color: "bg-blue-500" },
                            { label: "Location", value: job.matchBreakdown.location, color: "bg-green-500" },
                            { label: "Salary", value: job.matchBreakdown.salary, color: "bg-amber-500" },
                            { label: "Experience", value: job.matchBreakdown.experience, color: "bg-violet-500" },
                          ].map((m) => (
                            <div key={m.label}>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[10px] text-muted-foreground">{m.label}</span>
                                <span className="text-[10px] font-bold">{m.value}%</span>
                              </div>
                              <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                <div className={`h-full ${m.color} rounded-full`} style={{ width: `${m.value}%` }} />
                              </div>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </motion.div>
                );
              })}
            </div>
          )}
          {/* Pagination */}
          {filteredJobs.length > JOBS_PER_PAGE && (
            <div className="flex items-center justify-between mt-4 pt-3 border-t">
              <p className="text-[11px] text-muted-foreground">
                Showing {(currentPage - 1) * JOBS_PER_PAGE + 1}–{Math.min(currentPage * JOBS_PER_PAGE, filteredJobs.length)} of {filteredJobs.length} jobs
              </p>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" className="h-7 w-7 p-0 text-xs" disabled={currentPage <= 1} onClick={() => setCurrentPage(1)}>
                  «
                </Button>
                <Button variant="outline" size="sm" className="h-7 w-7 p-0 text-xs" disabled={currentPage <= 1} onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}>
                  ‹
                </Button>
                <span className="px-2 text-[11px] font-medium text-muted-foreground">
                  {currentPage} / {totalPages}
                </span>
                <Button variant="outline" size="sm" className="h-7 w-7 p-0 text-xs" disabled={currentPage >= totalPages} onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}>
                  ›
                </Button>
                <Button variant="outline" size="sm" className="h-7 w-7 p-0 text-xs" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(totalPages)}>
                  »
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Analytics */}
      {analytics && analytics.daily.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2"><BarChart3 className="w-5 h-5 text-violet-600" /> Weekly Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-2 h-28">
              {analytics.daily.map((d, i) => {
                const maxVal = Math.max(...analytics.daily.map((x) => x.applied + x.matched), 1);
                const total = d.applied + d.matched;
                const pct = (total / maxVal) * 100;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full flex flex-col items-center" style={{ height: "80px" }}>
                      <div className="w-full flex flex-col justify-end h-full gap-0.5">
                        {d.applied > 0 && <motion.div initial={{ height: 0 }} animate={{ height: `${(d.applied / maxVal) * 100}%` }} transition={{ duration: 0.5, delay: i * 0.05 }} className="w-full rounded-t bg-green-400 min-h-[2px]" />}
                        {d.matched > 0 && <motion.div initial={{ height: 0 }} animate={{ height: `${(d.matched / maxVal) * 100}%` }} transition={{ duration: 0.5, delay: i * 0.05 }} className="w-full rounded-t bg-violet-400 min-h-[2px]" />}
                      </div>
                    </div>
                    <span className="text-[9px] text-muted-foreground">{d.day}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-4 mt-3 text-[10px] text-muted-foreground">
              <div className="flex items-center gap-1"><div className="w-2 h-2 rounded bg-green-400" /> Applied</div>
              <div className="flex items-center gap-1"><div className="w-2 h-2 rounded bg-violet-400" /> Matched</div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Application Package Modal */}
      {viewPackage && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => { setViewPackage(null); setViewPackageJobId(null); }}>
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-3xl max-h-[90vh] sm:max-h-[85vh] flex flex-col sm:mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 sm:p-5 border-b gap-3">
              <div>
                <h3 className="text-base sm:text-lg font-bold">Application Package</h3>
                <p className="text-xs sm:text-sm text-muted-foreground truncate">{viewPackage.role} at {viewPackage.company}</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {isEditing ? (
                  <>
                    <Button size="sm" variant="outline" className="gap-1" onClick={() => { setIsEditing(false); setEditedResume(viewPackage.tailoredResume || ""); setEditedCoverLetter(viewPackage.coverLetter || ""); }}>Cancel</Button>
                    <Button size="sm" className="gap-1 bg-violet-600 hover:bg-violet-700 text-white" onClick={handleSaveEdits} disabled={isSavingEdit}>
                      {isSavingEdit ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Save className="w-3 h-3" /> Save</>}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="outline" className="gap-1" onClick={() => setIsEditing(true)}><Pencil className="w-3 h-3" /> Edit</Button>
                    <Button size="sm" variant="outline" className="gap-1" onClick={() => {
                      const content = packageTab === "resume" ? viewPackage.tailoredResume : viewPackage.coverLetter;
                      if (content) handleDownloadPDF(content, `${viewPackage.company}_${packageTab === "resume" ? "resume" : "cover_letter"}.txt`);
                    }}><Download className="w-3 h-3" /> Download</Button>
                    <Button size="sm" className="gap-1 bg-green-600 hover:bg-green-700 text-white" onClick={() => { if (viewPackageJobId) { setViewPackage(null); setViewPackageJobId(null); handleAutoApply(viewPackageJobId); } }} disabled={autoApplyingJobId === viewPackageJobId}>
                      {autoApplyingJobId === viewPackageJobId ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Zap className="w-3 h-3" /> Apply Now</>}
                    </Button>
                  </>
                )}
                <button onClick={() => { setViewPackage(null); setViewPackageJobId(null); setIsEditing(false); }} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-5 h-5" /></button>
              </div>
            </div>
            <div className="flex border-b px-3 sm:px-5 overflow-x-auto">
              {([
                { key: "resume" as const, label: "Tailored Resume", icon: <FileText className="w-3.5 h-3.5" /> },
                { key: "cover" as const, label: "Cover Letter", icon: <Send className="w-3.5 h-3.5" /> },
                { key: "jd" as const, label: "Job Description", icon: <Briefcase className="w-3.5 h-3.5" /> },
              ]).map((tab) => (
                <button key={tab.key} onClick={() => setPackageTab(tab.key)} className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${packageTab === tab.key ? "border-violet-600 text-violet-600" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                  {tab.icon} {tab.label}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-3 sm:p-5">
              {isEditing && packageTab !== "jd" ? (
                <textarea className="w-full h-[400px] text-sm leading-relaxed font-mono bg-white rounded-xl p-5 border border-violet-200 focus:outline-none focus:ring-2 focus:ring-violet-300 resize-none" value={packageTab === "resume" ? editedResume : editedCoverLetter} onChange={(e) => packageTab === "resume" ? setEditedResume(e.target.value) : setEditedCoverLetter(e.target.value)} />
              ) : (
                <div className="whitespace-pre-wrap text-sm leading-relaxed font-mono bg-gray-50 rounded-xl p-5 border">
                  {packageTab === "resume" && (viewPackage.tailoredResume || "No tailored resume generated yet.")}
                  {packageTab === "cover" && (viewPackage.coverLetter || "No cover letter generated yet.")}
                  {packageTab === "jd" && (viewPackage.jobDescription || "No job description available.")}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* LinkedIn connection prompt modal */}
      {linkedInPrompt && !linkedInConnected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setLinkedInPrompt(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl border max-w-sm w-full p-6 space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-[#0A66C2] flex items-center justify-center shrink-0">
                <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
              </div>
              <div>
                <h3 className="text-base font-bold">Connect LinkedIn</h3>
                <p className="text-xs text-muted-foreground">For the best experience</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Connect your LinkedIn account to seamlessly view job postings and apply with <strong>Easy Apply</strong> — all while logged in.
            </p>
            <div className="bg-gray-50 rounded-xl p-3 space-y-2">
              <div className="flex items-center gap-2 text-xs text-gray-700">
                <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" /> View full job descriptions without login walls
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-700">
                <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" /> One-click Easy Apply on LinkedIn jobs
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-700">
                <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" /> Auto-fill your profile from LinkedIn
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Button
                className="flex-1 bg-[#0A66C2] hover:bg-[#004182] text-white gap-2"
                onClick={() => {
                  setLinkedInPrompt(null);
                  openUserProfile({ customPages: [], additionalOAuthScopes: {} });
                }}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                Connect LinkedIn
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  // Open the link anyway, then close the prompt
                  window.open(linkedInPrompt, "_blank");
                  setLinkedInPrompt(null);
                }}
              >
                Open Anyway
              </Button>
            </div>
            <button onClick={() => setLinkedInPrompt(null)} className="absolute top-3 right-3 text-muted-foreground hover:text-gray-600 p-1">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
      {/* Add Job Modal */}
      {showAddJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setShowAddJob(false)}>
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold flex items-center gap-2"><Plus className="w-5 h-5 text-emerald-600" /> Add Job Manually</h2>
              <button onClick={() => setShowAddJob(false)} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium mb-1 block">Company *</label>
                <input type="text" value={addJobForm.company} onChange={(e) => setAddJobForm((f) => ({ ...f, company: e.target.value }))} placeholder="e.g. Google" className="w-full h-9 rounded-lg border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Role *</label>
                <input type="text" value={addJobForm.role} onChange={(e) => setAddJobForm((f) => ({ ...f, role: e.target.value }))} placeholder="e.g. Senior Software Engineer" className="w-full h-9 rounded-lg border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block">Job URL</label>
                <input type="url" value={addJobForm.url} onChange={(e) => setAddJobForm((f) => ({ ...f, url: e.target.value }))} placeholder="https://..." className="w-full h-9 rounded-lg border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium mb-1 block">Location</label>
                  <input type="text" value={addJobForm.location} onChange={(e) => setAddJobForm((f) => ({ ...f, location: e.target.value }))} placeholder="Remote, NYC" className="w-full h-9 rounded-lg border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">Salary</label>
                  <input type="text" value={addJobForm.salary} onChange={(e) => setAddJobForm((f) => ({ ...f, salary: e.target.value }))} placeholder="$150k-$200k" className="w-full h-9 rounded-lg border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200" />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 pt-2">
              <Button className="flex-1 gap-2 bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 text-white" onClick={handleAddJob} disabled={isAddingJob || !addJobForm.company.trim() || !addJobForm.role.trim()}>
                {isAddingJob ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add Job
              </Button>
              <Button variant="outline" onClick={() => setShowAddJob(false)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
      {/* Job Comparison Modal */}
      {showCompare && compareIds.length >= 2 && (() => {
        const compareJobs = compareIds.map((id) => jobs.find((j) => j.id === id)).filter(Boolean) as JobMatch[];
        const rows: { label: string; key: string; render: (j: JobMatch) => React.ReactNode }[] = [
          { label: "Company", key: "company", render: (j) => <span className="font-semibold">{j.company}</span> },
          { label: "Role", key: "role", render: (j) => j.role },
          { label: "Location", key: "location", render: (j) => j.location || "—" },
          { label: "Salary", key: "salary", render: (j) => j.salary || "—" },
          { label: "Match Score", key: "match", render: (j) => <span className={`font-bold ${j.match >= 80 ? "text-green-600" : j.match >= 60 ? "text-blue-600" : "text-amber-600"}`}>{j.match}%</span> },
          { label: "Skills", key: "skills", render: (j) => <span className={`font-medium ${(j.matchBreakdown?.skills || 0) >= 80 ? "text-green-600" : "text-gray-700"}`}>{j.matchBreakdown?.skills ?? "—"}</span> },
          { label: "Experience", key: "exp", render: (j) => <span className={`font-medium ${(j.matchBreakdown?.experience || 0) >= 80 ? "text-green-600" : "text-gray-700"}`}>{j.matchBreakdown?.experience ?? "—"}</span> },
          { label: "Location Fit", key: "locfit", render: (j) => <span className={`font-medium ${(j.matchBreakdown?.location || 0) >= 80 ? "text-green-600" : "text-gray-700"}`}>{j.matchBreakdown?.location ?? "—"}</span> },
          { label: "Salary Fit", key: "salfit", render: (j) => <span className={`font-medium ${(j.matchBreakdown?.salary || 0) >= 80 ? "text-green-600" : "text-gray-700"}`}>{j.matchBreakdown?.salary ?? "—"}</span> },
          { label: "Status", key: "status", render: (j) => <Badge variant="secondary" className="text-[10px]">{j.status}</Badge> },
          { label: "Source", key: "source", render: (j) => j.source || "—" },
          { label: "Tags", key: "tags", render: (j) => j.tags.length > 0 ? j.tags.slice(0, 4).join(", ") : "—" },
        ];
        // Find best match score to highlight winner
        const bestMatch = Math.max(...compareJobs.map((j) => j.match));
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setShowCompare(false)}>
            <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
            <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold flex items-center gap-2"><BarChart3 className="w-5 h-5 text-violet-600" /> Compare Jobs</h2>
                <button onClick={() => setShowCompare(false)} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-5 h-5" /></button>
              </div>
              {/* Tabs */}
              <div className="flex gap-1 mb-4 border-b">
                {(["overview", "resumes"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setCompareTab(tab)}
                    className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${compareTab === tab ? "border-violet-600 text-violet-700" : "border-transparent text-muted-foreground hover:text-gray-700"}`}
                  >
                    {tab === "overview" ? "Overview" : "Tailored Resumes"}
                  </button>
                ))}
              </div>

              {compareTab === "overview" ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-3 text-muted-foreground font-medium w-28">Attribute</th>
                        {compareJobs.map((j) => (
                          <th key={j.id} className={`text-left py-2 px-3 font-semibold ${j.match === bestMatch ? "bg-green-50" : ""}`}>
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center text-[10px] font-bold text-gray-600 shrink-0">{j.company[0]}</div>
                              <div className="min-w-0">
                                <p className="truncate">{j.company}</p>
                                <p className="text-[10px] text-muted-foreground font-normal truncate">{j.role}</p>
                              </div>
                              {j.match === bestMatch && <Badge className="bg-green-100 text-green-700 text-[8px] h-4 shrink-0">Best</Badge>}
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.key} className="border-b last:border-0 hover:bg-gray-50">
                          <td className="py-2 px-3 text-muted-foreground font-medium">{row.label}</td>
                          {compareJobs.map((j) => (
                            <td key={j.id} className={`py-2 px-3 ${j.match === bestMatch ? "bg-green-50/50" : ""}`}>{row.render(j)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className={`grid gap-4 ${compareJobs.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
                  {compareJobs.map((j) => (
                    <div key={j.id} className="min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-6 h-6 rounded-md bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center text-[9px] font-bold text-gray-600 shrink-0">{j.company[0]}</div>
                        <div className="min-w-0">
                          <p className="text-[10px] font-semibold truncate">{j.company}</p>
                          <p className="text-[9px] text-muted-foreground truncate">{j.role}</p>
                        </div>
                        <Badge variant="secondary" className={`text-[8px] h-4 shrink-0 ${j.match >= 80 ? "bg-green-100 text-green-700" : ""}`}>{j.match}%</Badge>
                      </div>
                      {j.tailoredResume ? (
                        <ResumePreview
                          content={j.tailoredResume}
                          title={`${j.company} Resume`}
                          fileName={`${j.company}-${j.role}-resume.pdf`}
                        />
                      ) : (
                        <div className="text-[10px] text-muted-foreground italic p-4 bg-gray-50 rounded-lg border text-center">
                          No tailored resume yet. Prepare this job first.
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2 mt-4 pt-3 border-t">
                <Button variant="outline" size="sm" className="text-xs" onClick={() => { setShowCompare(false); setCompareIds([]); }}>Done</Button>
                <span className="text-[10px] text-muted-foreground">Select 2-3 jobs from the list to compare</span>
              </div>
            </div>
          </div>
        );
      })()}
      {/* Job Detail Slide-out Panel */}
      {detailJob && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setDetailJob(null)}>
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="relative w-full max-w-lg bg-white shadow-2xl overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="sticky top-0 bg-white border-b z-10 p-4 sm:p-6">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-100 to-purple-200 flex items-center justify-center text-lg font-bold text-violet-700 shrink-0">
                    {detailJob.company[0]}
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-base font-bold truncate">{detailJob.role}</h2>
                    <p className="text-sm text-muted-foreground truncate">{detailJob.company}</p>
                  </div>
                </div>
                <button onClick={() => setDetailJob(null)} className="p-1.5 rounded-lg hover:bg-gray-100 shrink-0">
                  <X className="w-5 h-5" />
                </button>
              </div>
              {/* Quick stats */}
              <div className="flex items-center gap-3 mt-3 flex-wrap">
                <div className={`text-lg font-bold ${detailJob.match >= 90 ? "text-green-600" : detailJob.match >= 80 ? "text-blue-600" : "text-amber-600"}`}>
                  {detailJob.match}% match
                </div>
                {detailJob.source && <Badge variant="outline" className="text-[10px]">{detailJob.source}</Badge>}
                <Badge variant="secondary" className="text-[10px]">{detailJob.status}</Badge>
              </div>
            </div>

            {/* Tab bar */}
            <div className="flex border-b px-4 sm:px-6">
              {[
                { key: "overview" as const, label: "Overview" },
                { key: "compare" as const, label: "Resume vs JD", show: detailJob.hasPackage || detailJob.jobDescription },
                { key: "cover" as const, label: "Cover Letter", show: !!detailJob.generatedCoverLetter },
              ].filter((t) => t.show !== false).map((t) => (
                <button
                  key={t.key}
                  onClick={() => setDetailTab(t.key)}
                  className={`px-3 py-2.5 text-xs font-medium border-b-2 transition-colors ${detailTab === t.key ? "border-violet-600 text-violet-700" : "border-transparent text-muted-foreground hover:text-gray-700"}`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Body */}
            <div className="p-4 sm:p-6 space-y-5">
              {/* ── Overview Tab ── */}
              {detailTab === "overview" && (
                <>
                  {/* Info grid */}
                  <div className="grid grid-cols-2 gap-3">
                    {detailJob.location && (
                      <div className="flex items-center gap-2 p-2.5 rounded-lg bg-gray-50">
                        <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
                        <span className="text-xs">{detailJob.location}</span>
                      </div>
                    )}
                    {detailJob.salary && (
                      <div className="flex items-center gap-2 p-2.5 rounded-lg bg-gray-50">
                        <DollarSign className="w-4 h-4 text-muted-foreground shrink-0" />
                        <span className="text-xs">{detailJob.salary}</span>
                      </div>
                    )}
                    {detailJob.appliedAt && (
                      <div className="flex items-center gap-2 p-2.5 rounded-lg bg-gray-50">
                        <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
                        <span className="text-xs">Applied {detailJob.appliedAt}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2 p-2.5 rounded-lg bg-gray-50">
                      <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
                      <span className="text-xs">Found {new Date(detailJob.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>

                  {/* Match breakdown */}
                  {detailJob.matchBreakdown && (
                    <div>
                      <h3 className="text-xs font-semibold mb-2 flex items-center gap-1.5">
                        <BarChart3 className="w-3.5 h-3.5" /> Match Breakdown
                      </h3>
                      <div className="space-y-2">
                        {(["skills", "location", "salary", "experience"] as const).map((key) => {
                          const val = detailJob.matchBreakdown![key];
                          return (
                            <div key={key} className="flex items-center gap-2">
                              <span className="text-[10px] text-muted-foreground w-16 capitalize">{key}</span>
                              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full ${val >= 80 ? "bg-green-500" : val >= 60 ? "bg-blue-500" : "bg-amber-500"}`} style={{ width: `${val}%` }} />
                              </div>
                              <span className="text-[10px] font-medium w-8 text-right">{val}%</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Tags */}
                  {detailJob.tags.length > 0 && (
                    <div>
                      <h3 className="text-xs font-semibold mb-2">Skills & Tags</h3>
                      <div className="flex flex-wrap gap-1.5">
                        {detailJob.tags.map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-[10px]">{tag}</Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Job Description */}
                  <div>
                    <h3 className="text-xs font-semibold mb-2 flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5" /> Job Description
                    </h3>
                    {detailJob.jobDescription ? (
                      <div className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap bg-gray-50 rounded-lg p-3 max-h-80 overflow-y-auto">
                        {detailJob.jobDescription}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">No description available. Click the link below to view the full posting.</p>
                    )}
                  </div>
                </>
              )}

              {/* ── Resume vs JD Comparison Tab ── */}
              {detailTab === "compare" && (
                <>
                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-violet-50 border border-violet-200">
                    <Info className="w-4 h-4 text-violet-600 shrink-0" />
                    <p className="text-[10px] text-violet-700">Compare your tailored resume against the job description to verify what will be submitted.</p>
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* Tailored Resume */}
                    <div>
                      <h3 className="text-xs font-semibold mb-2 flex items-center gap-1.5 text-violet-700">
                        <FileText className="w-3.5 h-3.5" /> Tailored Resume
                      </h3>
                      {detailJob.tailoredResume ? (
                        <ResumePreview
                          content={detailJob.tailoredResume}
                          title={`${detailJob.role} — Tailored Resume`}
                          fileName={`${detailJob.company}-${detailJob.role}-resume.pdf`}
                        />
                      ) : (
                        <div className="text-xs text-muted-foreground italic p-3 bg-gray-50 rounded-lg">
                          No tailored resume yet. Click &quot;Prepare&quot; to generate one.
                        </div>
                      )}
                    </div>
                    {/* Job Description */}
                    <div>
                      <h3 className="text-xs font-semibold mb-2 flex items-center gap-1.5 text-blue-700">
                        <Briefcase className="w-3.5 h-3.5" /> Job Description
                      </h3>
                      {detailJob.jobDescription ? (
                        <div className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap bg-blue-50/50 rounded-lg p-3 max-h-[60vh] overflow-y-auto border border-blue-100">
                          {detailJob.jobDescription}
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground italic p-3 bg-gray-50 rounded-lg">
                          No description available.
                        </div>
                      )}
                    </div>
                  </div>
                  {!detailJob.tailoredResume && detailJob.status === "matched" && (
                    <Button variant="outline" className="w-full gap-1.5" onClick={(e) => { e.stopPropagation(); handlePrepare(detailJob.id); setDetailJob(null); }}>
                      <FileText className="w-4 h-4" /> Generate Tailored Resume
                    </Button>
                  )}
                </>
              )}

              {/* ── Cover Letter Tab ── */}
              {detailTab === "cover" && (
                <>
                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-green-50 border border-green-200">
                    <Info className="w-4 h-4 text-green-600 shrink-0" />
                    <p className="text-[10px] text-green-700">This cover letter was generated specifically for this role and company.</p>
                  </div>
                  {detailJob.generatedCoverLetter ? (
                    <div className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap bg-green-50/30 rounded-lg p-4 border border-green-100">
                      {detailJob.generatedCoverLetter}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">No cover letter generated yet.</p>
                  )}
                </>
              )}

              {/* Auto-apply result with proof */}
              {autoApplyResult && (
                <div className={`p-3 rounded-lg border ${autoApplyResult.verifiedSuccess ? "bg-green-50 border-green-200" : autoApplyResult.success ? "bg-amber-50 border-amber-200" : "bg-red-50 border-red-200"}`}>
                  <div className="flex items-start gap-2">
                    {autoApplyResult.verifiedSuccess ? <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" /> : autoApplyResult.success ? <CheckCircle2 className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />}
                    <div className="flex-1">
                      <p className="text-xs font-medium">{autoApplyResult.verifiedSuccess ? "Application submitted!" : autoApplyResult.success ? "Submitted — needs verification" : "Auto-apply issue"}</p>
                      <p className="text-[10px] text-muted-foreground">{autoApplyResult.message}</p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {autoApplyResult.platform && <Badge variant="outline" className="text-[10px]">{autoApplyResult.platform}</Badge>}
                        {autoApplyResult.method && <Badge variant="outline" className="text-[10px] border-blue-200 text-blue-600">{autoApplyResult.method === "api" ? "Direct API" : autoApplyResult.method === "ai-agent" ? "AI Agent" : "Browser"}</Badge>}
                        {autoApplyResult.verifiedSuccess && <Badge className="text-[10px] bg-green-100 text-green-700 border-green-200">Confirmed</Badge>}
                        {autoApplyResult.success && !autoApplyResult.verifiedSuccess && <Badge variant="outline" className="text-[10px] border-amber-200 text-amber-600">⚠️ Needs manual check</Badge>}
                        {typeof autoApplyResult.fieldsCompleted === "number" && autoApplyResult.fieldsCompleted > 0 && <Badge variant="outline" className="text-[10px]">{autoApplyResult.fieldsCompleted} fields</Badge>}
                        {typeof autoApplyResult.iterationsUsed === "number" && <Badge variant="outline" className="text-[10px]">{autoApplyResult.iterationsUsed} iterations</Badge>}
                      </div>
                      {autoApplyResult.emailUsed && (
                        <p className="text-[9px] text-muted-foreground mt-1">Applied as: <span className="font-mono">{autoApplyResult.emailUsed}</span></p>
                      )}
                    </div>
                    <button onClick={() => setAutoApplyResult(null)} className="p-0.5"><X className="w-3 h-3" /></button>
                  </div>
                  {/* Steps completed — proof log */}
                  {autoApplyResult.stepsCompleted && autoApplyResult.stepsCompleted.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-dashed">
                      <p className="text-[10px] font-semibold text-muted-foreground mb-1">Steps Completed:</p>
                      <ol className="space-y-0.5">
                        {autoApplyResult.stepsCompleted.map((step, i) => (
                          <li key={i} className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <CheckCircle2 className="w-2.5 h-2.5 text-green-500 shrink-0" />
                            {step}
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                  {/* Screenshot evidence */}
                  {autoApplyResult.screenshotSteps && autoApplyResult.screenshotSteps.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-dashed">
                      <p className="text-[10px] font-semibold text-muted-foreground mb-1">Screenshot Evidence:</p>
                      <div className="space-y-2">
                        {autoApplyResult.screenshotSteps.map((ss, i) => (
                          <div key={i}>
                            <p className="text-[9px] text-muted-foreground mb-0.5">{ss.step}</p>
                            <img src={ss.screenshot} alt={ss.step} className="w-full rounded border max-h-40 object-contain bg-white" />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {autoApplyResult.screenshot && !autoApplyResult.screenshotSteps?.length && (
                    <div className="mt-2 pt-2 border-t border-dashed">
                      <p className="text-[10px] font-semibold text-muted-foreground mb-1">Screenshot:</p>
                      <img src={autoApplyResult.screenshot} alt="Application screenshot" className="w-full rounded border max-h-40 object-contain bg-white" />
                    </div>
                  )}
                </div>
              )}

              {/* Proof viewer for applied jobs */}
              {detailJob.status === "applied" && (
                <div className="space-y-2">
                  <Button
                    variant="outline"
                    className="w-full gap-1.5 text-blue-600 border-blue-200 hover:bg-blue-50"
                    onClick={() => handleViewProof(detailJob.id)}
                    disabled={isLoadingProof}
                  >
                    {isLoadingProof ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                    {isLoadingProof ? "Loading proof..." : "View Application Proof"}
                  </Button>
                  {proofData && (
                    <div className="rounded-lg border bg-blue-50/50 border-blue-200 overflow-hidden">
                      <div className="p-3 bg-blue-100/50 border-b border-blue-200">
                        <h4 className="text-xs font-semibold text-blue-800 flex items-center gap-1.5">
                          <Shield className="w-3.5 h-3.5" /> Application Proof
                        </h4>
                        {proofData.platform && <p className="text-[10px] text-blue-600 mt-0.5">Platform: {proofData.platform} · Email: {proofData.email}</p>}
                      </div>
                      {proofData.hasProof ? (
                        <div className="p-3 space-y-3">
                          {proofData.steps && proofData.steps.length > 0 && (
                            <div>
                              <p className="text-[10px] font-semibold text-muted-foreground mb-1">Steps Completed:</p>
                              <ol className="space-y-0.5">
                                {proofData.steps.map((step: string, i: number) => (
                                  <li key={i} className="text-[10px] text-muted-foreground flex items-center gap-1">
                                    <CheckCircle2 className="w-2.5 h-2.5 text-green-500 shrink-0" />
                                    {step}
                                  </li>
                                ))}
                              </ol>
                            </div>
                          )}
                          {proofData.screenshots && proofData.screenshots.length > 0 && (
                            <div>
                              <p className="text-[10px] font-semibold text-muted-foreground mb-1">📸 Screenshot Evidence ({proofData.screenshots.length} screenshots):</p>
                              <div className="space-y-2 max-h-[50vh] overflow-y-auto">
                                {proofData.screenshots.map((ss: { step: string; screenshot: string }, i: number) => (
                                  <div key={i} className="rounded border bg-white overflow-hidden">
                                    <p className="text-[9px] font-medium text-blue-700 px-2 py-1 bg-blue-50 border-b">{ss.step}</p>
                                    <img src={ss.screenshot} alt={ss.step} className="w-full object-contain" />
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="p-3">
                          <p className="text-[10px] text-muted-foreground">No screenshot proof available for this application.</p>
                          {proofData.notes && (
                            <div className="mt-2 p-2 bg-gray-50 rounded text-[10px] text-gray-600 whitespace-pre-wrap font-mono">
                              {proofData.notes}
                            </div>
                          )}
                        </div>
                      )}
                      <div className="p-2 border-t border-blue-200 flex justify-end">
                        <button onClick={() => setProofData(null)} className="text-[10px] text-blue-600 hover:text-blue-800">Close proof viewer</button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Actions — always visible */}
              <div className="flex items-center gap-2 pt-2 border-t flex-wrap">
                {detailJob.url && (
                  <Button asChild className="flex-1 gap-2 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white">
                    <a href={detailJob.url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="w-4 h-4" /> View Posting
                    </a>
                  </Button>
                )}
                {detailJob.status === "matched" && (
                  <Button variant="outline" className="gap-1.5" onClick={(e) => { e.stopPropagation(); handlePrepare(detailJob.id); setDetailJob(null); }}>
                    <FileText className="w-4 h-4" /> Prepare
                  </Button>
                )}
                {detailJob.status === "ready" && detailJob.url && (() => {
                  const url = detailJob.url!.toLowerCase();
                  const platform = url.includes("greenhouse.io") ? "Greenhouse"
                    : url.includes("lever.co") ? "Lever"
                    : url.includes("linkedin.com") ? "LinkedIn"
                    : url.includes("workable.com") ? "Workable"
                    : url.includes("ashby") ? "Ashby"
                    : url.includes("smartrecruiters") ? "SmartRecruiters"
                    : url.includes("icims") ? "iCIMS"
                    : url.includes("taleo") ? "Taleo"
                    : null;
                  const isLinkedIn = url.includes("linkedin.com");
                  return (
                    <>
                      {platform && (
                        <div className="w-full flex items-center gap-1.5 mb-1">
                          <Badge variant="outline" className="text-[10px]">{platform}</Badge>
                          <span className="text-[10px] text-muted-foreground">detected</span>
                        </div>
                      )}
                      {!platform && (
                        <div className="w-full flex items-center gap-1.5 mb-1">
                          <Badge variant="outline" className="text-[10px] border-amber-200 text-amber-600">Generic</Badge>
                          <span className="text-[10px] text-muted-foreground">will attempt universal form fill</span>
                        </div>
                      )}
                      {isLinkedIn && (
                        <div className="w-full flex items-center gap-2 p-2 rounded-lg bg-amber-50 border border-amber-200 mb-1">
                          <Info className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                          <p className="text-[10px] text-amber-700">LinkedIn Easy Apply requires authentication. Set <code className="bg-amber-100 px-1 rounded">LINKEDIN_COOKIES_PATH</code> in your environment, or apply manually.</p>
                        </div>
                      )}
                      <Button
                        className="gap-1.5 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white"
                        onClick={(e) => { e.stopPropagation(); handleAutoApply(detailJob.id); }}
                        disabled={autoApplyingJobId === detailJob.id}
                      >
                        {autoApplyingJobId === detailJob.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                        {autoApplyingJobId === detailJob.id ? "Applying..." : "Auto Apply"}
                      </Button>
                      <Button variant="outline" className="gap-1.5 text-green-600 border-green-200 hover:bg-green-50" onClick={(e) => { e.stopPropagation(); window.open(detailJob.url!, "_blank"); }}>
                        <Send className="w-4 h-4" /> Manual
                      </Button>
                    </>
                  );
                })()}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
