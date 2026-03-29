"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Inbox,
  Mail,
  MailPlus,
  RefreshCw,
  Send,
  CheckCircle2,
  AlertCircle,
  Calendar,
  Briefcase,
  Link2,
  ExternalLink,
  X,
  Loader2,
  Filter,
  Search,
  MailOpen,
  ArrowLeft,
  Reply,
  Unplug,
  Plug,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface EmailMsg {
  id: string;
  direction: "inbound" | "outbound";
  fromEmail: string;
  fromName: string | null;
  toEmail: string;
  toName: string | null;
  subject: string;
  bodyText: string | null;
  bodyHtml: string | null;
  category: string | null;
  proxyTag: string | null;
  isRead: boolean;
  hasAttachments: boolean;
  sentAt: string;
  threadId: string | null;
  jobApplication?: {
    id: string;
    company: string;
    role: string;
    status: string;
  } | null;
}

interface EmailStats {
  total: number;
  unread: number;
  linked: number;
}

const categoryColors: Record<string, { bg: string; text: string; label: string }> = {
  confirmation: { bg: "bg-green-100", text: "text-green-700", label: "Confirmation" },
  interview_invite: { bg: "bg-blue-100", text: "text-blue-700", label: "Interview" },
  rejection: { bg: "bg-red-100", text: "text-red-700", label: "Rejection" },
  follow_up: { bg: "bg-amber-100", text: "text-amber-700", label: "Follow-up" },
  offer: { bg: "bg-emerald-100", text: "text-emerald-700", label: "Offer" },
  general: { bg: "bg-gray-100", text: "text-gray-600", label: "General" },
};

