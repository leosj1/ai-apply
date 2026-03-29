"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Headphones, Mic, Monitor, Sparkles, Shield, Zap, ArrowRight } from "lucide-react";

export default function BuddyPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Live Interview Buddy</h1>
        <p className="text-sm sm:text-base text-muted-foreground">
          Get real-time AI coaching during your live interviews.
        </p>
      </div>

      <div className="max-w-4xl mx-auto">
        <Card className="border-violet-200 bg-gradient-to-br from-violet-50/50 to-purple-50/50">
          <CardContent className="p-4 sm:p-8 text-center">
            <div className="w-20 h-20 rounded-2xl gradient-bg flex items-center justify-center mx-auto mb-6 shadow-lg shadow-purple-500/25">
              <Headphones className="w-10 h-10 text-white" />
            </div>
            <h2 className="text-xl sm:text-2xl font-bold mb-3">Your AI Interview Companion</h2>
            <p className="text-muted-foreground max-w-lg mx-auto mb-8">
              Interview Buddy listens to your live interview and provides real-time answer suggestions,
              talking points, and confidence boosters directly on your screen.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
              {[
                { icon: Mic, title: "Real-Time Listening", description: "AI listens to interview questions as they're asked" },
                { icon: Sparkles, title: "Instant Suggestions", description: "Get answer frameworks and key points in seconds" },
                { icon: Shield, title: "Completely Discreet", description: "Subtle overlay that only you can see on your screen" },
              ].map((feature) => (
                <div key={feature.title} className="p-4 rounded-xl bg-white border">
                  <feature.icon className="w-8 h-8 text-violet-600 mx-auto mb-3" />
                  <p className="text-sm font-semibold mb-1">{feature.title}</p>
                  <p className="text-xs text-muted-foreground">{feature.description}</p>
                </div>
              ))}
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Button variant="gradient" size="lg" className="gap-2">
                <Zap className="w-4 h-4" />
                Start Interview Buddy
              </Button>
              <Button variant="outline" size="lg" className="gap-2">
                <Monitor className="w-4 h-4" />
                Test Setup
              </Button>
            </div>

            <p className="text-xs text-muted-foreground mt-4">
              Requires microphone access. Works with Zoom, Google Meet, Teams, and more.
            </p>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">How It Works</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {[
                  { step: "1", title: "Start your video call", desc: "Join your interview on any platform" },
                  { step: "2", title: "Activate Interview Buddy", desc: "Click start and grant microphone access" },
                  { step: "3", title: "Get real-time help", desc: "See answer suggestions appear on screen" },
                  { step: "4", title: "Ace the interview", desc: "Deliver confident, well-structured answers" },
                ].map((item) => (
                  <div key={item.step} className="flex items-start gap-3">
                    <div className="w-7 h-7 rounded-full bg-violet-100 flex items-center justify-center text-xs font-bold text-violet-600 shrink-0">
                      {item.step}
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{item.title}</p>
                      <p className="text-xs text-muted-foreground">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Recent Sessions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col items-center justify-center h-48 text-center">
                <Headphones className="w-10 h-10 text-gray-300 mb-3" />
                <p className="text-sm text-muted-foreground">No sessions yet</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Start your first Interview Buddy session to see history here.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
