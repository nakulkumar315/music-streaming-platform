import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  Clock,
  Download,
  FileText,
  Mail,
  Music,
  Phone,
  RefreshCw,
  Save,
  Settings,
  Shield,
  ShieldCheck,
  User,
  UserCheck,
  UserX,
  XCircle,
} from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import PageWrapper from "../components/PageWrapper";
import Skeleton from "../components/Skeleton";
import { adminRuntimeConfig } from "../config/runtime";
import { http } from "../services/http";

type ArtistDetail = {
  id: number;
  name: string | null;
  email: string;
  profileImage: string | null;
  bannerImage: string | null;
  isVerified: boolean;
  subscriptionPrice: number;
  isDeleted?: boolean;
  deletedAt?: string | null;
  deletionReason?: string | null;
  phone: string | null;
  genre: string | null;
  bio: string;
  socialLinks: Record<string, unknown> | null;
  revenueSharePercentage: number;
  adminRemarks: string | null;
  status: string;
  totalContentCount: number;
  accountCreatedDate: string | null;
  accountUpdatedDate?: string | null;
  lastLogin: string | null;
  agreementAccepted?: boolean | null;
  agreementAcceptedAt?: string | null;
  agreementVersion?: string | null;
  artistRevenueShare?: number | null;
  platformRevenueShare?: number | null;
  digitalSignature?: string | null;
  signatureSignedAt?: string | null;
  agreementId?: string | null;
  termsVersion?: string | null;
  agreementStatus?: string | null;
  agreementStartDate?: string | null;
  agreementPdfPath?: string | null;
  signatureIpAddress?: string | null;
};

type ArtistDetailResponse = {
  success: boolean;
  artist: ArtistDetail;
  correlationId?: string;
};

type ContentHistoryItem = {
  id: number;
  title: string;
  type: string;
  isApproved: boolean;
  createdAt: string;
};

type ContentHistoryResponse = {
  success: boolean;
  items?: Array<Record<string, unknown>>;
  message?: string;
  correlationId?: string;
};

type SoftDeleteResponse = {
  success: boolean;
  message?: string;
  correlationId?: string;
};

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatPrice(value: number) {
  const amount = Number(value);
  return `${new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0)} / month`;
}

function hasAtMostTwoDecimals(value: number) {
  const paise = Math.round(value * 100);
  return Number.isSafeInteger(paise) && Math.abs(value * 100 - paise) <= 1e-7;
}

function safeHttpUrl(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  try {
    const parsed = raw.startsWith("/")
      ? new URL(raw, `${adminRuntimeConfig.apiBaseUrl}/`)
      : new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function safeSignatureUrl(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=\s]+$/i.test(raw)) {
    return raw;
  }
  return safeHttpUrl(raw);
}

function parseSocialLinks(raw: string): Record<string, string> | null | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") return undefined;
    const output: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const url = safeHttpUrl(value);
      if (!url) return undefined;
      output[key] = url;
    }
    return output;
  } catch {
    return undefined;
  }
}

function errorMessage(error: unknown, fallback: string) {
  const value = error as {
    response?: { data?: { message?: string; correlationId?: string } };
    message?: string;
  };
  const message = value?.response?.data?.message || value?.message || fallback;
  const correlationId = value?.response?.data?.correlationId;
  return correlationId ? `${message} (Reference: ${correlationId})` : message;
}

