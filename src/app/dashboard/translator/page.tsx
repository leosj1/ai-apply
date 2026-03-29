"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Globe, ArrowRight, Download, Sparkles, CheckCircle2 } from "lucide-react";

const languages = [
  { code: "es", name: "Spanish", flag: "🇪🇸" },
  { code: "fr", name: "French", flag: "🇫🇷" },
  { code: "de", name: "German", flag: "🇩🇪" },
  { code: "pt", name: "Portuguese", flag: "🇧🇷" },
  { code: "zh", name: "Chinese", flag: "🇨🇳" },
  { code: "ja", name: "Japanese", flag: "🇯🇵" },
  { code: "ko", name: "Korean", flag: "🇰🇷" },
  { code: "ar", name: "Arabic", flag: "🇸🇦" },
  { code: "hi", name: "Hindi", flag: "🇮🇳" },
  { code: "it", name: "Italian", flag: "🇮🇹" },
  { code: "nl", name: "Dutch", flag: "🇳🇱" },
  { code: "ru", name: "Russian", flag: "🇷🇺" },
  { code: "sv", name: "Swedish", flag: "🇸🇪" },
  { code: "pl", name: "Polish", flag: "🇵🇱" },
  { code: "tr", name: "Turkish", flag: "🇹🇷" },
];

export default function TranslatorPage() {
  const [selectedLang, setSelectedLang] = useState("es");
  const [isTranslating, setIsTranslating] = useState(false);
  const [translated, setTranslated] = useState(false);

  const handleTranslate = async () => {
    setIsTranslating(true);
    await new Promise((r) => setTimeout(r, 2000));
    setTranslated(true);
    setIsTranslating(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Resume Translator</h1>
        <p className="text-sm sm:text-base text-muted-foreground">
          Professionally translate your resume into 50+ languages while preserving formatting.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Select Language</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1.5 max-h-[500px] overflow-y-auto pr-1">
                {languages.map((lang) => (
                  <button
                    key={lang.code}
                    onClick={() => { setSelectedLang(lang.code); setTranslated(false); }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all ${
                      selectedLang === lang.code
                        ? "bg-violet-50 border border-violet-200 text-violet-700 font-medium"
                        : "hover:bg-gray-50 text-muted-foreground"
                    }`}
                  >
                    <span className="text-lg">{lang.flag}</span>
                    <span>{lang.name}</span>
                    {selectedLang === lang.code && (
                      <CheckCircle2 className="w-4 h-4 text-violet-600 ml-auto" />
                    )}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <CardTitle className="text-lg">Translation Preview</CardTitle>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>English</span>
                  <ArrowRight className="w-4 h-4" />
                  <span className="font-medium text-foreground">
                    {languages.find((l) => l.code === selectedLang)?.flag}{" "}
                    {languages.find((l) => l.code === selectedLang)?.name}
                  </span>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {translated ? (
                <div className="space-y-4">
                  <div className="p-6 rounded-xl border bg-gray-50 min-h-[400px]">
                    <div className="space-y-4">
                      <div>
                        <h3 className="text-lg font-bold">Sarah Chen</h3>
                        <p className="text-sm text-muted-foreground">Ingeniera de Software Senior</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          san.francisco@email.com | +1 (555) 123-4567 | linkedin.com/in/sarahchen
                        </p>
                      </div>
                      <hr />
                      <div>
                        <h4 className="text-sm font-semibold mb-2">Resumen Profesional</h4>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                          Ingeniera de software con más de 6 años de experiencia en el desarrollo de aplicaciones
                          web escalables y liderazgo de equipos de ingeniería multifuncionales. Especializada en
                          React, TypeScript y arquitecturas de microservicios.
                        </p>
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold mb-2">Experiencia Laboral</h4>
                        <div className="space-y-3">
                          <div>
                            <p className="text-sm font-medium">Ingeniera de Software Senior — TechCorp</p>
                            <p className="text-xs text-muted-foreground">Enero 2021 - Presente</p>
                            <ul className="text-xs text-muted-foreground mt-1 space-y-1 list-disc pl-4">
                              <li>Lideró la migración de una aplicación monolítica a microservicios</li>
                              <li>Mentoró a un equipo de 8 ingenieros</li>
                              <li>Diseñó un pipeline de datos en tiempo real</li>
                            </ul>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <Button variant="gradient" className="gap-2 flex-1">
                      <Download className="w-4 h-4" /> Download PDF
                    </Button>
                    <Button variant="outline" className="gap-2 flex-1">
                      <Download className="w-4 h-4" /> Download DOCX
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center min-h-[400px] text-center">
                  <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
                    <Globe className="w-8 h-8 text-gray-400" />
                  </div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">
                    Select a language and translate your resume
                  </p>
                  <p className="text-xs text-muted-foreground mb-6 max-w-sm">
                    Our AI preserves your resume formatting, tone, and impact while
                    providing culturally appropriate translations.
                  </p>
                  <Button
                    variant="gradient"
                    className="gap-2"
                    onClick={handleTranslate}
                    disabled={isTranslating}
                  >
                    {isTranslating ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Translating...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        Translate to {languages.find((l) => l.code === selectedLang)?.name}
                      </>
                    )}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
