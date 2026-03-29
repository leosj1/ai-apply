import { SignIn } from "@clerk/nextjs";
import Link from "next/link";
import { Sparkles } from "lucide-react";

export default function SignInPage() {
  return (
    <div className="min-h-screen flex">
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <Link href="/" className="flex items-center gap-2 mb-8">
          <div className="w-8 h-8 rounded-lg gradient-bg flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <span className="text-lg font-bold">
            Apply<span className="gradient-text">AI</span> Pro
          </span>
        </Link>
        <SignIn
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
          afterSignInUrl="/onboarding"
          signUpUrl="/sign-up"
        />
      </div>

      <div className="hidden lg:flex flex-1 items-center justify-center bg-gradient-to-br from-violet-600 via-purple-600 to-indigo-700 p-12 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 left-20 w-72 h-72 bg-white rounded-full blur-3xl" />
          <div className="absolute bottom-20 right-20 w-96 h-96 bg-white rounded-full blur-3xl" />
        </div>
        <div className="relative text-white text-center max-w-md">
          <div className="w-20 h-20 rounded-2xl bg-white/10 backdrop-blur-sm flex items-center justify-center mx-auto mb-8 border border-white/20">
            <Sparkles className="w-10 h-10" />
          </div>
          <h2 className="text-3xl font-bold mb-4">Land your dream job 10x faster</h2>
          <p className="text-white/70 leading-relaxed mb-8">
            Our AI has helped 150,000+ professionals get hired at top companies including Google, Meta, Stripe, and more.
          </p>
          <div className="flex items-center justify-center gap-6 text-sm">
            <div className="text-center">
              <p className="text-2xl font-bold">150K+</p>
              <p className="text-white/60 text-xs">Users</p>
            </div>
            <div className="w-px h-10 bg-white/20" />
            <div className="text-center">
              <p className="text-2xl font-bold">2.4M</p>
              <p className="text-white/60 text-xs">Applications</p>
            </div>
            <div className="w-px h-10 bg-white/20" />
            <div className="text-center">
              <p className="text-2xl font-bold">94%</p>
              <p className="text-white/60 text-xs">ATS Score</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