function Toggle({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-12 items-center rounded-full transition-all disabled:opacity-50 ${
        checked ? "bg-primary" : "bg-[#2A2A2A]"
      }`}
    >
      <span
        className={`inline-block h-[18px] w-[18px] rounded-full bg-white shadow-lg transition-transform ${
          checked ? "translate-x-[26px]" : "translate-x-[3px]"
        }`}
      />
    </button>
  );
}

function StatusBadge({ status, isDeleted }: { status: string; isDeleted?: boolean }) {
  const inactive =
    isDeleted || ["SUSPENDED", "INACTIVE"].includes(String(status).toUpperCase());
  return inactive ? (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/20 bg-red-500/10 px-3 py-1 text-xs font-medium text-red-400">
      <UserX size={12} /> Inactive
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-green-500/20 bg-green-500/10 px-3 py-1 text-xs font-medium text-green-400">
      <UserCheck size={12} /> Active
    </span>
  );
}

function VerifiedBadge({ verified }: { verified: boolean }) {
  return verified ? (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-xs font-medium text-blue-400">
      <CheckCircle size={12} /> Verified
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-500/20 bg-gray-500/10 px-3 py-1 text-xs font-medium text-[#8D7B77]">
      <XCircle size={12} /> Unverified
    </span>
  );
}

export default function AdminArtistDetailPage() {
  const navigate = useNavigate();
  const { id: artistId } = useParams();
  const queryClient = useQueryClient();
  const artistFetchInFlight = useRef(false);
  const historyFetchInFlight = useRef(false);
  const lastLoadedArtistId = useRef<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [artist, setArtist] = useState<ArtistDetail | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [brokenSignature, setBrokenSignature] = useState(false);
  const [activeTab, setActiveTab] = useState<"PROFILE" | "AGREEMENT">("PROFILE");

  const [draftName, setDraftName] = useState("");
  const [draftPhone, setDraftPhone] = useState("");
  const [draftGenre, setDraftGenre] = useState("");
  const [draftBio, setDraftBio] = useState("");
  const [draftRevenueShare, setDraftRevenueShare] = useState("90");
  const [draftSubscriptionPrice, setDraftSubscriptionPrice] = useState("");
  const [draftSocialLinks, setDraftSocialLinks] = useState("");
  const [draftAdminRemarks, setDraftAdminRemarks] = useState("");

  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyItems, setHistoryItems] = useState<ContentHistoryItem[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [softDeleteOpen, setSoftDeleteOpen] = useState(false);
  const [softDeleteReason, setSoftDeleteReason] = useState("");
  const [softDeleteBusy, setSoftDeleteBusy] = useState(false);
  const [softDeleteError, setSoftDeleteError] = useState<string | null>(null);

  const [showRevenueModal, setShowRevenueModal] = useState(false);
  const [futureArtistShare, setFutureArtistShare] = useState("55");
  const [futurePlatformShare, setFuturePlatformShare] = useState("45");
  const [revenueModalBusy, setRevenueModalBusy] = useState(false);

  const [showTermsModal, setShowTermsModal] = useState(false);
  const [newTermsContent, setNewTermsContent] = useState("");
  const [termsModalBusy, setTermsModalBusy] = useState(false);

  const applyArtist = (next: ArtistDetail) => {
    setArtist(next);
    setDraftName(next.name ?? "");
    setDraftPhone(next.phone ?? "");
    setDraftGenre(next.genre ?? "");
    setDraftBio(next.bio ?? "");
    setDraftRevenueShare(String(next.revenueSharePercentage ?? 90));
    setDraftSubscriptionPrice(
      Number(next.subscriptionPrice) > 0 ? String(next.subscriptionPrice) : ""
    );
    setDraftSocialLinks(next.socialLinks ? JSON.stringify(next.socialLinks, null, 2) : "");
    setDraftAdminRemarks(next.adminRemarks ?? "");
  };

  const fetchArtist = async (force = false) => {
    if (!artistId) return;
    if (!force) {
      if (artistFetchInFlight.current) return;
      if (lastLoadedArtistId.current === artistId) return;
    }

    artistFetchInFlight.current = true;
    setBrokenSignature(false);
    setLoading(true);
    try {
      const response = await http.get<ArtistDetailResponse>(
        `/api/v1/admin/artists/${artistId}`
      );
      if (!response.data?.success || !response.data.artist) {
        throw new Error("Artist details are unavailable");
      }
      applyArtist(response.data.artist);
      lastLoadedArtistId.current = artistId;
      setSaveError(null);
    } catch (error: unknown) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status === 404) {
        navigate("/admin/artists", { replace: true });
        return;
      }
      setSaveError(errorMessage(error, "Failed to load artist details"));
    } finally {
      setLoading(false);
      artistFetchInFlight.current = false;
    }
  };

  const fetchContentHistory = async () => {
    if (!artistId || historyFetchInFlight.current) return;
    historyFetchInFlight.current = true;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const response = await http.get<ContentHistoryResponse>(
        "/api/v1/content/history",
        { params: { artistId } }
      );
      if (!response.data?.success) {
        throw new Error(response.data?.message || "Failed to load content history");
      }
      const items = Array.isArray(response.data.items) ? response.data.items : [];
      setHistoryItems(
        items
          .map((item) => ({
            id: Number(item.id),
            title: String(item.title ?? "Untitled"),
            type: String(item.type ?? "CONTENT").toUpperCase(),
            isApproved: Boolean(item.isApproved ?? item.is_approved),
            createdAt: String(item.createdAt ?? item.created_at ?? ""),
          }))
          .filter((item) => Number.isSafeInteger(item.id) && item.id > 0)
      );
    } catch (error: unknown) {
      setHistoryItems([]);
      setHistoryError(errorMessage(error, "Failed to load content history"));
    } finally {
      setHistoryLoading(false);
      historyFetchInFlight.current = false;
    }
  };

  useEffect(() => {
    lastLoadedArtistId.current = null;
    void fetchArtist(true);
    void fetchContentHistory();
  }, [artistId]);

  const runArtistCommand = async (
    command: () => Promise<unknown>,
    fallback: string
  ) => {
    if (busy) return;
    setBusy(true);
    setSaveError(null);
    try {
      await command();
      await fetchArtist(true);
      await queryClient.invalidateQueries({ queryKey: ["admin", "artists"], exact: false });
    } catch (error: unknown) {
      setSaveError(errorMessage(error, fallback));
    } finally {
      setBusy(false);
    }
  };

  const saveAll = async () => {
    if (!artistId || busy) return;

    const subscriptionPrice = Number(draftSubscriptionPrice);
    if (
      !Number.isFinite(subscriptionPrice) ||
      subscriptionPrice <= 0 ||
      !hasAtMostTwoDecimals(subscriptionPrice)
    ) {
      setSaveError(
        "Subscription price must be a positive INR amount with at most two decimal places."
      );
      return;
    }

    const revenueSharePercentage = Number(draftRevenueShare);
    if (
      !Number.isFinite(revenueSharePercentage) ||
      revenueSharePercentage < 0 ||
      revenueSharePercentage > 100
    ) {
      setSaveError("Revenue share percentage must be between 0 and 100.");
      return;
    }

    const socialLinks = parseSocialLinks(draftSocialLinks);
    if (socialLinks === undefined) {
      setSaveError("Social Links must be a JSON object containing only valid http(s) URLs.");
      return;
    }

    await runArtistCommand(
      () =>
        http.patch(`/api/v1/admin/artists/${artistId}`, {
          name: draftName.trim() || null,
          phone: draftPhone.trim() || null,
          genre: draftGenre.trim() || null,
          bio: draftBio.trim() || null,
          revenueSharePercentage,
          subscriptionPrice,
          socialLinks,
          adminRemarks: draftAdminRemarks.trim() || null,
        }),
      "Failed to save artist changes"
    );
  };

  const setVerified = async (next: boolean) => {
    if (!artistId) return;
    await runArtistCommand(
      () =>
        http.patch(`/api/v1/admin/artists/${artistId}/verified`, {
          isVerified: next,
        }),
      "Failed to update verification status"
    );
  };

  const runAgreementAction = async (
    path: string,
    body: Record<string, unknown> | undefined,
    fallback: string
  ) => {
    await runArtistCommand(
      () => http.patch(path, body ?? {}),
      fallback
    );
  };

  const rejectAgreement = async () => {
    if (!artistId) return;
    const reason = window.prompt("Enter rejection reason (3–500 characters):")?.trim() || "";
    if (!reason) return;
    if (reason.length < 3 || reason.length > 500) {
      setSaveError("Agreement rejection reason must be 3–500 characters.");
      return;
    }
    await runAgreementAction(
      `/api/v1/admin/artists/${artistId}/reject-agreement`,
      { reason },
      "Failed to reject agreement"
    );
  };

  const handleDownloadPdf = async () => {
    if (!artist?.id || busy) return;
    setBusy(true);
    setSaveError(null);
    let objectUrl: string | null = null;
    try {
      const response = await http.get(
        `/api/v1/admin/artists/${artist.id}/agreement-pdf`,
        { responseType: "blob" }
      );
      objectUrl = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `agreement-${artist.id}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error: unknown) {
      setSaveError(errorMessage(error, "Failed to download agreement PDF"));
    } finally {
      if (objectUrl) window.URL.revokeObjectURL(objectUrl);
      setBusy(false);
    }
  };

  const submitSoftDelete = async () => {
    if (!artistId || softDeleteBusy) return;
    const reason = softDeleteReason.trim();
    if (reason.length < 3 || reason.length > 500) {
      setSoftDeleteError("Reason must be 3–500 characters.");
      return;
    }

    setSoftDeleteBusy(true);
    setSoftDeleteError(null);
    try {
      const response = await http.patch<SoftDeleteResponse>(
        `/api/v1/admin/artists/${artistId}/soft-delete`,
        { reason }
      );
      if (!response.data?.success) {
        throw new Error(response.data?.message || "Deactivation failed");
      }
      await fetchArtist(true);
      await queryClient.invalidateQueries({ queryKey: ["admin", "artists"], exact: false });
      setSoftDeleteOpen(false);
      setSoftDeleteReason("");
    } catch (error: unknown) {
      setSoftDeleteError(errorMessage(error, "Artist deactivation failed"));
    } finally {
      setSoftDeleteBusy(false);
    }
  };

  const reactivateArtist = async () => {
    if (!artistId || softDeleteBusy) return;
    setSoftDeleteBusy(true);
    setSoftDeleteError(null);
    try {
      const response = await http.patch<SoftDeleteResponse>(
        `/api/v1/admin/artists/${artistId}/reactivate`,
        {}
      );
      if (!response.data?.success) {
        throw new Error(response.data?.message || "Reactivation failed");
      }
      await fetchArtist(true);
      await queryClient.invalidateQueries({ queryKey: ["admin", "artists"], exact: false });
    } catch (error: unknown) {
      setSoftDeleteError(errorMessage(error, "Artist reactivation failed"));
    } finally {
      setSoftDeleteBusy(false);
    }
  };

  const updateFutureRevenue = async () => {
    const artistShare = Number(futureArtistShare);
    const platformShare = Number(futurePlatformShare);
    if (
      !Number.isInteger(artistShare) ||
      !Number.isInteger(platformShare) ||
      artistShare < 0 ||
      platformShare < 0 ||
      artistShare > 100 ||
      platformShare > 100 ||
      artistShare + platformShare !== 100
    ) {
      setSaveError("Future revenue shares must be whole percentages that total 100%.");
      return;
    }

    setRevenueModalBusy(true);
    setSaveError(null);
    try {
      await http.patch("/api/v1/admin/artists/revenue-share-config", {
        artistShare,
        platformShare,
      });
      setShowRevenueModal(false);
    } catch (error: unknown) {
      setSaveError(errorMessage(error, "Failed to update future revenue configuration"));
    } finally {
      setRevenueModalBusy(false);
    }
  };

  const publishTerms = async () => {
    const content = newTermsContent.trim();
    if (!content) return;
    setTermsModalBusy(true);
    setSaveError(null);
    try {
      await http.post("/api/v1/admin/artists/terms-versions", { content });
      setNewTermsContent("");
      setShowTermsModal(false);
    } catch (error: unknown) {
      setSaveError(errorMessage(error, "Failed to publish terms version"));
    } finally {
      setTermsModalBusy(false);
    }
  };

  const status = String(artist?.status ?? "ACTIVE").toUpperCase();
  const inactive = Boolean(artist?.isDeleted) || ["SUSPENDED", "INACTIVE"].includes(status);
  const signatureUrl = safeSignatureUrl(artist?.digitalSignature);
  const profileUrl = safeHttpUrl(artist?.profileImage);
  const bannerUrl = safeHttpUrl(artist?.bannerImage);
  const agreementStatus = String(artist?.agreementStatus || "").toUpperCase();

  const headerBannerStyle = useMemo(
    () =>
      bannerUrl
        ? {
            backgroundImage: `url(${JSON.stringify(bannerUrl).slice(1, -1)})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }
        : {
            backgroundImage:
              "linear-gradient(135deg, rgba(30,18,18,0.95) 0%, rgba(10,8,8,0.6) 55%, rgba(10,8,8,0.3) 100%)",
            backgroundSize: "cover",
          },
    [bannerUrl]
  );

  if (loading && !artist) {
    return (
      <PageWrapper title="Artist Details" subtitle="Loading artist information...">
        <div className="space-y-4">
          <Skeleton className="h-60 w-full rounded-2xl" />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Skeleton className="h-64 w-full rounded-2xl" />
            <Skeleton className="h-64 w-full rounded-2xl" />
          </div>
        </div>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper title="Artist Details" subtitle={`Managing ${artist?.name || "Artist"}`}>
      <Link to="/admin/artists" className="mb-6 inline-flex items-center gap-2 text-sm text-[#8D7B77] transition-all hover:text-white">
        <ArrowLeft size={16} /> Back to Artists
      </Link>

      {saveError && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <span className="flex-1">{saveError}</span>
          <button type="button" onClick={() => void fetchArtist(true)} disabled={loading || busy} className="rounded-lg border border-red-300/20 px-2.5 py-1 text-xs disabled:opacity-50">Reload</button>
        </div>
      )}

      <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-surface">
        <div className="h-52 w-full" style={headerBannerStyle} />
        <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/25 to-black/65" />
        <div className="relative -mt-12 px-6 pb-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end">
            <div className="h-[88px] w-[88px] shrink-0 overflow-hidden rounded-2xl border-2 border-white/10 bg-background shadow-xl">
              {profileUrl ? <img src={profileUrl} alt={artist?.name ?? artist?.email ?? "Artist"} className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-[#8D7B77]"><User size={32} /></div>}
            </div>
            <div className="min-w-0 flex-1 pb-2">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="truncate text-3xl font-bold text-white sm:text-4xl">{artist?.name ?? "Unnamed Artist"}</h1>
                <VerifiedBadge verified={Boolean(artist?.isVerified)} />
                <StatusBadge status={status} isDeleted={artist?.isDeleted} />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-[#8D7B77]">
                <span className="flex items-center gap-1.5"><Mail size={14} />{artist?.email}</span>
                {artist?.phone && <span className="flex items-center gap-1.5"><Phone size={14} />{artist.phone}</span>}
              </div>
            </div>
            <div className="flex items-center gap-3 pb-2">
              <Toggle checked={Boolean(artist?.isVerified)} disabled={busy} onChange={(value) => void setVerified(value)} />
              <span className="text-xs text-[#8D7B77]">{artist?.isVerified ? "Verified" : "Verify"}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 border-b border-white/10">
        <nav className="flex gap-1">
          <button type="button" onClick={() => setActiveTab("PROFILE")} className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium ${activeTab === "PROFILE" ? "border-primary text-primary" : "border-transparent text-[#8D7B77] hover:text-white"}`}><User size={18} /> Profile</button>
          <button type="button" onClick={() => setActiveTab("AGREEMENT")} className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium ${activeTab === "AGREEMENT" ? "border-primary text-primary" : "border-transparent text-[#8D7B77] hover:text-white"}`}><FileText size={18} /> Agreement</button>
        </nav>
      </div>

      {activeTab === "PROFILE" && (
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-6">
            <section className="rounded-2xl border border-white/5 bg-surface p-6">
              <div className="mb-5 flex items-center gap-3"><div className="rounded-xl bg-primary/10 p-2"><Music size={18} className="text-primary" /></div><h2 className="text-sm font-semibold text-white">Subscription Pricing</h2></div>
              <div className="rounded-xl border border-white/5 bg-black/20 p-3"><div className="text-xs text-[#8D7B77]">Current monthly price</div><div className="mt-1 text-lg font-bold text-white">{formatPrice(artist?.subscriptionPrice ?? 0)}</div></div>
              <label className="mt-4 block text-xs uppercase tracking-wider text-[#8D7B77]">Update monthly INR price</label>
              <input type="number" min="0.01" step="0.01" value={draftSubscriptionPrice} onChange={(event) => setDraftSubscriptionPrice(event.target.value)} disabled={busy} className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-4 text-white outline-none focus:border-primary/50 disabled:opacity-50" />
            </section>

            <section className="rounded-2xl border border-white/5 bg-surface p-6">
              <div className="mb-5 flex items-center gap-3"><div className="rounded-xl bg-blue-500/10 p-2"><Settings size={18} className="text-blue-400" /></div><h2 className="text-sm font-semibold text-white">Artist Configuration</h2></div>
              <div className="space-y-4">
                <div><label className="text-xs uppercase tracking-wider text-[#8D7B77]">Name</label><input value={draftName} onChange={(event) => setDraftName(event.target.value)} disabled={busy} className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-4 text-white outline-none focus:border-primary/50 disabled:opacity-50" /></div>
                <div><label className="text-xs uppercase tracking-wider text-[#8D7B77]">Phone</label><input value={draftPhone} onChange={(event) => setDraftPhone(event.target.value)} disabled={busy} className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-4 text-white outline-none focus:border-primary/50 disabled:opacity-50" /></div>
                <div><label className="text-xs uppercase tracking-wider text-[#8D7B77]">Genre</label><input value={draftGenre} onChange={(event) => setDraftGenre(event.target.value)} disabled={busy} className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-4 text-white outline-none focus:border-primary/50 disabled:opacity-50" /></div>
                <div><label className="text-xs uppercase tracking-wider text-[#8D7B77]">Bio</label><textarea value={draftBio} onChange={(event) => setDraftBio(event.target.value)} rows={3} disabled={busy} className="mt-1.5 w-full resize-none rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-primary/50 disabled:opacity-50" /></div>
                <div><label className="text-xs uppercase tracking-wider text-[#8D7B77]">Revenue share %</label><input type="number" min="0" max="100" step="1" value={draftRevenueShare} onChange={(event) => setDraftRevenueShare(event.target.value)} disabled={busy} className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-4 text-white outline-none focus:border-primary/50 disabled:opacity-50" /></div>
                <div><label className="text-xs uppercase tracking-wider text-[#8D7B77]">Social Links (JSON http(s) URLs only)</label><textarea value={draftSocialLinks} onChange={(event) => setDraftSocialLinks(event.target.value)} rows={4} disabled={busy} className="mt-1.5 w-full resize-none rounded-xl border border-white/10 bg-black/30 px-4 py-3 font-mono text-sm text-white outline-none focus:border-primary/50 disabled:opacity-50" /></div>
                <div><label className="text-xs uppercase tracking-wider text-[#8D7B77]">Admin Remarks</label><textarea value={draftAdminRemarks} onChange={(event) => setDraftAdminRemarks(event.target.value)} rows={3} disabled={busy} className="mt-1.5 w-full resize-none rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none focus:border-primary/50 disabled:opacity-50" /></div>
              </div>
              <button type="button" disabled={busy} onClick={() => void saveAll()} className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-secondary font-medium text-white disabled:opacity-50"><Save size={16} />{busy ? "Saving…" : "Save Changes"}</button>
            </section>
          </div>

          <div className="space-y-6">
            <section className="rounded-2xl border border-white/5 bg-surface p-6">
              <div className="mb-5 flex items-center gap-3"><div className="rounded-xl bg-purple-500/10 p-2"><Shield size={18} className="text-purple-400" /></div><h2 className="text-sm font-semibold text-white">Artist Status</h2></div>
              <div className="text-sm text-[#B8A6A1]">Current status: <span className={inactive ? "font-semibold text-red-400" : "font-semibold text-green-400"}>{inactive ? "DEACTIVATED" : "ACTIVE"}</span></div>
              {artist?.isDeleted && <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-xs text-[#B8A6A1]">Deactivated: {formatDateTime(artist.deletedAt)}{artist.deletionReason ? ` · ${artist.deletionReason}` : ""}</div>}
              <div className="mt-4 flex gap-3">
                <button type="button" disabled={busy || softDeleteBusy || inactive} onClick={() => { setSoftDeleteError(null); setSoftDeleteOpen(true); }} className="h-11 flex-1 rounded-xl border border-red-500/20 bg-red-500/5 text-sm font-medium text-red-400 disabled:opacity-40">Deactivate</button>
                <button type="button" disabled={busy || softDeleteBusy || !inactive} onClick={() => void reactivateArtist()} className="h-11 flex-1 rounded-xl border border-green-500/20 bg-green-500/5 text-sm font-medium text-green-400 disabled:opacity-40"><RefreshCw size={15} className="mr-1 inline" />Reactivate</button>
              </div>
              {softDeleteError && <div className="mt-2 text-xs text-red-400">{softDeleteError}</div>}
            </section>

            <section className="rounded-2xl border border-white/5 bg-surface p-6">
              <div className="mb-5 flex items-center justify-between"><div className="flex items-center gap-3"><div className="rounded-xl bg-green-500/10 p-2"><FileText size={18} className="text-green-400" /></div><h2 className="text-sm font-semibold text-white">Content History</h2></div><button type="button" disabled={historyLoading} onClick={() => void fetchContentHistory()} className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-[#B8A6A1] disabled:opacity-50"><RefreshCw size={12} className={`mr-1 inline ${historyLoading ? "animate-spin" : ""}`} />Refresh</button></div>
              <p className="mb-4 text-xs leading-relaxed text-[#8D7B77]">Read-only context on this screen. Content approval and takedown remain in the dedicated moderation workflow; destructive hard-delete is not a Phase-1 governance action.</p>
              {historyError && <div className="mb-3 rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-300">{historyError}</div>}
              {historyLoading ? (
                <div className="space-y-2">{[0, 1].map((value) => <Skeleton key={value} className="h-14 w-full rounded-xl" />)}</div>
              ) : historyItems.length === 0 ? (
                <div className="py-8 text-center text-sm text-[#8D7B77]">No content found</div>
              ) : (
                <div className="max-h-[360px] space-y-2 overflow-y-auto">
                  {historyItems.map((item) => (
                    <div key={item.id} className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/5 p-3">
                      <div className="rounded-lg bg-black/30 p-2"><FileText size={16} className="text-[#8D7B77]" /></div>
                      <div className="min-w-0 flex-1"><div className="truncate text-sm text-white">{item.title}</div><div className="mt-0.5 text-xs text-[#8D7B77]">{item.type} · {formatDateTime(item.createdAt)}</div></div>
                      <span className={`text-xs ${item.isApproved ? "text-green-400" : "text-amber-400"}`}>{item.isApproved ? "Approved" : "Pending"}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-white/5 bg-surface p-6">
              <div className="mb-4 flex items-center gap-3"><div className="rounded-xl bg-orange-500/10 p-2"><Activity size={18} className="text-orange-400" /></div><h2 className="text-sm font-semibold text-white">Account Context</h2></div>
              <div className="space-y-2 text-sm"><div className="flex justify-between rounded-xl bg-black/20 p-3"><span className="text-[#8D7B77]">Created</span><span className="text-white">{formatDateTime(artist?.accountCreatedDate)}</span></div><div className="flex justify-between rounded-xl bg-black/20 p-3"><span className="text-[#8D7B77]">Last login</span><span className="text-white">{formatDateTime(artist?.lastLogin)}</span></div><div className="flex justify-between rounded-xl bg-black/20 p-3"><span className="text-[#8D7B77]">Total content</span><span className="font-semibold text-white">{artist?.totalContentCount ?? 0}</span></div></div>
              <button type="button" onClick={() => setShowRevenueModal(true)} className="mt-4 h-10 w-full rounded-xl border border-primary/30 bg-primary/10 text-sm text-primary">Manage Future Revenue</button>
              {artist?.agreementAccepted && <button type="button" onClick={() => setShowTermsModal(true)} className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-white/5 text-sm text-[#B8A6A1]">Publish Future Terms Version</button>}
            </section>
          </div>
        </div>
      )}

      {activeTab === "AGREEMENT" && (
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-white/5 bg-surface p-6">
            <div className="mb-5 flex items-center gap-3"><div className="rounded-xl bg-primary/10 p-2"><FileText size={18} className="text-primary" /></div><h2 className="text-sm font-semibold text-white">Agreement Details</h2></div>
            {!artist?.agreementAccepted ? (
              <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-6 text-center"><AlertTriangle size={24} className="mx-auto mb-2 text-yellow-400" /><div className="text-sm font-medium text-yellow-300">Agreement Not Signed</div></div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-xl bg-white/5 p-3"><div className="text-xs text-[#8D7B77]">Agreement ID</div><div className="mt-1 truncate font-mono text-white">{artist.agreementId || "—"}</div></div>
                  <div className="rounded-xl bg-white/5 p-3"><div className="text-xs text-[#8D7B77]">Status</div><div className="mt-1 font-semibold text-white">{agreementStatus || "ACTIVE"}</div></div>
                  <div className="rounded-xl bg-white/5 p-3"><div className="text-xs text-[#8D7B77]">Artist Share</div><div className="mt-1 font-semibold text-primary">{artist.artistRevenueShare ?? 0}%</div></div>
                  <div className="rounded-xl bg-white/5 p-3"><div className="text-xs text-[#8D7B77]">Platform Share</div><div className="mt-1 font-semibold text-secondary">{artist.platformRevenueShare ?? 0}%</div></div>
                  <div className="rounded-xl bg-white/5 p-3"><div className="text-xs text-[#8D7B77]">Version</div><div className="mt-1 text-white">{artist.agreementVersion || "—"}</div></div>
                  <div className="rounded-xl bg-white/5 p-3"><div className="text-xs text-[#8D7B77]">Terms</div><div className="mt-1 text-white">{artist.termsVersion || "—"}</div></div>
                </div>

                <div className="mt-5 flex flex-wrap gap-3">
                  <button type="button" disabled={busy} onClick={() => void handleDownloadPdf()} className="h-11 flex-1 rounded-xl border border-primary/30 bg-primary/10 px-4 text-sm text-primary disabled:opacity-50"><Download size={16} className="mr-1 inline" />{busy ? "Working…" : "Download PDF"}</button>
                  {agreementStatus === "PENDING_APPROVAL" && <button type="button" disabled={busy} onClick={() => void runAgreementAction(`/api/v1/admin/artists/${artist.id}/approve-agreement`, undefined, "Failed to approve agreement")} className="h-11 flex-1 rounded-xl bg-emerald-600 px-4 text-sm font-medium text-white disabled:opacity-50"><CheckCircle size={16} className="mr-1 inline" />Approve</button>}
                  {agreementStatus === "PENDING_APPROVAL" && <button type="button" disabled={busy} onClick={() => void rejectAgreement()} className="h-11 flex-1 rounded-xl bg-red-600 px-4 text-sm font-medium text-white disabled:opacity-50"><XCircle size={16} className="mr-1 inline" />Reject</button>}
                  {agreementStatus === "ACTIVE" && <button type="button" disabled={busy} onClick={() => { if (!window.confirm("Suspend this agreement?")) return; void runAgreementAction(`/api/v1/admin/artists/${artist.id}/agreement-status`, { status: "SUSPENDED" }, "Failed to suspend agreement"); }} className="h-11 flex-1 rounded-xl bg-amber-600 px-4 text-sm font-medium text-white disabled:opacity-50"><Shield size={16} className="mr-1 inline" />Suspend</button>}
                  {agreementStatus === "SUSPENDED" && <button type="button" disabled={busy} onClick={() => void runAgreementAction(`/api/v1/admin/artists/${artist.id}/agreement-status`, { status: "ACTIVE" }, "Failed to activate agreement")} className="h-11 flex-1 rounded-xl bg-emerald-600 px-4 text-sm font-medium text-white disabled:opacity-50"><ShieldCheck size={16} className="mr-1 inline" />Activate</button>}
                </div>
              </>
            )}
          </section>

          <section className="space-y-6">
            <div className="rounded-2xl border border-white/5 bg-surface p-6">
              <div className="mb-4 flex items-center gap-3"><div className="rounded-xl bg-purple-500/10 p-2"><ShieldCheck size={18} className="text-purple-400" /></div><h2 className="text-sm font-semibold text-white">Digital Signature</h2></div>
              {signatureUrl && !brokenSignature ? (
                <div className="flex h-36 items-center justify-center rounded-xl border border-white/10 bg-black/40 p-4"><img src={signatureUrl} alt="Digital signature" className="max-h-28 max-w-full object-contain" onError={() => setBrokenSignature(true)} /></div>
              ) : (
                <div className="flex h-36 flex-col items-center justify-center rounded-xl border border-yellow-500/10 bg-yellow-500/5"><AlertTriangle size={22} className="mb-2 text-yellow-500" /><div className="text-xs font-semibold text-yellow-400">Signature Not Available</div></div>
              )}
              <div className="mt-4 grid grid-cols-2 gap-3 text-xs"><div><div className="text-[#8D7B77]">Signed At</div><div className="mt-1 text-white">{formatDateTime(artist?.signatureSignedAt)}</div></div><div><div className="text-[#8D7B77]">IP Address</div><div className="mt-1 text-white">{artist?.signatureIpAddress || "—"}</div></div></div>
            </div>

            <div className="rounded-2xl border border-white/5 bg-surface p-6">
              <div className="mb-4 flex items-center gap-3"><div className="rounded-xl bg-orange-500/10 p-2"><Clock size={18} className="text-orange-400" /></div><h2 className="text-sm font-semibold text-white">Agreement Timeline</h2></div>
              <div className="space-y-3 text-sm"><div className="flex justify-between"><span className="text-[#8D7B77]">Created</span><span className="text-white">{formatDateTime(artist?.agreementStartDate)}</span></div><div className="flex justify-between"><span className="text-[#8D7B77]">Signed</span><span className="text-white">{formatDateTime(artist?.signatureSignedAt)}</span></div><div className="flex justify-between"><span className="text-[#8D7B77]">Artist joined</span><span className="text-white">{formatDateTime(artist?.accountCreatedDate)}</span></div></div>
            </div>
          </section>
        </div>
      )}

      {softDeleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => { if (!softDeleteBusy) setSoftDeleteOpen(false); }} />
          <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-surface p-6 shadow-2xl">
            <div className="mb-4 flex items-center gap-3"><div className="rounded-xl bg-red-500/10 p-2"><AlertTriangle size={20} className="text-red-400" /></div><h3 className="text-lg font-semibold text-white">Deactivate Artist</h3></div>
            <p className="text-sm text-[#8D7B77]">This changes account availability and must include an auditable reason.</p>
            <textarea value={softDeleteReason} onChange={(event) => setSoftDeleteReason(event.target.value)} disabled={softDeleteBusy} rows={3} maxLength={500} className="mt-4 w-full resize-none rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none focus:border-primary/50 disabled:opacity-50" placeholder="Reason (3–500 characters)" />
            {softDeleteError && <div className="mt-2 text-xs text-red-400">{softDeleteError}</div>}
            <div className="mt-6 flex gap-3"><button type="button" disabled={softDeleteBusy} onClick={() => setSoftDeleteOpen(false)} className="h-11 flex-1 rounded-xl border border-white/10 bg-white/5 text-sm text-[#B8A6A1] disabled:opacity-50">Cancel</button><button type="button" disabled={softDeleteBusy} onClick={() => void submitSoftDelete()} className="h-11 flex-1 rounded-xl bg-red-600 text-sm font-medium text-white disabled:opacity-50">{softDeleteBusy ? "Deactivating…" : "Deactivate"}</button></div>
          </div>
        </div>
      )}

      {showRevenueModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => { if (!revenueModalBusy) setShowRevenueModal(false); }} />
          <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-surface p-6 shadow-2xl">
            <div className="mb-4 flex items-center gap-3"><div className="rounded-xl bg-primary/10 p-2"><Settings size={20} className="text-primary" /></div><h3 className="text-lg font-semibold text-white">Manage Future Revenue</h3></div>
            <p className="text-sm text-[#8D7B77]">Updates future onboarding configuration only; existing signed agreement values remain unchanged.</p>
            <div className="mt-4 grid grid-cols-2 gap-3"><div><label className="text-xs uppercase text-[#8D7B77]">Artist %</label><input type="number" min="0" max="100" step="1" value={futureArtistShare} onChange={(event) => setFutureArtistShare(event.target.value)} disabled={revenueModalBusy} className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-white" /></div><div><label className="text-xs uppercase text-[#8D7B77]">Platform %</label><input type="number" min="0" max="100" step="1" value={futurePlatformShare} onChange={(event) => setFuturePlatformShare(event.target.value)} disabled={revenueModalBusy} className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-white" /></div></div>
            <div className="mt-6 flex gap-3"><button type="button" disabled={revenueModalBusy} onClick={() => setShowRevenueModal(false)} className="h-11 flex-1 rounded-xl border border-white/10 bg-white/5 text-sm text-[#B8A6A1]">Cancel</button><button type="button" disabled={revenueModalBusy} onClick={() => void updateFutureRevenue()} className="h-11 flex-1 rounded-xl bg-primary text-sm font-medium text-white disabled:opacity-50">{revenueModalBusy ? "Updating…" : "Update"}</button></div>
          </div>
        </div>
      )}

      {showTermsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => { if (!termsModalBusy) setShowTermsModal(false); }} />
          <div className="relative w-full max-w-2xl rounded-2xl border border-white/10 bg-surface p-6 shadow-2xl">
            <div className="mb-4 flex items-center gap-3"><div className="rounded-xl bg-blue-500/10 p-2"><FileText size={20} className="text-blue-400" /></div><h3 className="text-lg font-semibold text-white">Publish New Terms Version</h3></div>
            <p className="text-sm text-[#8D7B77]">Applies to future onboarding only; existing signed agreements remain unchanged.</p>
            <textarea value={newTermsContent} onChange={(event) => setNewTermsContent(event.target.value)} disabled={termsModalBusy} rows={12} className="mt-4 w-full resize-none rounded-xl border border-white/10 bg-black/30 px-4 py-3 font-mono text-sm text-white outline-none focus:border-primary/50 disabled:opacity-50" placeholder="Terms and conditions content" />
            <div className="mt-6 flex gap-3"><button type="button" disabled={termsModalBusy} onClick={() => setShowTermsModal(false)} className="h-11 flex-1 rounded-xl border border-white/10 bg-white/5 text-sm text-[#B8A6A1]">Cancel</button><button type="button" disabled={termsModalBusy || !newTermsContent.trim()} onClick={() => void publishTerms()} className="h-11 flex-1 rounded-xl bg-blue-600 text-sm font-medium text-white disabled:opacity-50">{termsModalBusy ? "Publishing…" : "Publish"}</button></div>
          </div>
        </div>
      )}
    </PageWrapper>
  );
}
