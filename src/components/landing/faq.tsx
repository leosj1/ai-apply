"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { ChevronDown } from "lucide-react";

const faqs = [
  {
    question: "How does the auto-apply feature work?",
    answer:
      "Our AI scans thousands of job listings daily, matches them against your profile and preferences, then creates uniquely tailored applications for each position. Each resume and cover letter is customized — we never send generic applications. You set your preferences (role, salary, location, company size) and the AI handles the rest.",
  },
  {
    question: "Will employers know I used AI to apply?",
    answer:
      "No. Our AI generates human-quality, natural-sounding content that passes all AI detection tools. Each application is unique and tailored specifically to the job description and company. The content reads as if you personally wrote it, because the AI uses your real experience and achievements.",
  },
  {
    question: "How is this different from other job application tools?",
    answer:
      "ApplyAI Pro is the only platform that combines all aspects of the job search: resume optimization, cover letter generation, auto-applying, interview coaching, live interview support, salary negotiation, and career path planning. Other tools handle one piece — we handle everything from discovery to offer.",
  },
  {
    question: "What's the ATS compatibility rate?",
    answer:
      "Our resumes achieve an average ATS (Applicant Tracking System) compatibility score of 94%. We continuously test against all major ATS systems including Workday, Greenhouse, Lever, iCIMS, and Taleo to ensure your application gets through to human reviewers.",
  },
  {
    question: "Can I cancel anytime?",
    answer:
      "Absolutely. There are no contracts or commitments. You can cancel your subscription at any time from your dashboard, and you'll continue to have access until the end of your billing period. We also offer a 14-day free trial so you can try everything risk-free.",
  },
  {
    question: "How does the interview coaching work?",
    answer:
      "Our AI Interview Coach simulates real interviews with role-specific questions based on the actual job description. You practice via text or voice, and receive instant feedback on your answers including content quality, structure, and areas for improvement. The Live Interview Buddy provides real-time suggestions during actual interviews.",
  },
  {
    question: "Is my data secure?",
    answer:
      "Yes. We use bank-level encryption (AES-256) for all data at rest and in transit. We're SOC 2 Type II certified and GDPR compliant. We never sell your data to third parties, and you can request complete data deletion at any time. Your resume and personal information are only used to power your job search.",
  },
  {
    question: "Do you support international job searches?",
    answer:
      "Yes! Our Resume Translator supports 50+ languages, and our auto-apply feature works with job boards worldwide including LinkedIn, Indeed, Glassdoor, and region-specific platforms. Many of our users have successfully landed remote international positions.",
  },
];

export function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section className="py-24 lg:py-32 bg-gray-50/50 relative">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <Badge
            variant="outline"
            className="mb-4 px-4 py-1.5 border-violet-200 bg-violet-50 text-violet-700"
          >
            FAQ
          </Badge>
          <h2 className="text-4xl lg:text-5xl font-bold tracking-tight mb-4">
            Frequently Asked{" "}
            <span className="gradient-text">Questions</span>
          </h2>
          <p className="text-lg text-muted-foreground">
            Everything you need to know about ApplyAI Pro.
          </p>
        </motion.div>

        <div className="space-y-3">
          {faqs.map((faq, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.3, delay: index * 0.05 }}
            >
              <button
                onClick={() =>
                  setOpenIndex(openIndex === index ? null : index)
                }
                className="w-full text-left bg-white rounded-xl border border-gray-200/80 p-5 hover:shadow-md transition-all duration-200"
              >
                <div className="flex items-center justify-between gap-4">
                  <h3 className="text-sm font-semibold pr-4">
                    {faq.question}
                  </h3>
                  <ChevronDown
                    className={`w-5 h-5 text-muted-foreground shrink-0 transition-transform duration-200 ${
                      openIndex === index ? "rotate-180" : ""
                    }`}
                  />
                </div>
                <AnimatePresence>
                  {openIndex === index && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <p className="text-sm text-muted-foreground leading-relaxed mt-3 pt-3 border-t">
                        {faq.answer}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </button>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
