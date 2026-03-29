"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Briefcase,
  MapPin,
  ExternalLink,
  Loader2,
  ChevronRight,
  ChevronLeft,
  GripVertical,
  RefreshCw,
  Search,
  ArrowUpDown,
  X,
  CheckCircle,
} from "lucide-react";

interface PipelineJob {
  id: string;
  company: string;
  role: string;
  location: string | null;
  salary: string | null;
  match: number;
  status: string;
  url: string | null;
  source: string | null;
  createdAt: string;
  appliedAt: string | null;
}

const PIPELINE_STAGES = [
  { key: "matched", label: "Matched", color: "bg-violet-500", lightBg: "bg-violet-50", border: "border-violet-200" },
  { key: "ready", label: "Ready", color: "bg-blue-500", lightBg: "bg-blue-50", border: "border-blue-200" },
  { key: "applied", label: "Applied", color: "bg-amber-500", lightBg: "bg-amber-50", border: "border-amber-200" },
  { key: "phone_screen", label: "Phone Screen", color: "bg-orange-500", lightBg: "bg-orange-50", border: "border-orange-200" },
  { key: "interview", label: "Interview", color: "bg-cyan-500", lightBg: "bg-cyan-50", border: "border-cyan-200" },
  { key: "offer", label: "Offer", color: "bg-green-500", lightBg: "bg-green-50", border: "border-green-200" },
  { key: "rejected", label: "Rejected", color: "bg-red-500", lightBg: "bg-red-50", border: "border-red-200" },
];

