"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Settings, User, Bell, Shield, CreditCard, Sparkles, Check, Loader2, Mail, Plug, Unplug } from "lucide-react";

export default function SettingsPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSavingPrefs, setIsSavingPrefs] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [prefsSaved, setPrefsSaved] = useState(false);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [yearsExp, setYearsExp] = useState("");
  const [linkedIn, setLinkedIn] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");

  const [targetRoles, setTargetRoles] = useState("");
  const [preferredLocations, setPreferredLocations] = useState("");
  const [minSalary, setMinSalary] = useState("");
  const [companySizes, setCompanySizes] = useState("");
  const [skills, setSkills] = useState("");
  const [experienceLevel, setExperienceLevel] = useState("");
  const [employmentTypes, setEmploymentTypes] = useState<string[]>(["FULLTIME"]);
  // Immigration
  const [immigrationStatus, setImmigrationStatus] = useState("");
  const [needsSponsorship, setNeedsSponsorship] = useState(false);
  const [workAuthorization, setWorkAuthorization] = useState("");
  // Career pivot
  const [currentRole, setCurrentRole] = useState("");
  const [isPivoting, setIsPivoting] = useState(false);
  const [pivotFromRole, setPivotFromRole] = useState("");
  const [pivotToRole, setPivotToRole] = useState("");
  const [pivotTransferableSkills, setPivotTransferableSkills] = useState("");

  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailEmail, setGmailEmail] = useState<string | null>(null);
  const [isDisconnectingGmail, setIsDisconnectingGmail] = useState(false);

  const [notifications, setNotifications] = useState([
    { key: "jobMatches", label: "New job matches", desc: "Get notified when AI finds high-match roles", enabled: true },
    { key: "emailHighMatch", label: "Email alerts (90%+ matches)", desc: "Receive email when excellent job matches are found during background scans", enabled: true },
    { key: "appUpdates", label: "Application updates", desc: "Status changes on your applications", enabled: true },
    { key: "interviews", label: "Interview reminders", desc: "Reminders before scheduled interviews", enabled: true },
    { key: "weekly", label: "Weekly summary", desc: "Weekly report of your job search progress", enabled: false },
    { key: "product", label: "Product updates", desc: "New features and improvements", enabled: false },
  ]);

  useEffect(() => {
    async function loadSettings() {
      try {
        const res = await fetch("/api/user/settings");
        if (!res.ok) throw new Error();
        const data = await res.json();
        setFirstName(data.profile.firstName || "");
        setLastName(data.profile.lastName || "");
        setEmail(data.profile.email || "");
        setJobTitle(data.profile.jobTitle || "");
        setYearsExp(data.profile.yearsExp || "");
        setLinkedIn(data.profile.linkedIn || "");
        setPhone(data.profile.phone || "");
        setLocation(data.profile.location || "");
        setTargetRoles((data.preferences.targetRoles || []).join(", "));
        setPreferredLocations((data.preferences.preferredLocations || []).join(", "));
        setMinSalary(data.preferences.minSalary || "");
        setCompanySizes((data.preferences.companySizes || []).join(", "));
        setSkills((data.preferences.skills || []).join(", "));
        setExperienceLevel(data.preferences.experienceLevel || "");
        setEmploymentTypes(data.preferences.employmentTypes || ["FULLTIME"]);
        setImmigrationStatus(data.preferences.immigrationStatus || "");
        setNeedsSponsorship(data.preferences.needsSponsorship || false);
        setWorkAuthorization(data.preferences.workAuthorization || "");
        setCurrentRole(data.preferences.currentRole || "");
        setIsPivoting(data.preferences.isPivoting || false);
        setPivotFromRole(data.preferences.pivotFromRole || "");
        setPivotToRole(data.preferences.pivotToRole || "");
        setPivotTransferableSkills((data.preferences.pivotTransferableSkills || []).join(", "));
      } catch {
        // Use defaults on error
      } finally {
        setIsLoading(false);
      }
    }
    loadSettings();

    // Check Gmail connection
    fetch("/api/email")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (d) {
          setGmailConnected(d.gmailConnected || false);
          setGmailEmail(d.gmailEmail || null);
        }
      })
      .catch(() => {});

    // Check URL params for Gmail OAuth result
    const params = new URLSearchParams(window.location.search);
    const gmailStatus = params.get("gmail");
    if (gmailStatus === "connected") {
      setGmailConnected(true);
      // Clean URL
      window.history.replaceState({}, "", "/dashboard/settings");
    }
  }, []);

  const saveProfile = async () => {
    setIsSavingProfile(true);
    setProfileSaved(false);
    try {
      const res = await fetch("/api/user/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile: { firstName, lastName, email, jobTitle, yearsExp, linkedIn, phone, location },
        }),
      });
      if (res.ok) {
        setProfileSaved(true);
        setTimeout(() => setProfileSaved(false), 2000);
      }
    } catch {
      // handle error silently
    } finally {
      setIsSavingProfile(false);
    }
  };

  const savePreferences = async () => {
    setIsSavingPrefs(true);
    setPrefsSaved(false);
    try {
      const res = await fetch("/api/user/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile: { firstName, lastName, email },
          preferences: {
            targetRoles: targetRoles.split(",").map((s) => s.trim()).filter(Boolean),
            preferredLocations: preferredLocations.split(",").map((s) => s.trim()).filter(Boolean),
            companySizes: companySizes.split(",").map((s) => s.trim()).filter(Boolean),
            minSalary,
            skills: skills.split(",").map((s) => s.trim()).filter(Boolean),
            experienceLevel,
            employmentTypes,
            immigrationStatus,
            needsSponsorship,
            workAuthorization,
            currentRole,
            isPivoting,
            pivotFromRole,
            pivotToRole,
            pivotTransferableSkills: pivotTransferableSkills.split(",").map((s) => s.trim()).filter(Boolean),
          },
        }),
      });
      if (res.ok) {
        setPrefsSaved(true);
        setTimeout(() => setPrefsSaved(false), 2000);
      }
    } catch {
      // handle error silently
    } finally {
      setIsSavingPrefs(false);
    }
  };

  const toggleNotification = (key: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.key === key ? { ...n, enabled: !n.enabled } : n))
    );
  };

  const initials = `${firstName?.[0] || ""}${lastName?.[0] || ""}`.toUpperCase() || "?";

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm sm:text-base text-muted-foreground">Manage your account and preferences.</p>
      </div>

      {/* Profile */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <User className="w-5 h-5" /> Profile
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white text-xl font-bold">
              {initials}
            </div>
            <div>
              <p className="font-semibold">{firstName} {lastName}</p>
              <p className="text-sm text-muted-foreground">{email}</p>
              <Badge variant="gradient" className="mt-1 text-[10px]">
                <Sparkles className="w-2.5 h-2.5 mr-1" /> Pro Plan
              </Badge>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t">
            <div>
              <label className="text-sm font-medium mb-1.5 block">First Name</label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} disabled={isLoading} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Last Name</label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} disabled={isLoading} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Job Title</label>
              <Input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="e.g. Software Engineer" disabled={isLoading} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">LinkedIn</label>
              <Input value={linkedIn} onChange={(e) => setLinkedIn(e.target.value)} placeholder="https://linkedin.com/in/..." disabled={isLoading} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Phone</label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="5551234567" disabled={isLoading} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Location</label>
              <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Oakland, CA" disabled={isLoading} />
            </div>
          </div>
          <Button variant="gradient" size="sm" onClick={saveProfile} disabled={isSavingProfile}>
            {isSavingProfile ? (
              <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Saving...</>
            ) : profileSaved ? (
              <><Check className="w-3.5 h-3.5 mr-1.5" /> Saved!</>
            ) : (
              "Save Changes"
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Job Preferences */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Settings className="w-5 h-5" /> Job Preferences
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Target Roles</label>
              <Input value={targetRoles} onChange={(e) => setTargetRoles(e.target.value)} placeholder="Software Engineer, Full Stack Developer" disabled={isLoading} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Preferred Locations</label>
              <Input value={preferredLocations} onChange={(e) => setPreferredLocations(e.target.value)} placeholder="San Francisco, Remote" disabled={isLoading} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Minimum Salary</label>
              <Input value={minSalary} onChange={(e) => setMinSalary(e.target.value)} placeholder="$150,000" disabled={isLoading} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Company Sizes</label>
              <Input value={companySizes} onChange={(e) => setCompanySizes(e.target.value)} placeholder="Startup, Mid-size, Enterprise" disabled={isLoading} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Key Skills</label>
              <Input value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="React, TypeScript, Python, AWS" disabled={isLoading} />
              <p className="text-[10px] text-muted-foreground mt-1">Comma-separated. Used for job matching accuracy.</p>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Experience Level</label>
              <select value={experienceLevel} onChange={(e) => setExperienceLevel(e.target.value)} disabled={isLoading} className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm">
                <option value="">Select level...</option>
                <option value="intern">Intern</option>
                <option value="entry">Entry Level (0-2 years)</option>
                <option value="mid">Mid Level (3-5 years)</option>
                <option value="senior">Senior (6-10 years)</option>
                <option value="lead">Lead / Staff (10+ years)</option>
                <option value="principal">Principal / Architect</option>
                <option value="executive">Director / VP / Executive</option>
              </select>
            </div>
          </div>
          {/* Employment Types */}
          <div className="pt-3 border-t">
            <label className="text-sm font-medium mb-2 block">Employment Types</label>
            <div className="flex flex-wrap gap-2">
              {[
                { value: "FULLTIME", label: "Full-time" },
                { value: "PARTTIME", label: "Part-time" },
                { value: "CONTRACT", label: "Contract" },
                { value: "INTERN", label: "Internship" },
              ].map((t) => (
                <button
                  key={t.value}
                  onClick={() => setEmploymentTypes((prev) => prev.includes(t.value) ? prev.filter((v) => v !== t.value) : [...prev, t.value])}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${employmentTypes.includes(t.value) ? "bg-violet-100 text-violet-700 border-violet-300" : "bg-white text-muted-foreground border-gray-200 hover:bg-gray-50"}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <Button variant="gradient" size="sm" onClick={savePreferences} disabled={isSavingPrefs}>
            {isSavingPrefs ? (
              <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Saving...</>
            ) : prefsSaved ? (
              <><Check className="w-3.5 h-3.5 mr-1.5" /> Saved!</>
            ) : (
              "Save Preferences"
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Immigration & Work Authorization */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Shield className="w-5 h-5" /> Immigration & Work Authorization
          </CardTitle>
          <p className="text-xs text-muted-foreground">This helps us match you with jobs that align with your work authorization and avoid positions that won&apos;t sponsor.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Immigration Status</label>
              <select value={immigrationStatus} onChange={(e) => setImmigrationStatus(e.target.value)} disabled={isLoading} className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm">
                <option value="">Select status...</option>
                <option value="us_citizen">U.S. Citizen</option>
                <option value="green_card">Green Card Holder</option>
                <option value="h1b">H-1B Visa</option>
                <option value="opt">OPT (Optional Practical Training)</option>
                <option value="cpt">CPT (Curricular Practical Training)</option>
                <option value="ead">EAD (Employment Authorization Document)</option>
                <option value="tn_visa">TN Visa (NAFTA)</option>
                <option value="l1">L-1 Visa (Intracompany Transfer)</option>
                <option value="o1">O-1 Visa (Extraordinary Ability)</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Work Authorization</label>
              <select value={workAuthorization} onChange={(e) => setWorkAuthorization(e.target.value)} disabled={isLoading} className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm">
                <option value="">Select authorization...</option>
                <option value="authorized">Authorized to work (no sponsorship needed)</option>
                <option value="need_sponsorship">Need employer sponsorship</option>
                <option value="student_visa">Student visa (OPT/CPT)</option>
                <option value="pending_ead">Pending EAD</option>
              </select>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-50 border border-amber-200">
            <button
              onClick={() => setNeedsSponsorship(!needsSponsorship)}
              className={`w-10 h-6 rounded-full transition-colors relative shrink-0 ${needsSponsorship ? "bg-amber-500" : "bg-gray-200"}`}
            >
              <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${needsSponsorship ? "left-5" : "left-1"}`} />
            </button>
            <div>
              <p className="text-sm font-medium">I will need visa sponsorship</p>
              <p className="text-[10px] text-muted-foreground">When enabled, jobs from companies unlikely to sponsor will be scored lower.</p>
            </div>
          </div>
          <Button variant="gradient" size="sm" onClick={savePreferences} disabled={isSavingPrefs}>
            {isSavingPrefs ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Saving...</> : prefsSaved ? <><Check className="w-3.5 h-3.5 mr-1.5" /> Saved!</> : "Save"}
          </Button>
        </CardContent>
      </Card>

      {/* Career Pivot */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Sparkles className="w-5 h-5" /> Career Pivot
          </CardTitle>
          <p className="text-xs text-muted-foreground">Switching careers? We&apos;ll tailor your resume to highlight transferable skills and match you with transition-friendly roles.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-violet-50 border border-violet-200">
            <button
              onClick={() => setIsPivoting(!isPivoting)}
              className={`w-10 h-6 rounded-full transition-colors relative shrink-0 ${isPivoting ? "bg-violet-600" : "bg-gray-200"}`}
            >
              <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${isPivoting ? "left-5" : "left-1"}`} />
            </button>
            <div>
              <p className="text-sm font-medium">I&apos;m making a career change</p>
              <p className="text-[10px] text-muted-foreground">AI will evaluate transferable skills more generously and tailor your resume for the new role.</p>
            </div>
          </div>
          {isPivoting && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Current / Previous Role</label>
                <Input value={pivotFromRole} onChange={(e) => setPivotFromRole(e.target.value)} placeholder="e.g. HR Manager" disabled={isLoading} />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Target New Role</label>
                <Input value={pivotToRole} onChange={(e) => setPivotToRole(e.target.value)} placeholder="e.g. Scrum Master" disabled={isLoading} />
              </div>
              <div className="md:col-span-2">
                <label className="text-sm font-medium mb-1.5 block">Transferable Skills</label>
                <Input value={pivotTransferableSkills} onChange={(e) => setPivotTransferableSkills(e.target.value)} placeholder="Leadership, Project Management, Stakeholder Communication, Agile" disabled={isLoading} />
                <p className="text-[10px] text-muted-foreground mt-1">Comma-separated. Skills from your current role that apply to your target role.</p>
              </div>
            </div>
          )}
          <Button variant="gradient" size="sm" onClick={savePreferences} disabled={isSavingPrefs}>
            {isSavingPrefs ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Saving...</> : prefsSaved ? <><Check className="w-3.5 h-3.5 mr-1.5" /> Saved!</> : "Save"}
          </Button>
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Bell className="w-5 h-5" /> Notifications
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {notifications.map((notif) => (
              <div key={notif.key} className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm font-medium">{notif.label}</p>
                  <p className="text-xs text-muted-foreground">{notif.desc}</p>
                </div>
                <button
                  onClick={() => toggleNotification(notif.key)}
                  className={`w-10 h-6 rounded-full transition-colors relative ${
                    notif.enabled ? "bg-violet-600" : "bg-gray-200"
                  }`}
                >
                  <span
                    className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                      notif.enabled ? "left-5" : "left-1"
                    }`}
                  />
                </button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Email Integration */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Mail className="w-5 h-5" /> Email Integration
          </CardTitle>
        </CardHeader>
        <CardContent>
          {gmailConnected ? (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-green-50 border border-green-200">
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-green-800">Connected</p>
                  <Badge className="text-[10px] bg-green-100 text-green-700 border-green-200">Active</Badge>
                </div>
                <p className="text-sm text-green-700 mt-1">{gmailEmail}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Emails from job platforms are synced to your Email Hub.</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button variant="outline" size="sm" className="gap-1" onClick={() => window.location.href = "/dashboard/email"}>
                  <Mail className="w-3.5 h-3.5" /> Open Email Hub
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1 text-red-500 hover:text-red-600 hover:bg-red-50"
                  disabled={isDisconnectingGmail}
                  onClick={async () => {
                    setIsDisconnectingGmail(true);
                    try {
                      await fetch("/api/email", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "disconnect" }),
                      });
                      setGmailConnected(false);
                      setGmailEmail(null);
                    } catch { /* */ }
                    setIsDisconnectingGmail(false);
                  }}
                >
                  {isDisconnectingGmail ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unplug className="w-3.5 h-3.5" />}
                  Disconnect
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-gray-50 border">
              <div>
                <p className="font-semibold">Connect Your Email</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Link your email (Gmail, Outlook, Yahoo, etc.) to auto-sync job application emails, detect interview invites, and manage everything from the dashboard.
                </p>
              </div>
              <Button
                size="sm"
                className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white shrink-0"
                onClick={() => window.location.href = "/dashboard/email"}
              >
                <Plug className="w-3.5 h-3.5" /> Connect Email
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Billing */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <CreditCard className="w-5 h-5" /> Billing
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-gradient-to-r from-violet-50 to-purple-50 border border-violet-200">
            <div>
              <div className="flex items-center gap-2">
                <p className="font-semibold">Pro Plan</p>
                <Badge variant="gradient" className="text-[10px]">Active</Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-1">$29/month &middot; Renews Mar 13, 2026</p>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button variant="outline" size="sm">Change Plan</Button>
              <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-600 hover:bg-red-50">
                Cancel
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="border-red-200">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2 text-red-600">
            <Shield className="w-5 h-5" /> Danger Zone
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Delete Account</p>
              <p className="text-xs text-muted-foreground">
                Permanently delete your account and all associated data.
              </p>
            </div>
            <Button variant="destructive" size="sm" className="shrink-0 w-full sm:w-auto">Delete Account</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