export default function EmailHubPage() {
  const [emails, setEmails] = useState<EmailMsg[]>([]);
  const [stats, setStats] = useState<EmailStats>({ total: 0, unread: 0, linked: 0 });
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailEmail, setGmailEmail] = useState<string | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState<EmailMsg | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [searchText, setSearchText] = useState("");
  const [showCompose, setShowCompose] = useState(false);
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [replyTo, setReplyTo] = useState<EmailMsg | null>(null);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  // IMAP connection form
  const [showImapForm, setShowImapForm] = useState(false);
  const [imapEmail, setImapEmail] = useState("");
  const [imapPassword, setImapPassword] = useState("");
  const [imapHost, setImapHost] = useState("");
  const [imapPort, setImapPort] = useState("");
  const [isConnectingImap, setIsConnectingImap] = useState(false);
  const [imapError, setImapError] = useState<string | null>(null);

  const fetchEmails = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterCategory !== "all") params.set("category", filterCategory);
      const res = await fetch(`/api/email?${params.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      setEmails(data.emails || []);
      setStats(data.stats || { total: 0, unread: 0, linked: 0 });
      setGmailConnected(data.gmailConnected || false);
      setGmailEmail(data.gmailEmail || null);
      setProvider(data.provider || null);
      setLastSyncAt(data.lastSyncAt || null);
    } catch (err) {
      console.error("Failed to fetch emails:", err);
    }
  }, [filterCategory]);

  useEffect(() => {
    fetchEmails().finally(() => setIsLoading(false));
  }, [fetchEmails]);

  // Auto-sync every 5 minutes when connected
  useEffect(() => {
    if (!gmailConnected) return;
    // Initial background sync on load
    const initialSync = setTimeout(() => {
      fetch("/api/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      }).then(() => fetchEmails()).catch(() => {});
    }, 2000);
    // Periodic sync every 5 minutes
    const interval = setInterval(() => {
      fetch("/api/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      }).then(() => fetchEmails()).catch(() => {});
    }, 5 * 60 * 1000);
    return () => { clearTimeout(initialSync); clearInterval(interval); };
  }, [gmailConnected, fetchEmails]);

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch("/api/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      });
      if (res.ok) {
        await fetchEmails();
      }
    } catch { /* */ }
    setIsSyncing(false);
  };

  const handleMarkRead = async (emailId: string) => {
    try {
      await fetch("/api/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "markRead", emailId }),
      });
      setEmails((prev) => prev.map((e) => (e.id === emailId ? { ...e, isRead: true } : e)));
      if (selectedEmail?.id === emailId) setSelectedEmail((prev) => prev ? { ...prev, isRead: true } : null);
    } catch { /* */ }
  };

  const handleSend = async () => {
    if (!composeTo || !composeSubject || !composeBody) return;
    setIsSending(true);
    try {
      const payload: Record<string, string> = {
        action: "send",
        to: composeTo,
        subject: composeSubject,
        body: composeBody,
      };
      if (replyTo?.jobApplication?.id) {
        payload.jobApplicationId = replyTo.jobApplication.id;
      }
      const res = await fetch("/api/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setShowCompose(false);
        setComposeTo("");
        setComposeSubject("");
        setComposeBody("");
        setReplyTo(null);
        await fetchEmails();
      }
    } catch { /* */ }
    setIsSending(false);
  };

  const handleReply = (email: EmailMsg) => {
    setReplyTo(email);
    setComposeTo(email.direction === "inbound" ? email.fromEmail : email.toEmail);
    setComposeSubject(email.subject.startsWith("Re:") ? email.subject : `Re: ${email.subject}`);
    setComposeBody("");
    setShowCompose(true);
  };

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      await fetch("/api/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "disconnect" }),
      });
      setGmailConnected(false);
      setGmailEmail(null);
    } catch { /* */ }
    setIsDisconnecting(false);
  };

  const filteredEmails = emails.filter((e) => {
    if (searchText) {
      const q = searchText.toLowerCase();
      if (
        !e.subject.toLowerCase().includes(q) &&
        !e.fromEmail.toLowerCase().includes(q) &&
        !(e.fromName || "").toLowerCase().includes(q) &&
        !(e.jobApplication?.company || "").toLowerCase().includes(q) &&
        !(e.jobApplication?.role || "").toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  const formatDate = (d: string) => {
    const date = new Date(d);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    if (diff < 86400000) return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (diff < 604800000) return date.toLocaleDateString([], { weekday: "short" });
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-violet-500" />
      </div>
    );
  }

  // Handle IMAP connection
  const handleConnectImap = async () => {
    if (!imapEmail || !imapPassword) return;
    setIsConnectingImap(true);
    setImapError(null);
    try {
      const res = await fetch("/api/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "connectImap",
          email: imapEmail,
          password: imapPassword,
          host: imapHost || undefined,
          port: imapPort ? parseInt(imapPort, 10) : undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setGmailConnected(true);
        setGmailEmail(data.email);
        setProvider("imap");
        setShowImapForm(false);
      } else {
        setImapError(data.error || "Connection failed");
      }
    } catch {
      setImapError("Connection failed. Check your credentials.");
    }
    setIsConnectingImap(false);
  };

  // Not connected — show connect prompt with Gmail + IMAP options
  if (!gmailConnected) {
    return (
      <div className="max-w-xl mx-auto mt-12">
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-violet-100 to-purple-100 flex items-center justify-center">
            <Inbox className="w-8 h-8 text-violet-600" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Email Hub</h1>
          <p className="text-muted-foreground">
            Connect your email to see all job application emails in one place.
          </p>
        </div>

        <div className="space-y-3 text-left max-w-sm mx-auto mb-8">
          {[
            "Auto-link emails to your job applications",
            "Detect confirmations, interview invites, offers, rejections",
            "Reply to recruiters directly from the dashboard",
            "Auto-update job status based on email content",
          ].map((item, i) => (
            <div key={i} className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
              <span className="text-sm text-muted-foreground">{item}</span>
            </div>
          ))}
        </div>

        {!showImapForm ? (
          <div className="space-y-3 max-w-sm mx-auto">
            {/* Gmail OAuth */}
            <Button
              className="w-full gap-2 bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white"
              onClick={() => window.location.href = "/api/email/gmail/connect"}
            >
              <Mail className="w-4 h-4" /> Connect Gmail
            </Button>

            {/* Other providers via IMAP */}
            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={() => setShowImapForm(true)}
            >
              <Plug className="w-4 h-4" /> Connect Outlook, Yahoo, or Other
            </Button>

            <p className="text-[11px] text-muted-foreground text-center mt-4">
              We only read emails related to your job applications. Your data stays private.
            </p>
          </div>
        ) : (
          <div className="max-w-sm mx-auto bg-white rounded-xl border p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">Connect Email (IMAP)</h3>
              <button onClick={() => { setShowImapForm(false); setImapError(null); }} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Works with Outlook, Yahoo, iCloud, Zoho, and any IMAP-compatible provider. Use an app password (not your login password).
            </p>
            {imapError && (
              <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 rounded-lg p-2">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {imapError}
              </div>
            )}
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">Email Address</label>
                <input
                  type="email"
                  value={imapEmail}
                  onChange={(e) => setImapEmail(e.target.value)}
                  className="w-full h-9 px-3 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                  placeholder="you@outlook.com"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">App Password</label>
                <input
                  type="password"
                  value={imapPassword}
                  onChange={(e) => setImapPassword(e.target.value)}
                  className="w-full h-9 px-3 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                  placeholder="App-specific password"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Generate an app password in your email provider&apos;s security settings.
                </p>
              </div>
              <details className="text-xs">
                <summary className="text-muted-foreground cursor-pointer hover:text-foreground">Advanced (optional)</summary>
                <div className="mt-2 space-y-2">
                  <div>
                    <label className="text-xs text-muted-foreground">IMAP Host</label>
                    <input
                      type="text"
                      value={imapHost}
                      onChange={(e) => setImapHost(e.target.value)}
                      className="w-full h-8 px-3 rounded-lg border text-xs focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                      placeholder="Auto-detected from email domain"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Port</label>
                    <input
                      type="text"
                      value={imapPort}
                      onChange={(e) => setImapPort(e.target.value)}
                      className="w-full h-8 px-3 rounded-lg border text-xs focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                      placeholder="993 (default)"
                    />
                  </div>
                </div>
              </details>
            </div>
            <Button
              className="w-full gap-1.5 bg-violet-600 hover:bg-violet-700 text-white"
              onClick={handleConnectImap}
              disabled={isConnectingImap || !imapEmail || !imapPassword}
            >
              {isConnectingImap ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plug className="w-3.5 h-3.5" />}
              Connect
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <Inbox className="w-6 h-6 text-violet-600" /> Email Hub
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Connected via <span className="font-medium text-foreground">{provider === "imap" ? "IMAP" : "Gmail"}</span>: <span className="font-medium text-foreground">{gmailEmail}</span>
            {lastSyncAt && <> · Last synced {formatDate(lastSyncAt)}</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleSync} disabled={isSyncing}>
            {isSyncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Sync
          </Button>
          {provider === "gmail" && (
            <Button size="sm" className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white" onClick={() => { setReplyTo(null); setComposeTo(""); setComposeSubject(""); setComposeBody(""); setShowCompose(true); }}>
              <MailPlus className="w-3.5 h-3.5" /> Compose
            </Button>
          )}
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={handleDisconnect} disabled={isDisconnecting}>
            <Unplug className="w-3.5 h-3.5" /> Disconnect
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total Emails", value: stats.total, icon: Mail },
          { label: "Unread", value: stats.unread, icon: MailOpen },
          { label: "Linked to Jobs", value: stats.linked, icon: Link2 },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border p-3 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-violet-50 flex items-center justify-center">
              <s.icon className="w-4 h-4 text-violet-600" />
            </div>
            <div>
              <p className="text-lg font-bold">{s.value}</p>
              <p className="text-[11px] text-muted-foreground">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search emails..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="w-full h-8 pl-8 pr-3 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20"
          />
        </div>
        <div className="flex items-center gap-1">
          <Filter className="w-3.5 h-3.5 text-muted-foreground" />
          {["all", "confirmation", "interview_invite", "offer", "rejection", "follow_up"].map((cat) => (
            <button
              key={cat}
              onClick={() => setFilterCategory(cat)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                filterCategory === cat
                  ? "bg-violet-100 text-violet-700"
                  : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              }`}
            >
              {cat === "all" ? "All" : categoryColors[cat]?.label || cat}
            </button>
          ))}
        </div>
      </div>

      {/* Email list + detail */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 min-h-[500px]">
        {/* Email list */}
        <div className={`${selectedEmail ? "hidden lg:block" : ""} lg:col-span-2 bg-white rounded-xl border overflow-hidden`}>
          <div className="divide-y max-h-[600px] overflow-y-auto">
            {filteredEmails.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <Mail className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No emails found</p>
                <p className="text-xs mt-1">Click Sync to pull emails from Gmail</p>
              </div>
            ) : (
              filteredEmails.map((email) => (
                <button
                  key={email.id}
                  onClick={() => {
                    setSelectedEmail(email);
                    if (!email.isRead) handleMarkRead(email.id);
                  }}
                  className={`w-full text-left p-3 hover:bg-gray-50 transition-colors ${
                    selectedEmail?.id === email.id ? "bg-violet-50" : ""
                  } ${!email.isRead ? "bg-blue-50/50" : ""}`}
                >
                  <div className="flex items-start gap-2">
                    <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${!email.isRead ? "bg-blue-500" : "bg-transparent"}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className={`text-sm truncate ${!email.isRead ? "font-semibold" : "font-medium"}`}>
                          {email.direction === "inbound" ? (email.fromName || email.fromEmail) : `To: ${email.toName || email.toEmail}`}
                        </p>
                        <span className="text-[10px] text-muted-foreground shrink-0">{formatDate(email.sentAt)}</span>
                      </div>
                      <p className={`text-xs truncate mt-0.5 ${!email.isRead ? "text-foreground" : "text-muted-foreground"}`}>
                        {email.subject}
                      </p>
                      <div className="flex items-center gap-1.5 mt-1">
                        {email.category && email.category !== "general" && (
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${categoryColors[email.category]?.bg || "bg-gray-100"} ${categoryColors[email.category]?.text || "text-gray-600"}`}>
                            {categoryColors[email.category]?.label || email.category}
                          </span>
                        )}
                        {email.jobApplication && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-600 font-medium truncate max-w-[120px]">
                            {email.jobApplication.company}
                          </span>
                        )}
                        {email.direction === "outbound" && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">Sent</span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Email detail */}
        <div className={`${selectedEmail ? "" : "hidden lg:flex lg:items-center lg:justify-center"} lg:col-span-3 bg-white rounded-xl border overflow-hidden`}>
          {selectedEmail ? (
            <div className="flex flex-col h-full">
              {/* Detail header */}
              <div className="p-4 border-b">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <button onClick={() => setSelectedEmail(null)} className="lg:hidden flex items-center gap-1 text-xs text-muted-foreground mb-2 hover:text-foreground">
                      <ArrowLeft className="w-3 h-3" /> Back
                    </button>
                    <h2 className="text-base font-semibold">{selectedEmail.subject}</h2>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <p className="text-xs text-muted-foreground">
                        {selectedEmail.direction === "inbound" ? "From" : "To"}: <span className="font-medium text-foreground">{selectedEmail.direction === "inbound" ? (selectedEmail.fromName || selectedEmail.fromEmail) : (selectedEmail.toName || selectedEmail.toEmail)}</span>
                      </p>
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(selectedEmail.sentAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-2">
                      {selectedEmail.category && selectedEmail.category !== "general" && (
                        <Badge className={`text-[10px] ${categoryColors[selectedEmail.category]?.bg} ${categoryColors[selectedEmail.category]?.text} border-0`}>
                          {categoryColors[selectedEmail.category]?.label}
                        </Badge>
                      )}
                      {selectedEmail.jobApplication && (
                        <Badge variant="outline" className="text-[10px] gap-1">
                          <Briefcase className="w-2.5 h-2.5" />
                          {selectedEmail.jobApplication.role} at {selectedEmail.jobApplication.company}
                        </Badge>
                      )}
                      {selectedEmail.proxyTag && (
                        <Badge variant="outline" className="text-[10px] font-mono">
                          +{selectedEmail.proxyTag}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="sm" className="h-7 gap-1 text-[11px]" onClick={() => handleReply(selectedEmail)}>
                      <Reply className="w-3 h-3" /> Reply
                    </Button>
                    <button onClick={() => setSelectedEmail(null)} className="hidden lg:block p-1 rounded hover:bg-gray-100">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Email body */}
              <div className="flex-1 p-4 overflow-y-auto max-h-[500px]">
                {selectedEmail.bodyHtml ? (
                  <div
                    className="prose prose-sm max-w-none"
                    dangerouslySetInnerHTML={{ __html: selectedEmail.bodyHtml }}
                  />
                ) : (
                  <pre className="text-sm whitespace-pre-wrap font-sans text-muted-foreground">
                    {selectedEmail.bodyText || "No content"}
                  </pre>
                )}
              </div>

              {/* Linked job info */}
              {selectedEmail.jobApplication && (
                <div className="p-3 border-t bg-gray-50/50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Briefcase className="w-3.5 h-3.5 text-violet-600" />
                      <span className="text-xs font-medium">{selectedEmail.jobApplication.role} at {selectedEmail.jobApplication.company}</span>
                      <Badge variant="outline" className="text-[10px]">{selectedEmail.jobApplication.status}</Badge>
                    </div>
                    <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1" onClick={() => window.open(`/dashboard/auto-apply`, "_blank")}>
                      <ExternalLink className="w-2.5 h-2.5" /> View Job
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center text-muted-foreground p-8">
              <Mail className="w-10 h-10 mx-auto mb-3 opacity-20" />
              <p className="text-sm">Select an email to view</p>
            </div>
          )}
        </div>
      </div>

      {/* Compose Modal */}
      <AnimatePresence>
        {showCompose && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
            onClick={() => setShowCompose(false)}
          >
            <motion.div
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 100, opacity: 0 }}
              className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-4 border-b">
                <h3 className="font-semibold">{replyTo ? "Reply" : "New Email"}</h3>
                <button onClick={() => setShowCompose(false)} className="p-1 rounded hover:bg-gray-100">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-4 space-y-3">
                <div>
                  <label className="text-xs text-muted-foreground">To</label>
                  <input
                    type="email"
                    value={composeTo}
                    onChange={(e) => setComposeTo(e.target.value)}
                    className="w-full h-9 px-3 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                    placeholder="recruiter@company.com"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Subject</label>
                  <input
                    type="text"
                    value={composeSubject}
                    onChange={(e) => setComposeSubject(e.target.value)}
                    className="w-full h-9 px-3 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20"
                    placeholder="Subject"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Message</label>
                  <textarea
                    value={composeBody}
                    onChange={(e) => setComposeBody(e.target.value)}
                    rows={8}
                    className="w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 resize-none"
                    placeholder="Write your message..."
                  />
                </div>
                {replyTo?.jobApplication && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Link2 className="w-3 h-3" />
                    Linked to: {replyTo.jobApplication.role} at {replyTo.jobApplication.company}
                  </div>
                )}
              </div>
              <div className="flex items-center justify-end gap-2 p-4 border-t">
                <Button variant="outline" size="sm" onClick={() => setShowCompose(false)}>Cancel</Button>
                <Button size="sm" className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white" onClick={handleSend} disabled={isSending || !composeTo || !composeSubject || !composeBody}>
                  {isSending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  Send
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
