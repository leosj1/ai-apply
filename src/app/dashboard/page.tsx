"use client";

import { useState, useEffect } from "react";
import { DashboardSkeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Zap,
  FileText,
  Mail,
  Mic,
  TrendingUp,
  ArrowUpRight,
  ArrowRight,
  Briefcase,
  CheckCircle2,
  Clock,
  Eye,
  MessageSquare,
  Target,
  Calendar,
} from "lucide-react";
import Link from "next/link";

const statusColorMap: Record<string, string> = {
  queued: "bg-gray-100 text-gray-700",
  applied: "bg-blue-100 text-blue-700",
  interview: "bg-green-100 text-green-700",
  offer: "bg-emerald-100 text-emerald-700",
  rejected: "bg-red-100 text-red-700",
  skipped: "bg-yellow-100 text-yellow-700",
};

const quickActions = [
  {
    icon: Zap,
    title: "Auto Apply",
    description: "Apply to matched jobs automatically",
    href: "/dashboard/auto-apply",
    color: "from-violet-500 to-purple-600",
  },
  {
    icon: FileText,
    title: "Build Resume",
    description: "Create an ATS-optimized resume",
    href: "/dashboard/resume",
    color: "from-blue-500 to-cyan-500",
  },
  {
    icon: Mail,
    title: "Cover Letter",
    description: "Generate a tailored cover letter",
    href: "/dashboard/cover-letter",
    color: "from-emerald-500 to-green-500",
  },
  {
    icon: Mic,
    title: "Practice Interview",
    description: "AI-powered mock interviews",
    href: "/dashboard/interview",
    color: "from-amber-500 to-orange-500",
  },
];

