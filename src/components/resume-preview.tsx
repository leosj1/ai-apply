"use client";

import { FileText, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { jsPDF } from "jspdf";

interface ResumePreviewProps {
  content: string;
  title?: string;
  fileName?: string;
  onDownload?: () => void;
}

// Parse resume text into structured sections for PDF-like rendering
function parseResumeSections(text: string): { name: string; lines: string[] }[] {
  const lines = text.split("\n");
  const sections: { name: string; lines: string[] }[] = [];
  let currentSection: { name: string; lines: string[] } = { name: "Header", lines: [] };

  // Common resume section headers
  const sectionHeaders = /^(summary|objective|experience|work experience|professional experience|education|skills|technical skills|key skills|certifications|projects|awards|achievements|publications|volunteer|interests|references|contact|profile|professional summary|core competencies|qualifications|additional)/i;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      // Blank line — might be section separator
      if (currentSection.lines.length > 0) {
        currentSection.lines.push("");
      }
      continue;
    }

    // Detect section headers: ALL CAPS lines, lines matching known headers, or lines ending with ":"
    const isHeader = sectionHeaders.test(trimmed) ||
      (trimmed === trimmed.toUpperCase() && trimmed.length > 3 && trimmed.length < 60 && !/^\d/.test(trimmed)) ||
      (trimmed.endsWith(":") && trimmed.length < 40 && !trimmed.includes(","));

    if (isHeader) {
      if (currentSection.lines.length > 0 || currentSection.name !== "Header") {
        sections.push(currentSection);
      }
      currentSection = { name: trimmed.replace(/:$/, ""), lines: [] };
    } else {
      currentSection.lines.push(trimmed);
    }
  }
  if (currentSection.lines.length > 0) {
    sections.push(currentSection);
  }

  return sections;
}

function generateResumePdf(sections: { name: string; lines: string[] }[], fileName: string) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 54; // ~0.75 inch
  const maxWidth = pageWidth - margin * 2;
  let y = margin;

  const checkPage = (needed: number) => {
    if (y + needed > doc.internal.pageSize.getHeight() - margin) {
      doc.addPage();
      y = margin;
    }
  };

  for (const section of sections) {
    if (section.name === "Header") {
      // Name — large centered
      if (section.lines[0]) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(18);
        doc.text(section.lines[0], pageWidth / 2, y, { align: "center" });
        y += 22;
      }
      // Contact info — small centered
      for (let i = 1; i < Math.min(section.lines.length, 4); i++) {
        if (!section.lines[i]) continue;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.text(section.lines[i], pageWidth / 2, y, { align: "center" });
        y += 12;
      }
      y += 8;
      continue;
    }

    // Section header
    checkPage(30);
    y += 6;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(section.name.toUpperCase(), margin, y);
    y += 3;
    doc.setDrawColor(100, 100, 100);
    doc.setLineWidth(0.5);
    doc.line(margin, y, pageWidth - margin, y);
    y += 10;

    // Section content
    doc.setFont("times", "normal");
    doc.setFontSize(10);
    for (const line of section.lines) {
      if (!line) { y += 4; continue; }

      const isBullet = /^[•\-*–]/.test(line);
      const cleanLine = isBullet ? line.replace(/^[•\-*–]\s*/, "") : line;
      const xOffset = isBullet ? margin + 12 : margin;

      // Bold-like lines (job titles)
      const isBoldLine = line.length < 80 && !line.endsWith(".") && (line.includes("|") || line.includes("—") || line.includes(" at "));
      if (isBoldLine) {
        doc.setFont("times", "bold");
        y += 4;
      } else {
        doc.setFont("times", "normal");
      }

      const wrapped = doc.splitTextToSize(cleanLine, isBullet ? maxWidth - 12 : maxWidth);
      checkPage(wrapped.length * 12 + 2);

      if (isBullet) {
        doc.setFont("times", "normal");
        doc.text("\u2022", margin + 2, y);
      }

      doc.text(wrapped, xOffset, y);
      y += wrapped.length * 12;
    }
  }

  doc.save(fileName);
}

export function ResumePreview({ content, title = "Resume", fileName = "resume.pdf", onDownload }: ResumePreviewProps) {
  const sections = parseResumeSections(content);

  const handleDownload = () => {
    generateResumePdf(sections, fileName);
    onDownload?.();
  };

  return (
    <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b">
        <div className="flex items-center gap-2 text-xs font-medium text-gray-600">
          <FileText className="w-3.5 h-3.5" />
          {title}
        </div>
        <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1" onClick={handleDownload}>
          <Download className="w-3 h-3" /> PDF
        </Button>
      </div>

      {/* PDF-like page */}
      <div className="p-6 sm:p-8 max-h-[70vh] overflow-y-auto" style={{ fontFamily: "'Georgia', 'Times New Roman', serif" }}>
        {sections.map((section, i) => (
          <div key={i} className={i > 0 ? "mt-4" : ""}>
            {/* Section header */}
            {section.name !== "Header" ? (
              <div className="mb-2">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-800 border-b border-gray-300 pb-1">
                  {section.name}
                </h3>
              </div>
            ) : null}

            {/* Section content */}
            <div className="space-y-0.5">
              {section.lines.map((line, j) => {
                if (!line) return <div key={j} className="h-2" />;

                // First section (Header) — render name large, rest as contact info
                if (section.name === "Header") {
                  if (j === 0) {
                    return (
                      <h1 key={j} className="text-lg font-bold text-gray-900 text-center">
                        {line}
                      </h1>
                    );
                  }
                  if (j <= 2) {
                    return (
                      <p key={j} className="text-[10px] text-gray-500 text-center">
                        {line}
                      </p>
                    );
                  }
                }

                // Bullet points
                if (line.startsWith("•") || line.startsWith("-") || line.startsWith("*") || line.startsWith("–")) {
                  return (
                    <p key={j} className="text-[10.5px] text-gray-700 leading-relaxed pl-3 relative">
                      <span className="absolute left-0 text-gray-400">•</span>
                      {line.replace(/^[•\-*–]\s*/, "")}
                    </p>
                  );
                }

                // Bold-like lines (job titles, company names) — lines that are short and don't end with period
                if (line.length < 80 && !line.endsWith(".") && !line.endsWith(",") && (line.includes("|") || line.includes("—") || line.includes(" at "))) {
                  return (
                    <p key={j} className="text-[10.5px] font-semibold text-gray-800 mt-2">
                      {line}
                    </p>
                  );
                }

                // Date ranges on their own line
                if (/^\w+\s+\d{4}\s*[-–]\s*(present|\w+\s+\d{4})/i.test(line)) {
                  return (
                    <p key={j} className="text-[9.5px] text-gray-500 italic">
                      {line}
                    </p>
                  );
                }

                return (
                  <p key={j} className="text-[10.5px] text-gray-700 leading-relaxed">
                    {line}
                  </p>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
