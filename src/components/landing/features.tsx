"use client";

import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Zap,
  FileText,
  Mail,
  Mic,
  Headphones,
  Globe,
  Brain,
  BarChart3,
  Shield,
  ArrowRight,
} from "lucide-react";

const features = [
  {
    icon: Zap,
    title: "Smart Auto-Apply",
    description:
      "AI matches you with high-fit roles and auto-applies to hundreds of positions daily. Custom-tailored applications, not spray-and-pray.",
    color: "from-violet-500 to-purple-600",
    bgColor: "bg-violet-50",
    badge: "Most Popular",
  },
  {
    icon: FileText,
    title: "AI Resume Builder",
    description:
      "Build ATS-optimized resumes that score 90%+ every time. Our AI analyzes job descriptions and highlights your most relevant experience.",
    color: "from-blue-500 to-cyan-500",
    bgColor: "bg-blue-50",
    badge: null,
  },
  {
    icon: Mail,
    title: "Cover Letter Generator",
    description:
      "Generate personalized, compelling cover letters in seconds. Each one is uniquely crafted to match the job requirements and company culture.",
    color: "from-emerald-500 to-green-500",
    bgColor: "bg-emerald-50",
    badge: null,
  },
  {
    icon: Mic,
    title: "AI Interview Coach",
    description:
      "Practice with role-specific questions, get instant feedback on your answers, body language tips, and build confidence before the real thing.",
    color: "from-amber-500 to-orange-500",
    bgColor: "bg-amber-50",
    badge: "New",
  },
  {
    icon: Headphones,
    title: "Live Interview Buddy",
    description:
      "Get real-time AI coaching during live interviews. Receive answer suggestions, talking points, and confidence boosters through your screen.",
    color: "from-rose-500 to-pink-500",
    bgColor: "bg-rose-50",
    badge: null,
  },
  {
    icon: Globe,
    title: "Resume Translator",
    description:
      "Expand your opportunities globally. Professionally translate your resume into 50+ languages while preserving formatting and impact.",
    color: "from-indigo-500 to-violet-500",
    bgColor: "bg-indigo-50",
    badge: null,
  },
  {
    icon: Brain,
    title: "Career Path AI",
    description:
      "Get personalized career recommendations based on your skills, experience, and goals. Discover roles you never knew you were perfect for.",
    color: "from-teal-500 to-cyan-500",
    bgColor: "bg-teal-50",
    badge: "Exclusive",
  },
  {
    icon: BarChart3,
    title: "Analytics Dashboard",
    description:
      "Track every application, interview, and response. Get insights on what's working and AI-powered suggestions to improve your success rate.",
    color: "from-purple-500 to-fuchsia-500",
    bgColor: "bg-purple-50",
    badge: null,
  },
  {
    icon: Shield,
    title: "Salary Negotiator",
    description:
      "AI-powered salary research and negotiation scripts. Know your worth and get coached through every step of the compensation discussion.",
    color: "from-sky-500 to-blue-500",
    bgColor: "bg-sky-50",
    badge: "New",
  },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

export function Features() {
  return (
    <section id="features" className="py-24 lg:py-32 relative">
      <div className="absolute inset-0 grid-pattern opacity-30 pointer-events-none" />
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center max-w-3xl mx-auto mb-16"
        >
          <Badge
            variant="outline"
            className="mb-4 px-4 py-1.5 border-violet-200 bg-violet-50 text-violet-700"
          >
            Everything You Need
          </Badge>
          <h2 className="text-4xl lg:text-5xl font-bold tracking-tight mb-4">
            Your Complete{" "}
            <span className="gradient-text">AI Career Toolkit</span>
          </h2>
          <p className="text-lg text-muted-foreground">
            Nine powerful AI tools working together to accelerate every stage of
            your job search — from discovery to offer.
          </p>
        </motion.div>

        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
        >
          {features.map((feature) => (
            <motion.div key={feature.title} variants={itemVariants}>
              <Card className="group h-full hover:shadow-xl hover:shadow-purple-500/5 hover:-translate-y-1 cursor-pointer border-gray-200/80">
                <CardContent className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div
                      className={`w-12 h-12 rounded-xl bg-gradient-to-br ${feature.color} flex items-center justify-center shadow-lg`}
                    >
                      <feature.icon className="w-6 h-6 text-white" />
                    </div>
                    {feature.badge && (
                      <Badge
                        variant="secondary"
                        className="text-[10px] font-semibold"
                      >
                        {feature.badge}
                      </Badge>
                    )}
                  </div>
                  <h3 className="text-lg font-semibold mb-2 group-hover:text-violet-600 transition-colors">
                    {feature.title}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                    {feature.description}
                  </p>
                  <div className="flex items-center text-sm font-medium text-violet-600 opacity-0 group-hover:opacity-100 transition-opacity">
                    Learn more
                    <ArrowRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
