"use client";

import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Star, Quote } from "lucide-react";

const testimonials = [
  {
    name: "Sarah Chen",
    role: "Software Engineer",
    company: "Google",
    avatar: "SC",
    rating: 5,
    text: "I went from mass-applying to 200+ jobs manually to getting 8 interviews in my first week with ApplyAI Pro. The AI-tailored resumes made all the difference — my response rate jumped from 2% to 34%.",
    highlight: "8 interviews in first week",
  },
  {
    name: "Marcus Johnson",
    role: "Product Manager",
    company: "Stripe",
    avatar: "MJ",
    rating: 5,
    text: "The interview coaching feature is incredible. It prepared me for questions I never would have anticipated. I felt so confident walking into my Stripe interview — and I got the offer!",
    highlight: "Landed dream job at Stripe",
  },
  {
    name: "Emily Rodriguez",
    role: "Data Scientist",
    company: "Netflix",
    avatar: "ER",
    rating: 5,
    text: "As a career changer, I was struggling to get noticed. ApplyAI Pro's resume builder highlighted my transferable skills perfectly. Within 3 weeks, I had multiple offers in data science.",
    highlight: "Career change in 3 weeks",
  },
  {
    name: "David Kim",
    role: "UX Designer",
    company: "Figma",
    avatar: "DK",
    rating: 5,
    text: "The auto-apply feature saved me literally hundreds of hours. It applied to 47 jobs a day, each with a customized application. I could focus on my portfolio while AI handled the rest.",
    highlight: "47 applications per day",
  },
  {
    name: "Priya Patel",
    role: "Marketing Director",
    company: "HubSpot",
    avatar: "PP",
    rating: 5,
    text: "The salary negotiation tool alone was worth the subscription. It helped me negotiate a $30K higher offer than what was initially proposed. Best investment in my career ever.",
    highlight: "$30K higher salary",
  },
  {
    name: "Alex Thompson",
    role: "DevOps Engineer",
    company: "Vercel",
    avatar: "AT",
    rating: 5,
    text: "I was skeptical about AI job tools, but ApplyAI Pro changed my mind. The resume translator helped me apply to international positions, and I landed a remote role at Vercel from Europe.",
    highlight: "International remote role",
  },
];

export function Testimonials() {
  return (
    <section id="testimonials" className="py-24 lg:py-32 relative">
      <div className="absolute inset-0 dot-pattern opacity-30 pointer-events-none" />
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
            Success Stories
          </Badge>
          <h2 className="text-4xl lg:text-5xl font-bold tracking-tight mb-4">
            Loved by{" "}
            <span className="gradient-text">150,000+ Job Seekers</span>
          </h2>
          <p className="text-lg text-muted-foreground">
            Real people, real results. See how ApplyAI Pro has transformed
            careers around the world.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {testimonials.map((testimonial, index) => (
            <motion.div
              key={testimonial.name}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
            >
              <Card className="h-full hover:shadow-lg transition-all duration-300 hover:-translate-y-1 border-gray-200/80">
                <CardContent className="p-6">
                  {/* Rating */}
                  <div className="flex items-center gap-0.5 mb-4">
                    {Array.from({ length: testimonial.rating }).map((_, i) => (
                      <Star
                        key={i}
                        className="w-4 h-4 fill-amber-400 text-amber-400"
                      />
                    ))}
                  </div>

                  {/* Quote */}
                  <div className="relative mb-6">
                    <Quote className="absolute -top-1 -left-1 w-6 h-6 text-violet-200" />
                    <p className="text-sm text-muted-foreground leading-relaxed pl-6">
                      {testimonial.text}
                    </p>
                  </div>

                  {/* Highlight */}
                  <div className="mb-4">
                    <Badge
                      variant="secondary"
                      className="bg-green-50 text-green-700 border-green-200 text-xs"
                    >
                      {testimonial.highlight}
                    </Badge>
                  </div>

                  {/* Author */}
                  <div className="flex items-center gap-3 pt-4 border-t">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white text-sm font-semibold">
                      {testimonial.avatar}
                    </div>
                    <div>
                      <p className="text-sm font-semibold">
                        {testimonial.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {testimonial.role} at {testimonial.company}
                      </p>
                    </div>
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
