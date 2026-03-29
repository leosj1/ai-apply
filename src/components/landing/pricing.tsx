"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Check,
  Sparkles,
  Zap,
  Crown,
  ArrowRight,
} from "lucide-react";

const plans = [
  {
    name: "Starter",
    icon: Zap,
    description: "Perfect for getting started with AI-powered job search",
    monthlyPrice: 0,
    yearlyPrice: 0,
    badge: null,
    popular: false,
    buttonVariant: "outline" as const,
    buttonText: "Start Free",
    features: [
      "5 AI resume optimizations/month",
      "10 cover letters/month",
      "Basic job matching",
      "1 resume template",
      "Email support",
    ],
    limitations: [
      "No auto-apply",
      "No interview coaching",
      "No analytics",
    ],
  },
  {
    name: "Pro",
    icon: Sparkles,
    description: "For serious job seekers who want to land faster",
    monthlyPrice: 29,
    yearlyPrice: 19,
    badge: "Most Popular",
    popular: true,
    buttonVariant: "gradient" as const,
    buttonText: "Start Pro Trial",
    features: [
      "Unlimited resume optimizations",
      "Unlimited cover letters",
      "Smart auto-apply (50/day)",
      "AI interview coaching",
      "10 resume templates",
      "Analytics dashboard",
      "Resume translator (10 languages)",
      "Priority email support",
      "Salary insights",
    ],
    limitations: [],
  },
  {
    name: "Enterprise",
    icon: Crown,
    description: "Maximum power for career changers and executives",
    monthlyPrice: 79,
    yearlyPrice: 59,
    badge: "Best Value",
    popular: false,
    buttonVariant: "outline" as const,
    buttonText: "Start Enterprise Trial",
    features: [
      "Everything in Pro",
      "Unlimited auto-apply",
      "Live interview buddy",
      "AI salary negotiator",
      "Career path AI advisor",
      "All resume templates",
      "Resume translator (50+ languages)",
      "Dedicated success manager",
      "LinkedIn profile optimization",
      "Custom branding",
      "API access",
    ],
    limitations: [],
  },
];

export function Pricing() {
  const [annual, setAnnual] = useState(true);

  return (
    <section id="pricing" className="py-24 lg:py-32 bg-gray-50/50 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center max-w-3xl mx-auto mb-12"
        >
          <Badge
            variant="outline"
            className="mb-4 px-4 py-1.5 border-violet-200 bg-violet-50 text-violet-700"
          >
            Simple Pricing
          </Badge>
          <h2 className="text-4xl lg:text-5xl font-bold tracking-tight mb-4">
            Invest in Your{" "}
            <span className="gradient-text">Career Growth</span>
          </h2>
          <p className="text-lg text-muted-foreground mb-8">
            Choose the plan that fits your job search. All plans include a
            14-day free trial.
          </p>

          {/* Toggle */}
          <div className="inline-flex items-center gap-3 bg-white rounded-full border p-1.5 shadow-sm">
            <button
              onClick={() => setAnnual(false)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                !annual
                  ? "bg-violet-600 text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setAnnual(true)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-2 ${
                annual
                  ? "bg-violet-600 text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Annual
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                  annual
                    ? "bg-white/20 text-white"
                    : "bg-green-100 text-green-700"
                }`}
              >
                Save 35%
              </span>
            </button>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8 max-w-6xl mx-auto">
          {plans.map((plan, index) => (
            <motion.div
              key={plan.name}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
            >
              <Card
                className={`h-full relative ${
                  plan.popular
                    ? "border-violet-300 shadow-xl shadow-purple-500/10 scale-[1.02]"
                    : "border-gray-200/80 hover:shadow-lg"
                } transition-all duration-300`}
              >
                {plan.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge variant="gradient" className="shadow-lg">
                      {plan.badge}
                    </Badge>
                  </div>
                )}
                <CardContent className="p-6 lg:p-8">
                  <div className="flex items-center gap-3 mb-4">
                    <div
                      className={`w-10 h-10 rounded-xl ${
                        plan.popular
                          ? "gradient-bg"
                          : "bg-gray-100"
                      } flex items-center justify-center`}
                    >
                      <plan.icon
                        className={`w-5 h-5 ${
                          plan.popular ? "text-white" : "text-gray-600"
                        }`}
                      />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold">{plan.name}</h3>
                    </div>
                  </div>

                  <p className="text-sm text-muted-foreground mb-6">
                    {plan.description}
                  </p>

                  {/* Price */}
                  <div className="mb-6">
                    <div className="flex items-baseline gap-1">
                      <span className="text-4xl font-bold">
                        $
                        {annual ? plan.yearlyPrice : plan.monthlyPrice}
                      </span>
                      <span className="text-muted-foreground text-sm">
                        /month
                      </span>
                    </div>
                    {annual && plan.monthlyPrice > 0 && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Billed annually (${plan.yearlyPrice * 12}/year)
                      </p>
                    )}
                  </div>

                  <Button
                    variant={plan.buttonVariant}
                    className="w-full mb-6 group"
                    size="lg"
                  >
                    {plan.buttonText}
                    <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
                  </Button>

                  {/* Features */}
                  <div className="space-y-3">
                    {plan.features.map((feature) => (
                      <div
                        key={feature}
                        className="flex items-start gap-2.5 text-sm"
                      >
                        <Check className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                        <span>{feature}</span>
                      </div>
                    ))}
                    {plan.limitations.map((limitation) => (
                      <div
                        key={limitation}
                        className="flex items-start gap-2.5 text-sm text-muted-foreground"
                      >
                        <span className="w-4 h-4 flex items-center justify-center mt-0.5 shrink-0 text-gray-300">
                          —
                        </span>
                        <span>{limitation}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