interface DashboardStats {
  user: { firstName: string | null };
  stats: {
    applicationsSent: number;
    jobsFound: number;
    interviewsSched: number;
    responseRate: number;
    avgAtsScore: number;
  };
  weeklyActivity?: { day: string; count: number }[];
  topCompanies?: { name: string; applications: number; responses: number; rate: string }[];
  topSkills?: { skill: string; mentions: number }[];
  recentApplications: {
    id: string;
    company: string;
    role: string;
    status: string;
    match: number;
    time: string;
  }[];
  recentInterviews: {
    id: string;
    company: string;
    role: string;
    type: string;
    score: number | null;
    date: string;
  }[];
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/dashboard/stats");
        if (res.ok) {
          setData(await res.json());
        }
      } catch {
        // use defaults
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, []);

  const firstName = data?.user?.firstName || "there";
  const stats = data?.stats;
  const recentApplications = data?.recentApplications || [];
  const recentInterviews = data?.recentInterviews || [];
  const weeklyActivity = data?.weeklyActivity || [];
  const maxWeeklyCount = Math.max(1, ...weeklyActivity.map((w) => w.count));

  if (isLoading) return <DashboardSkeleton />;

  const statsCards = [
    {
      title: "Applications Sent",
      value: String(stats?.applicationsSent ?? 0),
      change: isLoading ? "Loading..." : `${stats?.jobsFound ?? 0} jobs found`,
      icon: Briefcase,
      color: "text-violet-600",
      bgColor: "bg-violet-50",
    },
    {
      title: "Interviews Scheduled",
      value: String(stats?.interviewsSched ?? 0),
      change: isLoading ? "Loading..." : `${stats?.interviewsSched ?? 0} active`,
      icon: Calendar,
      color: "text-blue-600",
      bgColor: "bg-blue-50",
    },
    {
      title: "Response Rate",
      value: `${stats?.responseRate ?? 0}%`,
      change: isLoading ? "Loading..." : "Based on all applications",
      icon: Target,
      color: "text-emerald-600",
      bgColor: "bg-emerald-50",
    },
    {
      title: "ATS Score",
      value: stats?.avgAtsScore ? `${stats.avgAtsScore}/100` : "—",
      change: isLoading ? "Loading..." : "Average across resumes",
      icon: TrendingUp,
      color: "text-amber-600",
      bgColor: "bg-amber-50",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
            Welcome back, {firstName}
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground">
            {recentApplications.length > 0
              ? "Here's your job search overview."
              : "Get started by uploading a resume or applying to jobs."}
          </p>
        </div>
        <Link href="/dashboard/auto-apply" className="shrink-0">
          <Button variant="gradient" className="gap-2 w-full sm:w-auto">
            <Zap className="w-4 h-4" />
            Start Auto-Apply
          </Button>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statsCards.map((stat, i) => (
          <motion.div
            key={stat.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: i * 0.1 }}
          >
            <Card className="hover:shadow-md transition-shadow">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <div
                    className={`w-10 h-10 rounded-xl ${stat.bgColor} flex items-center justify-center`}
                  >
                    <stat.icon className={`w-5 h-5 ${stat.color}`} />
                  </div>
                  <ArrowUpRight className="w-4 h-4 text-green-500" />
                </div>
                <p className="text-2xl font-bold">{stat.value}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {stat.title}
                </p>
                <p className="text-xs text-green-600 font-medium mt-1">
                  {stat.change}
                </p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Applications */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Recent Applications</CardTitle>
                <Link href="/dashboard/auto-apply">
                  <Button variant="ghost" size="sm" className="text-xs gap-1">
                    View All <ArrowRight className="w-3 h-3" />
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              {recentApplications.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Briefcase className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No applications yet.</p>
                  <p className="text-xs mt-1">Start auto-applying to see your applications here.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {recentApplications.map((app) => (
                    <div
                      key={app.id}
                      className="flex items-center gap-4 p-3 rounded-xl hover:bg-gray-50 transition-colors group cursor-pointer"
                    >
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center text-sm font-bold text-gray-600 shrink-0">
                        {app.company[0]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold truncate">
                            {app.company}
                          </p>
                          {app.match > 0 && (
                            <Badge
                              variant="secondary"
                              className="text-[10px] shrink-0"
                            >
                              {app.match}% match
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {app.role}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <span
                          className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${statusColorMap[app.status] || "bg-gray-100 text-gray-700"}`}
                        >
                          {app.status.charAt(0).toUpperCase() + app.status.slice(1)}
                        </span>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {app.time}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right sidebar */}
        <div className="space-y-6">
          {/* Quick Actions */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                {quickActions.map((action) => (
                  <Link key={action.title} href={action.href}>
                    <div className="p-3 rounded-xl border hover:shadow-md transition-all hover:-translate-y-0.5 cursor-pointer group">
                      <div
                        className={`w-9 h-9 rounded-lg bg-gradient-to-br ${action.color} flex items-center justify-center mb-2`}
                      >
                        <action.icon className="w-4 h-4 text-white" />
                      </div>
                      <p className="text-xs font-semibold group-hover:text-violet-600 transition-colors">
                        {action.title}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {action.description}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Recent Interview Sessions */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Recent Interviews</CardTitle>
            </CardHeader>
            <CardContent>
              {recentInterviews.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground">
                  <Mic className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-xs">No interview sessions yet.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {recentInterviews.map((interview) => (
                    <div
                      key={interview.id}
                      className="p-3 rounded-xl border bg-gradient-to-r from-violet-50/50 to-purple-50/50"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-sm font-semibold">
                          {interview.company}
                        </p>
                        <Badge
                          variant="outline"
                          className="text-[10px] border-violet-200 text-violet-700"
                        >
                          {interview.type}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {interview.role}
                      </p>
                      <div className="flex items-center justify-between mt-2">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Calendar className="w-3 h-3" />
                          <span>{interview.date}</span>
                        </div>
                        {interview.score && (
                          <span className="text-xs font-semibold text-violet-600">
                            Score: {interview.score}%
                          </span>
                        )}
                      </div>
                      <Link href="/dashboard/interview">
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full mt-3 text-xs h-8"
                        >
                          <Mic className="w-3 h-3 mr-1" />
                          Practice again
                        </Button>
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Activity chart */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Weekly Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-end gap-1.5 h-24">
                {(weeklyActivity.length > 0 ? weeklyActivity : [{ day: "M", count: 0 }, { day: "T", count: 0 }, { day: "W", count: 0 }, { day: "T", count: 0 }, { day: "F", count: 0 }, { day: "S", count: 0 }, { day: "S", count: 0 }]).map((w, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: `${maxWeeklyCount > 0 ? Math.max(5, (w.count / maxWeeklyCount) * 100) : 5}%` }}
                      transition={{ duration: 0.5, delay: i * 0.1 }}
                      className={`w-full rounded-t-md ${w.count > 0 ? "bg-gradient-to-t from-violet-500 to-purple-400" : "bg-gray-200"}`}
                    />
                    <span className="text-[9px] text-muted-foreground">
                      {w.day}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
