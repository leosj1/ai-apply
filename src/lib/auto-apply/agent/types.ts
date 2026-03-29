// AI Agent Types
// Shared type definitions for the adaptive auto-apply agent.
// Supports both Claude and OpenAI as the backing LLM.

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface AgentContext {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  linkedIn?: string;
  resumeText: string;
  coverLetterText: string;
  currentTitle?: string;
  yearsExp?: string;
  needsSponsorship?: boolean;
  location?: string;
  resumeFilePath?: string;
  // For verification code retrieval
  dbUserId?: string;
  clerkId?: string;
}

export interface AgentResult {
  success: boolean;
  platform: string;
  message: string;
  stepsCompleted: string[];
  screenshotSteps: { step: string; screenshot: string }[];
  confirmationDetected: boolean;
  confirmationText: string;
  iterationsUsed: number;
}

export interface PageState {
  url: string;
  title: string;
  screenshot: string; // base64
  simplifiedHtml: string;
  visibleText: string;
}

export type ToolResult = string | { result: string; newPage?: any };

// Generic AI client that works with both Claude and OpenAI
export interface AgentAIClient {
  provider: "claude" | "openai";
  client: any;
}
