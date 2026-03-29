"use client";

import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import {
  Upload,
  Sparkles,
  Rocket,
  Trophy,
} from "lucide-react";

const steps = [
  {
    step: "01",
    icon: Upload,
    title: "Upload Your Resume",
    description:
      "Drop in your existing resume or build one from scratch. Our AI instantly parses your experience, skills, and achievements.",
    color: "from-violet-500 to-purple-600",
    detail: "Supports PDF, DOCX, and LinkedIn import",
  },
  {
    step: "02",
    icon: Sparkles,
    title: "AI Optimizes Everything",
    description:
      "Our AI tailors your resume and cover letter for each role, optimizes for ATS systems, and identifies the best-match positions.",
    color: "from-blue-500 to-cyan-500",
    detail: "94% average ATS compatibility score",
  },
  {
    step: "03",
    icon: Rocket,
    title: "Auto-Apply at Scale",
    description:
      "Set your preferences and let AI apply to hundreds of matched positions daily. Each application is uniquely customized — never generic.",
    color: "from-emerald-500 to-green-500",
    detail: "Average 47 tailored applications per day",
  },
  {
    step: "04",
    icon: Trophy,
    title: "Interview & Get Hired",
    description:
      "Practice with AI coaching, get real-time interview support, and negotiate your best offer. We're with you until you sign.",
    color: "from-amber-500 to-orange-500",
    detail: "Users get hired 3x faster on average",
  },
];

export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="py-24 lg:py-32 bg-gray-50/50 relative"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center max-w-3xl mx-auto mb-20"
        >
          <Badge
            variant="outline"
            className="mb-4 px-4 py-1.5 border-violet-200 bg-violet-50 text-violet-700"
          >
            Simple Process
          </Badge>
          <h2 className="text-4xl lg:text-5xl font-bold tracking-tight mb-4">
            From Upload to{" "}
            <span className="gradient-text">Hired in 4 Steps</span>
          </h2>
          <p className="text-lg text-muted-foreground">
            Our streamlined process takes the pain out of job searching. Let AI
            handle the tedious work while you focus on what matters.
          </p>
        </motion.div>

        <div className="relative">
          {/* Connection line */}
          <div className="hidden lg:block absolute top-1/2 left-0 right-0 h-0.5 bg-gradient-to-r from-violet-200 via-blue-200 via-emerald-200 to-amber-200 -translate-y-1/2" />

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-6">
            {steps.map((step, index) => (
              <motion.div
                key={step.step}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.15 }}
                className="relative"
              >
                <div className="bg-white rounded-2xl border border-gray-200/80 p-6 shadow-sm hover:shadow-lg transition-all duration-300 hover:-translate-y-1 relative z-10">
                  {/* Step number */}
                  <div className="flex items-center justify-between mb-6">
                    <span className="text-5xl font-bold text-gray-100">
                      {step.step}
                    </span>
                    <div
                      className={`w-12 h-12 rounded-xl bg-gradient-to-br ${step.color} flex items-center justify-center shadow-lg`}
                    >
                      <step.icon className="w-6 h-6 text-white" />
                    </div>
                  </div>

                  <h3 className="text-lg font-semibold mb-2">{step.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                    {step.description}
                  </p>

                  {/* Detail chip */}
                  <div className="inline-flex items-center px-3 py-1.5 rounded-full bg-gray-50 text-xs font-medium text-gray-600 border">
                    {step.detail}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
