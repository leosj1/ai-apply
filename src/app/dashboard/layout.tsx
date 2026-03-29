"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Sparkles,
  LayoutDashboard,
  FileText,
  Mail,
  Inbox,
  Zap,
  Mic,
  Headphones,
  Globe,
  BarChart3,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Bell,
  Search,
  Crown,
  Briefcase,
} from "lucide-react";

const sidebarItems = [
  { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard" },
  { icon: Zap, label: "Auto Apply", href: "/dashboard/auto-apply" },
  { icon: Briefcase, label: "Pipeline", href: "/dashboard/pipeline" },
  { icon: Inbox, label: "Email Hub", href: "/dashboard/email" },
  { icon: FileText, label: "Resume Builder", href: "/dashboard/resume" },
  { icon: Mail, label: "Cover Letters", href: "/dashboard/cover-letter" },
  { icon: Mic, label: "Interview Coach", href: "/dashboard/interview" },
  { icon: Headphones, label: "Interview Buddy", href: "/dashboard/buddy" },
  { icon: Globe, label: "Translator", href: "/dashboard/translator" },
  { icon: BarChart3, label: "Analytics", href: "/dashboard/analytics" },
  { icon: Settings, label: "Settings", href: "/dashboard/settings" },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [checkingOnboarding, setCheckingOnboarding] = useState(true);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    async function checkOnboarding() {
      try {
        const res = await fetch("/api/user/onboarding");
        if (res.ok) {
          const data = await res.json();
          if (!data.onboardingComplete) {
            router.replace("/onboarding");
            return;
          }
        }
      } catch { /* proceed to dashboard */ }
      setCheckingOnboarding(false);
    }
    checkOnboarding();
  }, [router]);

  if (checkingOnboarding) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50/50">
        <div className="w-8 h-8 border-3 border-violet-300 border-t-violet-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50/50 flex">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}
      {/* Sidebar */}
      <aside
        className={cn(
          "fixed left-0 top-0 bottom-0 z-40 bg-white border-r border-gray-200/80 flex flex-col transition-all duration-300",
          collapsed ? "w-[68px]" : "w-[260px]",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        {/* Logo */}
        <div className="h-16 flex items-center px-4 border-b">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg gradient-bg flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            {!collapsed && (
              <span className="text-lg font-bold tracking-tight">
                Apply<span className="gradient-text">AI</span>
              </span>
            )}
          </Link>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
          {sidebarItems.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/dashboard" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200",
                  isActive
                    ? "bg-violet-50 text-violet-700 shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-gray-50"
                )}
              >
                <item.icon
                  className={cn(
                    "w-5 h-5 shrink-0",
                    isActive ? "text-violet-600" : ""
                  )}
                />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Upgrade card */}
        {!collapsed && (
          <div className="p-3">
            <div className="rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 p-4 text-white">
              <div className="flex items-center gap-2 mb-2">
                <Crown className="w-4 h-4" />
                <span className="text-sm font-semibold">Upgrade to Pro</span>
              </div>
              <p className="text-xs text-white/80 mb-3">
                Unlock unlimited auto-apply and all premium features.
              </p>
              <Button
                size="sm"
                className="w-full bg-white text-violet-700 hover:bg-white/90 text-xs font-semibold"
              >
                Upgrade Now
              </Button>
            </div>
          </div>
        )}

        {/* Collapse toggle */}
        <div className="p-3 border-t hidden lg:block">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-gray-50 transition-colors"
          >
            {collapsed ? (
              <ChevronRight className="w-4 h-4" />
            ) : (
              <>
                <ChevronLeft className="w-4 h-4" />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div
        className={cn(
          "flex-1 transition-all duration-300",
          "ml-0 lg:ml-[260px]",
          collapsed && "lg:ml-[68px]"
        )}
      >
        {/* Top bar */}
        <header className="h-14 sm:h-16 bg-white/80 backdrop-blur-sm border-b border-gray-200/50 flex items-center justify-between px-3 sm:px-6 sticky top-0 z-20">
          <div className="flex items-center gap-2 sm:gap-3 flex-1">
            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="p-2 rounded-lg hover:bg-gray-100 transition-colors lg:hidden"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div className="relative max-w-md w-full hidden sm:block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search jobs, resumes, letters..."
                className="w-full h-9 pl-9 pr-4 rounded-lg border bg-gray-50/80 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-300 transition-all"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <button className="relative p-2 rounded-lg hover:bg-gray-100 transition-colors">
              <Bell className="w-5 h-5 text-muted-foreground" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full" />
            </button>
            <UserButton
              afterSignOutUrl="/"
              appearance={{
                elements: {
                  avatarBox: "w-8 h-8",
                },
              }}
            />
          </div>
        </header>

        {/* Page content */}
        <main className="p-3 sm:p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
