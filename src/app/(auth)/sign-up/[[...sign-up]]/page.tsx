import { SignUp } from "@clerk/nextjs";
import Link from "next/link";
import { Sparkles, CheckCircle2 } from "lucide-react";

const benefits = [
  "Auto-apply to 100+ jobs per day",
  "AI-optimized resumes with 94% ATS score",
  "Personalized cover letters in seconds",
  "AI interview coaching with instant feedback",
  "Real-time interview companion",
  "Resume translation in 50+ languages",
];

export default function SignUpPage() {
  return (
    <div className="min-h-screen flex">
      <div className="hidden lg:flex flex-1 items-center justify-center bg-gradient-to-br from-violet-600 via-purple-600 to-indigo-700 p-12 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 right-20 w-72 h-72 bg-white rounded-full blur-3xl" />
          <div className="absolute bottom-20 left-20 w-96 h-96 bg-white rounded-full blur-3xl" />
        </div>
        <div className="relative text-white max-w-md">
          <h2 className="text-3xl font-bold mb-4">Start your 14-day free trial</h2>
          <p className="text-white/70 leading-relaxed mb-8">
            No credit card required. Get full access to all features and see why 150,000+ professionals trust ApplyAI Pro.
          </p>
          <div className="space-y-3">
            {benefits.map((benefit) => (
              <div key={benefit} className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-green-300 shrink-0" />
                <span className="text-sm text-white/90">{benefit}</span>
              </div>
            ))}
          </div>
          <div className="mt-10 p-4 rounded-xl bg-white/10 backdrop-blur-sm border border-white/20">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold">JD</div>
              <div>
                <p className="text-sm font-medium">James Davidson</p>
                <p className="text-xs text-white/60">Hired at Google</p>
              </div>
            </div>
            <p className="text-sm text-white/80 italic">
              &quot;ApplyAI Pro helped me land my dream job at Google in just 3 weeks. The auto-apply feature alone saved me 40+ hours.&quot;
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <Link href="/" className="flex items-center gap-2 mb-8">
          <div className="w-8 h-8 rounded-lg gradient-bg flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <span className="text-lg font-bold">
            Apply<span className="gradient-text">AI</span> Pro
          </span>
        </Link>
        <SignUp
          appearance={{
            elements: {
              rootBox: "mx-auto",
              card: "shadow-none border rounded-2xl",
              headerTitle: "text-xl font-bold",
              headerSubtitle: "text-muted-foreground",
              socialButtonsBlockButton:
                "border rounded-xl h-11 font-medium hover:bg-gray-50",
              formFieldInput:
                "rounded-xl h-11 border-gray-200 focus:border-violet-500 focus:ring-violet-500/20",
              formButtonPrimary:
                "bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 rounded-xl h-11 text-sm font-medium",
              footerActionLink:
                "text-violet-600 hover:text-violet-700 font-medium",
            },
          }}
          afterSignUpUrl="/onboarding"
          signInUrl="/sign-in"
        />
      </div>
    </div>
  );
}
