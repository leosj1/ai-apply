# ApplyAI Pro

> The most advanced AI-powered job application platform. Land your dream job 10x faster.

## Features

- **Smart Auto-Apply** — AI matches and applies to jobs automatically with tailored applications
- **AI Resume Builder** — Build ATS-optimized resumes with 94%+ compatibility scores
- **Cover Letter Generator** — Personalized, compelling cover letters in seconds
- **AI Interview Coach** — Practice behavioral, technical, system design & case study interviews
- **Live Interview Buddy** — Real-time AI coaching during live interviews
- **Resume Translator** — Professional translation in 50+ languages
- **Career Analytics** — Track applications, response rates, and job search performance
- **Salary Negotiator** — AI-powered salary negotiation strategies
- **Career Path AI** — Personalized career recommendations

## Tech Stack

- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS + Radix UI
- **Animations:** Framer Motion
- **Icons:** Lucide React
- **Forms:** React Hook Form + Zod
- **Charts:** Recharts

## Getting Started

### Prerequisites

- Node.js >= 18.17.0 (use `nvm use 22` if using nvm)
- npm or yarn

### Installation

```bash
# Clone the repository
git clone <repo-url>
cd windsurf-project

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env.local

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app.

### Environment Variables

Copy `.env.example` to `.env.local` and fill in your keys:

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key for AI features |
| `DATABASE_URL` | PostgreSQL connection string |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk auth public key |
| `CLERK_SECRET_KEY` | Clerk auth secret key |
| `STRIPE_SECRET_KEY` | Stripe payments secret key |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe public key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook secret |
| `RESEND_API_KEY` | Resend email API key |
| `NEXT_PUBLIC_APP_URL` | App URL (default: http://localhost:3000) |

## Project Structure

```
src/
├── app/
│   ├── (auth)/
│   │   ├── sign-in/        # Sign in page
│   │   ├── sign-up/        # Sign up page
│   │   └── onboarding/     # Onboarding flow
│   ├── api/ai/
│   │   ├── resume/         # Resume optimization API
│   │   ├── cover-letter/   # Cover letter generation API
│   │   ├── interview/      # Interview feedback API
│   │   └── auto-apply/     # Auto-apply matching API
│   ├── dashboard/
│   │   ├── auto-apply/     # Smart auto-apply
│   │   ├── resume/         # Resume builder
│   │   ├── cover-letter/   # Cover letter generator
│   │   ├── interview/      # Interview coach
│   │   ├── buddy/          # Live interview buddy
│   │   ├── translator/     # Resume translator
│   │   ├── analytics/      # Job search analytics
│   │   └── settings/       # Account settings
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx            # Landing page
├── components/
│   ├── landing/
│   │   ├── navbar.tsx
│   │   ├── hero.tsx
│   │   ├── features.tsx
│   │   ├── how-it-works.tsx
│   │   ├── testimonials.tsx
│   │   ├── pricing.tsx
│   │   ├── faq.tsx
│   │   ├── cta.tsx
│   │   └── footer.tsx
│   └── ui/
│       ├── button.tsx
│       ├── badge.tsx
│       ├── card.tsx
│       └── input.tsx
└── lib/
    └── utils.ts
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |

## Pages

| Route | Description |
|-------|-------------|
| `/` | Landing page with hero, features, pricing, FAQ |
| `/sign-in` | Sign in with email/Google/GitHub |
| `/sign-up` | Create account with free trial |
| `/onboarding` | 4-step onboarding flow |
| `/dashboard` | Main dashboard with stats & activity |
| `/dashboard/auto-apply` | Smart auto-apply with job matching |
| `/dashboard/resume` | Resume builder & AI optimizer |
| `/dashboard/cover-letter` | AI cover letter generator |
| `/dashboard/interview` | AI interview coach |
| `/dashboard/buddy` | Live interview companion |
| `/dashboard/translator` | Resume translator (50+ languages) |
| `/dashboard/analytics` | Job search analytics & insights |
| `/dashboard/settings` | Account, preferences, billing |

## License

Private — All rights reserved.
