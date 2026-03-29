import { Sparkles } from "lucide-react";
import Link from "next/link";

const footerLinks = {
  Tools: [
    { label: "Auto Apply", href: "#" },
    { label: "Resume Builder", href: "#" },
    { label: "Cover Letter Generator", href: "#" },
    { label: "Interview Coach", href: "#" },
    { label: "Interview Buddy", href: "#" },
    { label: "Resume Translator", href: "#" },
    { label: "Salary Negotiator", href: "#" },
  ],
  Resources: [
    { label: "Blog", href: "#" },
    { label: "Resume Examples", href: "#" },
    { label: "Cover Letter Examples", href: "#" },
    { label: "Interview Questions", href: "#" },
    { label: "Career Guides", href: "#" },
    { label: "Salary Data", href: "#" },
  ],
  Company: [
    { label: "About Us", href: "#" },
    { label: "Careers", href: "#" },
    { label: "Press", href: "#" },
    { label: "Partners", href: "#" },
    { label: "Contact", href: "#" },
  ],
  Legal: [
    { label: "Privacy Policy", href: "#" },
    { label: "Terms of Service", href: "#" },
    { label: "Cookie Policy", href: "#" },
    { label: "GDPR", href: "#" },
  ],
};

export function Footer() {
  return (
    <footer className="border-t bg-gray-50/50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8 lg:gap-12">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg gradient-bg flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <span className="text-lg font-bold">
                Apply<span className="gradient-text">AI</span>
              </span>
            </Link>
            <p className="text-sm text-muted-foreground leading-relaxed">
              The most advanced AI-powered job application platform. Land your
              dream job faster.
            </p>
          </div>

          {/* Links */}
          {Object.entries(footerLinks).map(([category, links]) => (
            <div key={category}>
              <h4 className="text-sm font-semibold mb-4">{category}</h4>
              <ul className="space-y-2.5">
                {links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="border-t mt-12 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} ApplyAI Pro. All rights reserved.
          </p>
          <div className="flex items-center gap-6">
            {["Twitter", "LinkedIn", "GitHub", "Discord"].map((social) => (
              <Link
                key={social}
                href="#"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {social}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
