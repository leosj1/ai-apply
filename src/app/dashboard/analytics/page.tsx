"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Briefcase,
  Eye,
  MessageSquare,
  Calendar,
  Target,
  ArrowUpRight,
  ArrowDownRight,
  Loader2,
} from "lucide-react";

interface AnalyticsData {
  stats: { applicationsSent: number; jobsFound: number; interviewsSched: number; responseRate: number; avgAtsScore: number };
  weeklyActivity: { day: string; count: number }[];
  topCompanies: { name: string; applications: number; responses: number; rate: string }[];
  topSkills: { skill: string; mentions: number }[];
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/dashboard/stats");
        if (res.ok) {
          const d = await res.json();
          setData({
            stats: d.stats || { applicationsSent: 0, jobsFound: 0, interviewsSched: 0, responseRate: 0, avgAtsScore: 0 },
            weeklyActivity: d.weeklyActivity || [],
            topCompanies: d.topCompanies || [],
            topSkills: d.topSkills || [],
          });
        }
      } catch { /* */ }
      setIsLoading(false);
    }
    load();
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-violet-600" />
      </div>
    );
  }

  const stats = data?.stats;
  const weeklyActivity = data?.weeklyActivity || [];
  const topCompanies = data?.topCompanies || [];
  const topSkills = data?.topSkills || [];
  const maxWeeklyCount = Math.max(1, ...weeklyActivity.map((w) => w.count));
  const maxSkillMentions = Math.max(1, ...topSkills.map((s) => s.mentions));

  const overviewStats = [
    { title: "Jobs Found", value: String(stats?.jobsFound ?? 0), icon: Briefcase, color: "text-violet-600", bgColor: "bg-violet-50" },
    { title: "Applications Sent", value: String(stats?.applicationsSent ?? 0), icon: Briefcase, color: "text-purple-600", bgColor: "bg-purple-50" },
    { title: "Response Rate", value: `${stats?.responseRate ?? 0}%`, icon: Target, color: "text-blue-600", bgColor: "bg-blue-50" },
    { title: "Interviews", value: String(stats?.interviewsSched ?? 0), icon: Calendar, color: "text-emerald-600", bgColor: "bg-emerald-50" },
    { title: "Avg ATS Score", value: stats?.avgAtsScore ? `${stats.avgAtsScore}/100` : "—", icon: TrendingUp, color: "text-amber-600", bgColor: "bg-amber-50" },
  ];

  // Build funnel from real stats
  const appCount = stats?.jobsFound ?? 0;
  const responseCount = Math.round(appCount * (stats?.responseRate ?? 0) / 100);
  const interviewCount = stats?.interviewsSched ?? 0;
  const funnelStages = [
    { stage: "Applications Sent", count: appCount, pct: 100, color: "bg-violet-500" },
    { stage: "Response Received", count: responseCount, pct: appCount > 0 ? Math.round((responseCount / appCount) * 100) : 0, color: "bg-blue-500" },
    { stage: "Interview Scheduled", count: interviewCount, pct: appCount > 0 ? Math.round((interviewCount / appCount) * 100) : 0, color: "bg-emerald-500" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Analytics</h1>
        <p className="text-sm sm:text-base text-muted-foreground">
          Track your job search performance and get AI-powered insights.
        </p>
      </div>

      {/* Overview Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {overviewStats.map((stat, i) => (
          <motion.div
            key={stat.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
          >
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className={`w-10 h-10 rounded-xl ${stat.bgColor} flex items-center justify-center`}>
                    <stat.icon className={`w-5 h-5 ${stat.color}`} />
                  </div>
                </div>
                <p className="text-2xl font-bold">{stat.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{stat.title}</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Weekly Chart */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <CardTitle className="text-lg">Weekly Applications</CardTitle>
                <div className="flex items-center gap-3 sm:gap-4 text-xs">
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-violet-500" /> Applications</span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-blue-500" /> Responses</span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Interviews</span>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-end gap-3 h-48">
                {(weeklyActivity.length > 0 ? weeklyActivity : [{ day: "M", count: 0 }, { day: "T", count: 0 }, { day: "W", count: 0 }, { day: "T", count: 0 }, { day: "F", count: 0 }, { day: "S", count: 0 }, { day: "S", count: 0 }]).map((w, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full flex items-end gap-0.5 h-40">
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: `${maxWeeklyCount > 0 ? Math.max(4, (w.count / maxWeeklyCount) * 100) : 4}%` }}
                        transition={{ duration: 0.5, delay: i * 0.1 }}
                        className={`flex-1 rounded-t ${w.count > 0 ? "bg-violet-400" : "bg-gray-200"} min-h-[4px]`}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground">{w.day}</span>
                    {w.count > 0 && <span className="text-[9px] font-medium text-violet-600">{w.count}</span>}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Response Rate Funnel */}
          <Card className="mt-6">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Application Funnel</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {funnelStages.map((stage) => (
                  <div key={stage.stage} className="flex items-center gap-2 sm:gap-4">
                    <div className="w-28 sm:w-40 text-xs sm:text-sm font-medium truncate shrink-0">{stage.stage}</div>
                    <div className="flex-1 h-8 bg-gray-100 rounded-lg overflow-hidden relative">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${stage.pct}%` }}
                        transition={{ duration: 0.8 }}
                        className={`h-full ${stage.color} rounded-lg flex items-center justify-end pr-2`}
                      >
                        {stage.pct > 10 && (
                          <span className="text-[10px] font-semibold text-white">{stage.count}</span>
                        )}
                      </motion.div>
                      {stage.pct <= 10 && (
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-gray-600">
                          {stage.count}
                        </span>
                      )}
                    </div>
                    <div className="w-14 text-right text-xs text-muted-foreground">{stage.pct}%</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          {/* Top Companies */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Top Companies</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {topCompanies.map((company, i) => (
                  <div key={company.name} className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-4">{i + 1}</span>
                    <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-600">
                      {company.name[0]}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium">{company.name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {company.applications} applied &middot; {company.responses} responses
                      </p>
                    </div>
                    <Badge variant="secondary" className="text-[10px]">{company.rate}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* In-Demand Skills */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">In-Demand Skills</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {topSkills.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">No skill data yet. Scan for jobs to see in-demand skills.</p>
                ) : topSkills.map((skill) => (
                  <div key={skill.skill} className="flex items-center gap-3">
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium">{skill.skill}</span>
                        <span className="text-xs text-muted-foreground">{skill.mentions} mention{skill.mentions !== 1 ? "s" : ""}</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-1.5">
                        <div
                          className="bg-violet-500 h-1.5 rounded-full"
                          style={{ width: `${(skill.mentions / maxSkillMentions) * 100}%` }}
                        />
                      </div>
                    </div>
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
