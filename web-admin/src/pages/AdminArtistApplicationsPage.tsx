import { useEffect, useMemo, useState } from "react";
import { http, toApiFailure } from "../services/http";
import PageWrapper from "../components/PageWrapper";
import {
  Users,
  UserPlus,
  Clock,
  Mail,
  User,
  FileText,
  Link2,
  CheckCircle,
  XCircle,
  RefreshCw,
  AlertCircle,
  ExternalLink,
  ChevronRight,
  MessageSquare,
  Calendar,
  Shield,
  Award,
  Zap,
  ChevronDown,
  Search,
  Filter,
  Star,
  Crown
} from "lucide-react";

type PendingItem = {
  id: number;
  name: string | null;
  email: string;
  submittedAt: string | null;
  artistStatus?: string;
  artistBio: string;
  portfolioLinks: string[];
  appealMessage?: string | null;
  appealed?: boolean;
  adminNote?: string | null;
};

type PendingArtistsResponse = {
  success: boolean;
  items?: PendingItem[];
  message?: string;
};

function safeExternalUrl(raw: string): string | null {
  try {
    const parsed = new URL(String(raw || "").trim());
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export default function AdminArtistApplicationsPage() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<PendingItem[]>([]);
  const [apiError, setApiError] = useState<string | null>(null);

  const [active, setActive] = useState<PendingItem | null>(null);
  const [resolveBusy, setResolveBusy] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const load = async () => {
    setLoading(true);
    setApiError(null);
    try {
      const res = await http.get<PendingArtistsResponse>("/api/v1/admin/pending-artists");
      const next = Array.isArray(res.data?.items) ? (res.data.items as PendingItem[]) : [];
      setItems(next);
      setActive(next[0] ?? null);
    } catch (error) {
      const failure = toApiFailure(error);
      setApiError(failure.message || "Failed to load pending applications");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const resolve = async (action: "APPROVE" | "REJECT") => {
    if (!active || resolveBusy) return;

    if (action === "REJECT" && !rejectReason.trim()) {
      setApiError("Rejection reason is required.");
      return;
    }

    setResolveBusy(true);
    setApiError(null);

    try {
      const res = await http.patch(`/api/v1/admin/resolve-artist/${active.id}`, {
        action,
        reason: action === "REJECT" ? rejectReason.trim() : undefined
      });

      if (!res.data?.success) {
        setApiError(res.data?.message || "Failed to resolve application");
        return;
      }

      setRejectReason("");
      await load();
    } catch (error) {
      const failure = toApiFailure(error);
      setApiError(failure.message || "Failed to resolve application");
    } finally {
      setResolveBusy(false);
    }
  };

  return (
    <PageWrapper 
      title="Artist Applications" 
      subtitle="Review, approve, or reject pending artist applications"
    >
      {/* Stats Cards Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="group relative overflow-hidden rounded-2xl border border-white/5 bg-surface p-5 hover:border-white/10 transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="relative">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[#8D7B77]">Total Applications</p>
                <p className="mt-1.5 text-3xl font-bold text-white">{items.length}</p>
              </div>
              <div className="p-3 rounded-xl bg-primary/10">
                <Users size={20} className="text-primary" />
              </div>
            </div>
          </div>
        </div>

        <div className="group relative overflow-hidden rounded-2xl border border-white/5 bg-surface p-5 hover:border-white/10 transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-yellow-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="relative">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[#8D7B77]">Pending Review</p>
                <p className="mt-1.5 text-3xl font-bold text-yellow-400">{items.filter(i => i.artistStatus !== "APPROVED").length}</p>
              </div>
              <div className="p-3 rounded-xl bg-yellow-500/10">
                <Clock size={20} className="text-yellow-400" />
              </div>
            </div>
          </div>
        </div>

        <div className="group relative overflow-hidden rounded-2xl border border-white/5 bg-surface p-5 hover:border-white/10 transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-green-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="relative">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[#8D7B77]">Approved</p>
                <p className="mt-1.5 text-3xl font-bold text-green-400">{items.filter(i => i.artistStatus === "APPROVED").length}</p>
              </div>
              <div className="p-3 rounded-xl bg-green-500/10">
                <CheckCircle size={20} className="text-green-400" />
              </div>
            </div>
          </div>
        </div>

        <div className="group relative overflow-hidden rounded-2xl border border-white/5 bg-surface p-5 hover:border-white/10 transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="relative">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[#8D7B77]">Appealed</p>
                <p className="mt-1.5 text-3xl font-bold text-purple-400">{items.filter(i => i.appealed).length}</p>
              </div>
              <div className="p-3 rounded-xl bg-purple-500/10">
                <MessageSquare size={20} className="text-purple-400" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Header Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-2 text-sm text-[#8D7B77]">
          <Filter size={14} />
          <span>{items.length} applications awaiting review</span>
        </div>
        
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-white/10 bg-white/5 text-sm text-white/70 hover:text-white hover:bg-white/10 transition-all disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {/* Error Message */}
      {apiError && (
        <div className="mb-6 rounded-2xl border border-red-500/20 bg-red-500/5 px-5 py-4 flex items-start gap-3">
          <AlertCircle size={18} className="text-red-400 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-400">Error</p>
            <p className="text-sm text-red-300/80">{apiError}</p>
          </div>
        </div>
      )}

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6">
        {/* Left Column - Applications List */}
        <div className="rounded-2xl border border-white/5 bg-surface overflow-hidden">
          <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between bg-white/5">
            <span className="text-sm font-medium text-[#8D7B77]">Applications</span>
            <span className="text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary font-medium">
              {items.length} pending
            </span>
          </div>

          {loading ? (
            <div className="px-5 py-12 text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-2 border-primary/20 border-t-primary mb-3"></div>
              <p className="text-sm text-[#8D7B77]">Loading applications...</p>
            </div>
          ) : items.length ? (
            <div className="max-h-[600px] overflow-y-auto divide-y divide-white/5">
              {items.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => {
                    setActive(it);
                    setRejectReason("");
                    setApiError(null);
                  }}
                  className={`w-full text-left px-5 py-4 transition-all hover:bg-white/5 ${
                    active?.id === it.id ? "bg-primary/5 border-l-2 border-primary" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-white truncate">
                          {it.name ?? "Unnamed Artist"}
                        </p>
                        {it.artistStatus === "APPROVED" && (
                          <CheckCircle size={12} className="text-green-400 shrink-0" />
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <Mail size={12} className="text-[#8D7B77]" />
                        <span className="text-xs text-[#8D7B77] truncate">{it.email}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <Calendar size={12} className="text-[#8D7B77]" />
                        <span className="text-xs text-[#8D7B77]">
                          {it.submittedAt ? new Date(it.submittedAt).toLocaleDateString() : "N/A"}
                        </span>
                      </div>
                    </div>
                    {it.appealed && (
                      <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-orange-500/10 text-orange-400 border border-orange-500/20">
                        <AlertCircle size={10} />
                        Appeal
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="px-5 py-16 text-center">
              <div className="inline-flex p-4 rounded-full bg-white/5 mb-4">
                <CheckCircle size={32} className="text-green-400" />
              </div>
              <p className="text-base font-medium text-white">All caught up! 🎉</p>
              <p className="text-sm text-[#8D7B77] mt-1">No pending applications to review</p>
            </div>
          )}
        </div>

        {/* Right Column - Application Details */}
        <div className="rounded-2xl border border-white/5 bg-surface overflow-hidden">
          <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-white/5">
            <span className="text-sm font-medium text-[#8D7B77]">Application Details</span>
            {active && (
              <span className="text-xs px-2.5 py-1 rounded-full bg-white/5 text-[#8D7B77] border border-white/10">
                ID: #{active.id}
              </span>
            )}
          </div>

          {!active ? (
            <div className="px-6 py-20 text-center">
              <div className="inline-flex p-5 rounded-full bg-white/5 mb-4">
                <UserPlus size={32} className="text-[#8D7B77]" />
              </div>
              <p className="text-base font-medium text-white">No application selected</p>
              <p className="text-sm text-[#8D7B77] mt-1">Click on any application from the list</p>
            </div>
          ) : (
            <div className="px-6 py-6 space-y-6 max-h-[600px] overflow-y-auto">
              {/* Name with Status Badge */}
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 text-xs font-medium text-[#8D7B77] uppercase tracking-wider mb-1.5">
                    <User size={14} />
                    <span>Full Name</span>
                  </div>
                  <p className="text-lg font-semibold text-white">{active.name ?? "Not provided"}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
                    active.artistStatus === "APPROVED" 
                      ? "bg-green-500/10 text-green-400 border border-green-500/20"
                      : "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20"
                  }`}>
                    {active.artistStatus === "APPROVED" ? (
                      <CheckCircle size={12} />
                    ) : (
                      <Clock size={12} />
                    )}
                    {(active.artistStatus ?? "PENDING").toUpperCase()}
                  </span>
                  {active.appealed && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-orange-500/10 text-orange-400 border border-orange-500/20">
                      <AlertCircle size={10} />
                      Appeal
                    </span>
                  )}
                </div>
              </div>

              {/* Email */}
              <div>
                <div className="flex items-center gap-2 text-xs font-medium text-[#8D7B77] uppercase tracking-wider mb-1.5">
                  <Mail size={14} />
                  <span>Email Address</span>
                </div>
                <div className="p-3 rounded-xl bg-black/20 border border-white/5">
                  <p className="text-sm text-white">{active.email}</p>
                </div>
              </div>

              {/* Bio */}
              <div>
                <div className="flex items-center gap-2 text-xs font-medium text-[#8D7B77] uppercase tracking-wider mb-1.5">
                  <FileText size={14} />
                  <span>Biography</span>
                </div>
                <div className="p-4 rounded-xl bg-black/20 border border-white/5 max-h-[120px] overflow-y-auto">
                  <p className="text-sm text-[#B8A6A1] leading-relaxed whitespace-pre-wrap">
                    {active.artistBio || "No bio provided"}
                  </p>
                </div>
              </div>

              {/* Appeal Message */}
              {active.appealMessage && (
                <div>
                  <div className="flex items-center gap-2 text-xs font-medium text-[#8D7B77] uppercase tracking-wider mb-1.5">
                    <MessageSquare size={14} />
                    <span>Appeal Message</span>
                  </div>
                  <div className="p-4 rounded-xl border border-orange-500/20 bg-orange-500/5 max-h-[100px] overflow-y-auto">
                    <p className="text-sm text-[#B8A6A1] leading-relaxed whitespace-pre-wrap">
                      {active.appealMessage}
                    </p>
                  </div>
                </div>
              )}

              {/* Portfolio Links */}
              <div>
                <div className="flex items-center gap-2 text-xs font-medium text-[#8D7B77] uppercase tracking-wider mb-1.5">
                  <Link2 size={14} />
                  <span>Portfolio Links</span>
                </div>
                {active.portfolioLinks?.length ? (
                  <div className="space-y-2">
                    {active.portfolioLinks.map((url, index) => {
                      const href = safeExternalUrl(url);
                      return href ? (
                        <a
                          key={index}
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 p-3 rounded-xl bg-black/20 border border-white/5 hover:border-primary/30 hover:bg-white/5 transition-all group"
                        >
                          <ExternalLink size={14} className="text-[#8D7B77] group-hover:text-primary transition-colors" />
                          <span className="text-sm text-[#B8A6A1] group-hover:text-white truncate flex-1">{url}</span>
                          <ChevronRight size={14} className="text-[#8D7B77] group-hover:text-primary transition-colors" />
                        </a>
                      ) : (
                        <div key={index} className="p-3 rounded-xl bg-black/20 border border-white/5 text-sm text-[#8D7B77] break-all">
                          {url}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-[#8D7B77]">No portfolio links provided</p>
                )}
              </div>

              {/* Action Buttons */}
              <div className="pt-4 border-t border-white/5">
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-medium text-[#8D7B77] uppercase tracking-wider flex items-center gap-1.5">
                      <AlertCircle size={12} />
                      Rejection Reason (required for rejection)
                    </label>
                    <textarea
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      className="mt-1.5 w-full min-h-[80px] rounded-xl bg-black/30 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-[#8D7B77] outline-none focus:border-primary/50 transition-all resize-none"
                      placeholder="Explain why this application is being rejected..."
                    />
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      disabled={resolveBusy}
                      onClick={() => resolve("REJECT")}
                      className="flex-1 flex items-center justify-center gap-2 h-[44px] rounded-xl border border-red-500/20 bg-red-500/5 text-sm font-medium text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-50"
                    >
                      <XCircle size={18} />
                      {resolveBusy ? "Processing..." : "Reject"}
                    </button>

                    <button
                      type="button"
                      disabled={resolveBusy}
                      onClick={() => resolve("APPROVE")}
                      className="flex-1 flex items-center justify-center gap-2 h-[44px] rounded-xl bg-gradient-to-r from-primary to-secondary text-sm font-medium text-white shadow-lg shadow-primary/20 hover:shadow-primary/40 transition-all disabled:opacity-50"
                    >
                      <CheckCircle size={18} />
                      {resolveBusy ? "Processing..." : "Approve"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </PageWrapper>
  );
}
