"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles,
  ArrowRight,
  Play,
  CheckCircle2,
  Star,
  Zap,
  TrendingUp,
  FileText,
  Send,
} from "lucide-react";

const stats = [
  { value: "2.4M+", label: "Jobs Applied" },
  { value: "89%", label: "Interview Rate" },
  { value: "150K+", label: "Users Hired" },
  { value: "4.9/5", label: "User Rating" },
];

const floatingCards = [
  {
    icon: FileText,
    label: "Resume Optimized",
    detail: "ATS Score: 94/100",
    color: "from-violet-500 to-purple-600",
    position: "top-20 -left-8 lg:left-12",
    delay: 0.8,
  },
  {
    icon: Send,
    label: "Auto-Applied",
    detail: "47 jobs today",
    color: "from-blue-500 to-cyan-500",
    position: "top-40 -right-4 lg:right-8",
    delay: 1.2,
  },
  {
    icon: TrendingUp,
    label: "Interview Scheduled",
    detail: "Google - Sr. Engineer",
    color: "from-emerald-500 to-green-500",
    position: "bottom-24 -left-4 lg:left-20",
    delay: 1.6,
  },
];

export function Hero() {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-20">
      {/* Background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 dot-pattern opacity-40" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-gradient-to-b from-violet-500/10 via-purple-500/5 to-transparent rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-gradient-to-tr from-blue-500/10 to-transparent rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-gradient-to-tl from-purple-500/10 to-transparent rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-32">
        <div className="text-center max-w-4xl mx-auto">
          {/* Badge */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <Badge
              variant="outline"
              className="px-4 py-2 text-sm font-medium border-violet-200 bg-violet-50 text-violet-700 mb-8 inline-flex items-center gap-2"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Powered by GPT-4o & Advanced AI
              <ArrowRight className="w-3.5 h-3.5" />
            </Badge>
          </motion.div>

          {/* Headline */}
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.1] mb-6"
          >
            Stop Applying for Weeks.
            <br />
            <span className="gradient-text">Start Interviewing</span> in Days.
          </motion.h1>

          {/* Subheadline */}
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed"
          >
            ApplyAI Pro finds high-match roles, tailors your resume & cover
            letter, auto-applies to hundreds of jobs daily, and coaches you live
            — so you land your dream job faster than ever.
          </motion.p>

          {/* CTA Buttons */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-8"
          >
            <Link href="/sign-up" className="w-full sm:w-auto">
              <Button variant="gradient" size="xl" className="group w-full">
                <Sparkles className="w-5 h-5 mr-2" />
                Start Free — No Credit Card
                <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
            <Button variant="outline" size="xl" className="w-full sm:w-auto gap-2">
              <div className="w-8 h-8 rounded-full bg-violet-100 flex items-center justify-center">
                <Play className="w-3.5 h-3.5 text-violet-600 ml-0.5" />
              </div>
              Watch Demo
            </Button>
          </motion.div>

          {/* Trust signals */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground mb-16"
          >
            {[
              "No credit card required",
              "14-day free trial",
              "Cancel anytime",
            ].map((item) => (
              <span key={item} className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                {item}
              </span>
            ))}
          </motion.div>

          {/* Hero Visual - Dashboard Preview */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.5 }}
            className="relative max-w-5xl mx-auto"
          >
            <div className="relative rounded-2xl border border-gray-200/80 bg-white/80 backdrop-blur-sm shadow-2xl shadow-purple-500/10 overflow-hidden">
              {/* Browser chrome */}
              <div className="flex items-center gap-2 px-4 py-3 border-b bg-gray-50/80">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-400" />
                  <div className="w-3 h-3 rounded-full bg-yellow-400" />
                  <div className="w-3 h-3 rounded-full bg-green-400" />
                </div>
                <div className="flex-1 flex justify-center">
                  <div className="px-4 py-1 bg-white rounded-lg text-xs text-muted-foreground border flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-green-400" />
                    app.applyai.pro/dashboard
                  </div>
                </div>
              </div>

              {/* Dashboard mockup */}
              <div className="p-6 lg:p-8">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Left - Stats */}
                  <div className="lg:col-span-2 space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-lg font-semibold text-left">
                          Welcome back, Sarah
                        </h3>
                        <p className="text-sm text-muted-foreground text-left">
                          Your job search is 3x faster than average
                        </p>
                      </div>
                      <Badge variant="gradient" className="text-xs">
                        <Zap className="w-3 h-3 mr-1" />
                        Pro Plan
                      </Badge>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {[
                        {
                          label: "Applied Today",
                          value: "47",
                          change: "+12",
                          color: "text-violet-600",
                        },
                        {
                          label: "Interviews",
                          value: "8",
                          change: "+3",
                          color: "text-blue-600",
                        },
                        {
                          label: "Response Rate",
                          value: "34%",
                          change: "+5%",
                          color: "text-emerald-600",
                        },
                        {
                          label: "ATS Score",
                          value: "94",
                          change: "+8",
                          color: "text-amber-600",
                        },
                      ].map((stat) => (
                        <div
                          key={stat.label}
                          className="bg-gray-50 rounded-xl p-3 text-left"
                        >
                          <p className="text-xs text-muted-foreground">
                            {stat.label}
                          </p>
                          <p className={`text-2xl font-bold ${stat.color}`}>
                            {stat.value}
                          </p>
                          <p className="text-xs text-green-600 font-medium">
                            {stat.change} this week
                          </p>
                        </div>
                      ))}
                    </div>

                    {/* Activity chart placeholder */}
                    <div className="bg-gray-50 rounded-xl p-4 h-32 flex items-end gap-1">
                      {[40, 65, 45, 80, 55, 90, 70, 85, 60, 95, 75, 88].map(
                        (h, i) => (
                          <motion.div
                            key={i}
                            initial={{ height: 0 }}
                            animate={{ height: `${h}%` }}
                            transition={{ duration: 0.5, delay: 0.8 + i * 0.05 }}
                            className="flex-1 rounded-t-md bg-gradient-to-t from-violet-500 to-purple-400 opacity-80"
                          />
                        )
                      )}
                    </div>
                  </div>

                  {/* Right - Recent Activity */}
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold text-left">
                      Recent Activity
                    </h4>
                    {[
                      {
                        company: "Google",
                        role: "Sr. Software Engineer",
                        status: "Interview",
                        statusColor: "bg-green-100 text-green-700",
                        time: "2m ago",
                      },
                      {
                        company: "Stripe",
                        role: "Full Stack Developer",
                        status: "Applied",
                        statusColor: "bg-blue-100 text-blue-700",
                        time: "15m ago",
                      },
                      {
                        company: "Vercel",
                        role: "Frontend Engineer",
                        status: "Applied",
                        statusColor: "bg-blue-100 text-blue-700",
                        time: "32m ago",
                      },
                      {
                        company: "OpenAI",
                        role: "ML Engineer",
                        status: "Reviewing",
                        statusColor: "bg-amber-100 text-amber-700",
                        time: "1h ago",
                      },
                      {
                        company: "Netflix",
                        role: "Platform Engineer",
                        status: "Applied",
                        statusColor: "bg-blue-100 text-blue-700",
                        time: "2h ago",
                      },
                    ].map((item) => (
                      <div
                        key={item.company}
                        className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl text-left"
                      >
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center text-xs font-bold text-gray-600">
                          {item.company[0]}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {item.company}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {item.role}
                          </p>
                        </div>
                        <div className="text-right">
                          <span
                            className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${item.statusColor}`}
                          >
                            {item.status}
                          </span>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {item.time}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Floating notification cards */}
            {floatingCards.map((card) => (
              <motion.div
                key={card.label}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5, delay: card.delay }}
                className={`absolute ${card.position} hidden lg:flex items-center gap-3 bg-white rounded-xl border shadow-lg p-3 animate-float`}
              >
                <div
                  className={`w-10 h-10 rounded-lg bg-gradient-to-br ${card.color} flex items-center justify-center`}
                >
                  <card.icon className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="text-sm font-semibold">{card.label}</p>
                  <p className="text-xs text-muted-foreground">{card.detail}</p>
                </div>
              </motion.div>
            ))}
          </motion.div>

          {/* Stats bar */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 1.0 }}
            className="mt-16 grid grid-cols-2 lg:grid-cols-4 gap-8 max-w-3xl mx-auto"
          >
            {stats.map((stat) => (
              <div key={stat.label} className="text-center">
                <p className="text-3xl lg:text-4xl font-bold gradient-text">
                  {stat.value}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {stat.label}
                </p>
              </div>
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  );
}