export default function PipelinePage() {
  const [jobs, setJobs] = useState<PipelineJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [movingJobId, setMovingJobId] = useState<string | null>(null);
  const [dragJobId, setDragJobId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [sortBy, setSortBy] = useState<"match" | "date" | "company">("match");
  const [minMatch, setMinMatch] = useState(0);

  const handleDragStart = (e: React.DragEvent, jobId: string) => {
    setDragJobId(jobId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", jobId);
  };

  const handleDragOver = (e: React.DragEvent, stageKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverStage(stageKey);
  };

  const handleDragLeave = () => {
    setDragOverStage(null);
  };

  const handleDrop = async (e: React.DragEvent, stageKey: string) => {
    e.preventDefault();
    setDragOverStage(null);
    const jobId = e.dataTransfer.getData("text/plain");
    if (!jobId) return;
    const job = jobs.find((j) => j.id === jobId);
    if (!job || job.status === stageKey) { setDragJobId(null); return; }
    setDragJobId(null);
    await moveJob(jobId, stageKey);
  };

  const handleDragEnd = () => {
    setDragJobId(null);
    setDragOverStage(null);
  };

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/ai/auto-apply");
      if (!res.ok) return;
      const data = await res.json();
      setJobs(
        (data.jobs || []).map((j: PipelineJob) => ({
          id: j.id,
          company: j.company,
          role: j.role,
          location: j.location,
          salary: j.salary,
          match: j.match,
          status: j.status,
          url: j.url,
          source: j.source,
          createdAt: j.createdAt,
          appliedAt: j.appliedAt,
        }))
      );
    } catch {
      // silent
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  const [preparingJobId, setPreparingJobId] = useState<string | null>(null);
  const [prepareToast, setPrepareToast] = useState<string | null>(null);

  const moveJob = async (jobId: string, newStatus: string) => {
    setMovingJobId(jobId);
    try {
      const res = await fetch("/api/ai/auto-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "updateStatus", jobId, status: newStatus }),
      });
      if (res.ok) {
        setJobs((prev) =>
          prev.map((j) => (j.id === jobId ? { ...j, status: newStatus } : j))
        );
        // Auto-trigger prepare when moving to "ready"
        if (newStatus === "ready") {
          triggerPrepare(jobId);
        }
      }
    } catch {
      // silent
    }
    setMovingJobId(null);
  };

  const triggerPrepare = async (jobId: string) => {
    setPreparingJobId(jobId);
    const job = jobs.find((j) => j.id === jobId);
    setPrepareToast(`Preparing tailored resume for ${job?.role || "job"}...`);
    try {
      const res = await fetch("/api/ai/auto-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "prepare", jobId }),
      });
      if (res.ok) {
        setPrepareToast(`Resume & cover letter ready for ${job?.role || "job"}!`);
      } else {
        setPrepareToast("Failed to prepare — try again from the dashboard.");
      }
    } catch {
      setPrepareToast("Failed to prepare — try again from the dashboard.");
    }
    setPreparingJobId(null);
    setTimeout(() => setPrepareToast(null), 4000);
  };

  const getNextStage = (current: string): string | null => {
    const idx = PIPELINE_STAGES.findIndex((s) => s.key === current);
    if (idx < 0 || idx >= PIPELINE_STAGES.length - 2) return null; // Don't auto-advance to rejected
    return PIPELINE_STAGES[idx + 1].key;
  };

  const getPrevStage = (current: string): string | null => {
    const idx = PIPELINE_STAGES.findIndex((s) => s.key === current);
    if (idx <= 0) return null;
    return PIPELINE_STAGES[idx - 1].key;
  };

  // Apply filters
  const filteredJobs = jobs.filter((j) => {
    if (minMatch > 0 && j.match < minMatch) return false;
    if (searchText) {
      const q = searchText.toLowerCase();
      if (!j.company.toLowerCase().includes(q) && !j.role.toLowerCase().includes(q) && !(j.location || "").toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // Apply sort within each stage
  const sortFn = (a: PipelineJob, b: PipelineJob) => {
    if (sortBy === "match") return b.match - a.match;
    if (sortBy === "company") return a.company.localeCompare(b.company);
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  };

  const jobsByStage = PIPELINE_STAGES.map((stage) => ({
    ...stage,
    jobs: filteredJobs.filter((j) => j.status === stage.key).sort(sortFn),
  }));

  const totalActive = jobs.filter((j) => !["rejected", "skipped"].includes(j.status)).length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-violet-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Application Pipeline</h1>
          <p className="text-sm text-muted-foreground">
            Track your applications through every stage. {totalActive} active application{totalActive !== 1 ? "s" : ""}.
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { setIsLoading(true); fetchJobs(); }}>
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </Button>
      </div>

      {/* Filter & Sort Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search jobs..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="pl-7 pr-7 py-1.5 rounded-lg border bg-white text-xs w-44 focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-300"
          />
          {searchText && (
            <button onClick={() => setSearchText("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-gray-600">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as "match" | "date" | "company")}
          className="px-2 py-1.5 rounded-lg border bg-white text-xs text-muted-foreground focus:outline-none focus:ring-2 focus:ring-violet-200 cursor-pointer"
        >
          <option value="match">Sort: Best Match</option>
          <option value="date">Sort: Newest</option>
          <option value="company">Sort: Company</option>
        </select>
        <select
          value={minMatch}
          onChange={(e) => setMinMatch(Number(e.target.value))}
          className="px-2 py-1.5 rounded-lg border bg-white text-xs text-muted-foreground focus:outline-none focus:ring-2 focus:ring-violet-200 cursor-pointer"
        >
          <option value={0}>Any Match</option>
          <option value={60}>60%+</option>
          <option value={70}>70%+</option>
          <option value={80}>80%+</option>
          <option value={90}>90%+</option>
        </select>
        {(searchText || minMatch > 0) && (
          <button
            onClick={() => { setSearchText(""); setMinMatch(0); }}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium text-red-600 hover:bg-red-50 border border-red-200"
          >
            <X className="w-3 h-3" /> Clear
          </button>
        )}
        <Badge variant="secondary" className="text-[10px]">{filteredJobs.length} of {jobs.length} jobs</Badge>
      </div>

      {/* Pipeline summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {jobsByStage.map((stage) => (
          <div key={stage.key} className={`rounded-xl p-3 ${stage.lightBg} border ${stage.border}`}>
            <div className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-full ${stage.color}`} />
              <span className="text-xs font-semibold">{stage.label}</span>
            </div>
            <p className="text-2xl font-bold mt-1">{stage.jobs.length}</p>
          </div>
        ))}
      </div>

      {/* Kanban columns */}
      <div className="flex gap-4 overflow-x-auto pb-4 -mx-2 px-2">
        {jobsByStage.map((stage) => (
          <div key={stage.key} className="flex-shrink-0 w-72">
            <div className={`rounded-xl border ${stage.border} overflow-hidden`}>
              {/* Column header */}
              <div className={`px-3 py-2.5 ${stage.lightBg} border-b ${stage.border} flex items-center justify-between`}>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${stage.color}`} />
                  <span className="text-xs font-bold">{stage.label}</span>
                </div>
                <Badge variant="secondary" className="text-[10px] h-5">{stage.jobs.length}</Badge>
              </div>

              {/* Cards */}
              <div
                className={`p-2 space-y-2 min-h-[120px] max-h-[60vh] overflow-y-auto transition-colors ${dragOverStage === stage.key ? "bg-violet-50 ring-2 ring-violet-300 ring-inset" : "bg-gray-50/50"}`}
                onDragOver={(e) => handleDragOver(e, stage.key)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, stage.key)}
              >
                {stage.jobs.length === 0 && (
                  <p className="text-[10px] text-muted-foreground text-center py-6 italic">No applications</p>
                )}
                {stage.jobs.map((job) => (
                  <Card
                    key={job.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, job.id)}
                    onDragEnd={handleDragEnd}
                    className={`shadow-sm hover:shadow-md transition-all cursor-grab active:cursor-grabbing ${dragJobId === job.id ? "opacity-40 scale-95" : ""}`}
                  >
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-start gap-2">
                        <GripVertical className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold truncate">{job.role}</p>
                          <p className="text-[10px] text-muted-foreground truncate">{job.company}</p>
                        </div>
                        <div className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${job.match >= 80 ? "bg-green-100 text-green-700" : job.match >= 60 ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"}`}>
                          {job.match}%
                        </div>
                      </div>

                      {job.location && (
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <MapPin className="w-3 h-3" /> {job.location}
                        </div>
                      )}

                      {job.source && (
                        <Badge variant="outline" className="text-[9px] h-4">{job.source}</Badge>
                      )}

                      {/* Move buttons */}
                      <div className="flex items-center gap-1 pt-1 border-t">
                        {getPrevStage(job.status) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-1.5 text-[10px] gap-0.5"
                            onClick={() => moveJob(job.id, getPrevStage(job.status)!)}
                            disabled={movingJobId === job.id}
                          >
                            <ChevronLeft className="w-3 h-3" />
                            {PIPELINE_STAGES.find((s) => s.key === getPrevStage(job.status))?.label}
                          </Button>
                        )}
                        <div className="flex-1" />
                        {job.url && (
                          <a href={job.url} target="_blank" rel="noopener noreferrer" className="p-1 rounded hover:bg-gray-100">
                            <ExternalLink className="w-3 h-3 text-muted-foreground" />
                          </a>
                        )}
                        {getNextStage(job.status) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-1.5 text-[10px] gap-0.5"
                            onClick={() => moveJob(job.id, getNextStage(job.status)!)}
                            disabled={movingJobId === job.id}
                          >
                            {PIPELINE_STAGES.find((s) => s.key === getNextStage(job.status))?.label}
                            <ChevronRight className="w-3 h-3" />
                          </Button>
                        )}
                        {stage.key !== "rejected" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-1.5 text-[10px] text-red-500 hover:text-red-600 hover:bg-red-50"
                            onClick={() => moveJob(job.id, "rejected")}
                            disabled={movingJobId === job.id}
                          >
                            Reject
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Conversion funnel */}
      {totalActive > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Briefcase className="w-4 h-4" /> Conversion Funnel
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-1 h-32">
              {PIPELINE_STAGES.filter((s) => s.key !== "rejected").map((stage) => {
                const count = jobsByStage.find((s) => s.key === stage.key)?.jobs.length || 0;
                const maxCount = Math.max(...jobsByStage.map((s) => s.jobs.length), 1);
                const height = Math.max(8, (count / maxCount) * 100);
                return (
                  <div key={stage.key} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-[10px] font-bold">{count}</span>
                    <div className={`w-full rounded-t-lg ${stage.color} transition-all`} style={{ height: `${height}%` }} />
                    <span className="text-[9px] text-muted-foreground text-center leading-tight">{stage.label}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Prepare toast */}
      {prepareToast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 bg-white border border-violet-200 shadow-xl rounded-xl px-4 py-3 animate-in slide-in-from-bottom-4">
          {preparingJobId ? <Loader2 className="w-4 h-4 animate-spin text-violet-600" /> : <CheckCircle className="w-4 h-4 text-green-600" />}
          <span className="text-xs font-medium">{prepareToast}</span>
        </div>
      )}
    </div>
  );
}
