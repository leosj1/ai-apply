import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { Providers } from "@/components/providers";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "ApplyAI Pro — Land Your Dream Job Faster with AI",
  description:
    "The most advanced AI-powered job application platform. Auto-apply to hundreds of jobs, build ATS-optimized resumes, generate tailored cover letters, and ace interviews with AI coaching.",
  keywords: [
    "AI job application",
    "resume builder",
    "cover letter generator",
    "auto apply jobs",
    "interview coaching",
    "career AI",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en" className="scroll-smooth">
        <body className={`${inter.variable} font-sans`}>
          <Providers>{children}</Providers>
        </body>
      </html>
    </ClerkProvider>
  );
}
