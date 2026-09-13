import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsLeft,
  ChevronsRight,
  Download,
  Eye,
  FileText,
  Mail,
  Search,
  User,
  UserCheck,
  Users,
  UserX,
  XCircle,
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import PageWrapper from "../components/PageWrapper";
import Skeleton from "../components/Skeleton";
import { adminRuntimeConfig } from "../config/runtime";
import { getOptimizedImageUrl } from "../services/cloudinary";
import { http } from "../services/http";

type ArtistListItem = {
  id: number;
  name: string | null;
  email: string;
  profileImage: string | null;
  isVerified: boolean;
  subscriptionPrice: number;
  status: string;
  isDeleted?: boolean;
  deletedAt?: string | null;
  deletionReason?: string | null;
  agreementAccepted?: boolean;
  agreementVersion?: string | null;
  artistRevenueShare?: number | null;
  platformRevenueShare?: number | null;
  agreementId?: string | null;
  termsVersion?: string | null;
  agreementStatus?: string | null;
  agreementStartDate?: string | null;
  signatureSignedAt?: string | null;
  digitalSignature?: string | null;
};

type ArtistsListResponse = {
  success: boolean;
  items: ArtistListItem[];
  totalCount: number;
  totalPages: number;
};

function formatPrice(value: number) {
  const amount = Number(value);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
}

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

function safeHttpUrl(value: string | null | undefined) {
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

function safeSignatureUrl(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=\s]+$/i.test(raw)) {
    return raw;
  }
  return safeHttpUrl(raw);
}

function StatusBadge({ status, isDeleted }: { status: string; isDeleted?: boolean }) {
  const inactive =
    isDeleted || ["SUSPENDED", "INACTIVE"].includes(String(status || "").toUpperCase());
  return inactive ? (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/20 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-400">
      <UserX size={12} /> Inactive
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-green-500/20 bg-green-500/10 px-2.5 py-1 text-xs font-medium text-green-400">
      <UserCheck size={12} /> Active
    </span>
  );
}

function VerifiedBadge({ verified }: { verified: boolean }) {
  return verified ? (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-500/20 bg-blue-500/10 px-2.5 py-1 text-xs font-medium text-blue-400">
      <CheckCircle size={12} /> Verified
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-500/20 bg-gray-500/10 px-2.5 py-1 text-xs font-medium text-[#8D7B77]">
      <XCircle size={12} /> Unverified
    </span>
  );
}

function PremiumPagination({
  currentPage,
  totalPages,
  totalItems,
  itemsPerPage,
  onPageChange,
}: {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  const start = (currentPage - 1) * itemsPerPage + 1;
  const end = Math.min(currentPage * itemsPerPage, totalItems);
  const pages = Array.from({ length: totalPages }, (_, index) => index + 1).filter(
    (page) =>
      totalPages <= 7 ||
      page === 1 ||
      page === totalPages ||
      Math.abs(page - currentPage) <= 1
  );

  return (
    <div className="flex flex-col items-center justify-between gap-4 border-t border-white/5 bg-white/5 px-6 py-4 sm:flex-row">
      <div className="rounded-xl border border-white/5 bg-black/30 px-4 py-2 text-sm text-[#B8A6A1]">
        Showing <span className="font-semibold text-white">{start}</span> to{" "}
        <span className="font-semibold text-white">{end}</span> of{" "}
        <span className="font-semibold text-white">{totalItems}</span> artists
      </div>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => onPageChange(1)} disabled={currentPage === 1} aria-label="First page" className="h-10 w-10 rounded-xl border border-white/10 bg-black/20 text-[#B8A6A1] disabled:opacity-30">
          <ChevronsLeft size={16} className="mx-auto" />
        </button>
        <button type="button" onClick={() => onPageChange(currentPage - 1)} disabled={currentPage === 1} aria-label="Previous page" className="h-10 w-10 rounded-xl border border-white/10 bg-black/20 text-[#B8A6A1] disabled:opacity-30">
          <ChevronLeft size={16} className="mx-auto" />
        </button>
        {pages.map((page, index) => {
          const previous = pages[index - 1];
          return (
            <span key={page} className="flex items-center gap-1">
              {previous && page - previous > 1 && <span className="px-1 text-[#8D7B77]">…</span>}
              <button
                type="button"
                onClick={() => onPageChange(page)}
                className={`h-10 min-w-10 rounded-xl border px-2 text-sm font-medium ${
                  currentPage === page
                    ? "border-primary bg-primary text-white"
                    : "border-transparent text-[#B8A6A1] hover:border-white/10 hover:bg-white/10 hover:text-white"
                }`}
              >
                {page}
              </button>
            </span>
          );
        })}
        <button type="button" onClick={() => onPageChange(currentPage + 1)} disabled={currentPage === totalPages} aria-label="Next page" className="h-10 w-10 rounded-xl border border-white/10 bg-black/20 text-[#B8A6A1] disabled:opacity-30">
          <ChevronRight size={16} className="mx-auto" />
        </button>
        <button type="button" onClick={() => onPageChange(totalPages)} disabled={currentPage === totalPages} aria-label="Last page" className="h-10 w-10 rounded-xl border border-white/10 bg-black/20 text-[#B8A6A1] disabled:opacity-30">
          <ChevronsRight size={16} className="mx-auto" />
        </button>
      </div>
    </div>
  );
}

export default function AdminArtistsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [expandedArtistId, setExpandedArtistId] = useState<number | null>(null);
  const [actionBusyId, setActionBusyId] = useState<number | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [brokenSignatures, setBrokenSignatures] = useState<Record<number, boolean>>({});

  const page = Math.max(1, Number(searchParams.get("page") || "1") || 1);
  const limit = 10;
  const filter = (searchParams.get("filter") || "").trim();
  const query = searchParams.get("search") || "";
  const [search, setSearch] = useState(query);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => setSearch(query), [query]);
  useEffect(
    () => () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    },
    []
  );

  const artistsQuery = useQuery({
    queryKey: [
      "admin",
      "artists",
      { page, limit, filter: filter || "", search: query || "" },
    ] as const,
    queryFn: async () => {
      const response = await http.get<ArtistsListResponse>("/api/v1/admin/artists", {
        params: {
          page,
          limit,
          filter: filter || undefined,
          search: query || undefined,
        },
      });
      if (!response.data?.success) throw new Error("Failed to load artists");
      return response.data;
    },
    placeholderData: (previous: ArtistsListResponse | undefined) => previous,
  });

  const items = artistsQuery.data?.items ?? [];
  const totalPages = Math.max(1, artistsQuery.data?.totalPages ?? 1);
  const totalCount = artistsQuery.data?.totalCount ?? 0;

  useEffect(() => {
    if (!artistsQuery.isError) {
      setApiError(null);
      return;
    }
    const error: any = artistsQuery.error;
    const correlationId = error?.response?.data?.correlationId;
    const message =
      error?.response?.data?.message || error?.message || "Failed to load artists";
    setApiError(correlationId ? `${message} (Reference: ${correlationId})` : message);
  }, [artistsQuery.error, artistsQuery.isError]);

  const setPage = useCallback(
    (nextPage: number) => {
      const next: Record<string, string> = {};
      if (filter) next.filter = filter;
      if (search.trim()) next.search = search.trim();
      const bounded = Math.max(1, Math.min(totalPages, nextPage));
      if (bounded !== 1) next.page = String(bounded);
      setSearchParams(next);
    },
    [filter, search, setSearchParams, totalPages]
  );

  const setFilter = useCallback(
    (nextFilter: string) => {
      const next: Record<string, string> = {};
      const normalized = nextFilter.trim();
      if (normalized) next.filter = normalized;
      if (search.trim()) next.search = search.trim();
      setSearchParams(next);
    },
    [search, setSearchParams]
  );

  const onSearchChange = useCallback(
    (value: string) => {
      setSearch(value);
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        const next: Record<string, string> = {};
        if (filter) next.filter = filter;
        if (value.trim()) next.search = value.trim();
        setSearchParams(next);
      }, 250);
    },
    [filter, setSearchParams]
  );

  const runAgreementAction = async (
    artistId: number,
    path: string,
    body?: Record<string, unknown>
  ) => {
    if (actionBusyId !== null) return;
    setActionBusyId(artistId);
    setApiError(null);
    try {
      await http.patch(path, body ?? {});
      await artistsQuery.refetch();
    } catch (error: any) {
      const correlationId = error?.response?.data?.correlationId;
      const message =
        error?.response?.data?.message || error?.message || "Artist action failed";
      setApiError(correlationId ? `${message} (Reference: ${correlationId})` : message);
    } finally {
      setActionBusyId(null);
    }
  };

  const handleDownloadPdf = async (artistId: number) => {
    if (actionBusyId !== null) return;
    setActionBusyId(artistId);
    setApiError(null);
    let objectUrl: string | null = null;
    try {
      const response = await http.get(
        `/api/v1/admin/artists/${artistId}/agreement-pdf`,
        { responseType: "blob" }
      );
      objectUrl = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `agreement-${artistId}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error: any) {
      const correlationId = error?.response?.data?.correlationId;
      const message =
        error?.response?.data?.message || error?.message || "Failed to download agreement PDF";
      setApiError(correlationId ? `${message} (Reference: ${correlationId})` : message);
    } finally {
      if (objectUrl) window.URL.revokeObjectURL(objectUrl);
      setActionBusyId(null);
    }
  };

  return (
    <PageWrapper title="Artists" subtitle="Manage all artists on your platform">
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-white/5 bg-surface p-4">
          <div className="text-xs text-[#8D7B77]">Total Artists</div>
          <div className="mt-1 text-2xl font-bold text-white">{totalCount}</div>
        </div>
        <div className="rounded-xl border border-white/5 bg-surface p-4">
          <div className="flex items-center gap-2 text-xs text-[#8D7B77]"><UserCheck size={14} className="text-green-400" /> Active</div>
          <div className="mt-1 text-2xl font-bold text-white">{items.filter((artist) => !artist.isDeleted && !["SUSPENDED", "INACTIVE"].includes(String(artist.status).toUpperCase())).length}</div>
        </div>
        <div className="rounded-xl border border-white/5 bg-surface p-4">
          <div className="flex items-center gap-2 text-xs text-[#8D7B77]"><UserX size={14} className="text-red-400" /> Inactive</div>
          <div className="mt-1 text-2xl font-bold text-white">{items.filter((artist) => artist.isDeleted || ["SUSPENDED", "INACTIVE"].includes(String(artist.status).toUpperCase())).length}</div>
        </div>
        <div className="rounded-xl border border-white/5 bg-surface p-4">
          <div className="flex items-center gap-2 text-xs text-[#8D7B77]"><CheckCircle size={14} className="text-blue-400" /> Verified</div>
          <div className="mt-1 text-2xl font-bold text-white">{items.filter((artist) => artist.isVerified).length}</div>
        </div>
      </div>

      <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex flex-wrap items-center gap-2">
          {[
            ["", "All"],
            ["active", "Active"],
            ["inactive", "Inactive"],
            ["verified", "Verified"],
          ].map(([value, label]) => (
            <button
              key={label}
              type="button"
              onClick={() => setFilter(value)}
              className={`h-[38px] rounded-xl border px-4 text-sm font-medium transition-all ${
                filter === value
                  ? "border-primary/20 bg-primary/10 text-primary"
                  : "border-white/10 bg-white/5 text-[#8D7B77] hover:bg-white/10 hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-[280px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8D7B77]" />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search artists..."
            className="h-[38px] w-full rounded-xl border border-white/10 bg-white/5 pl-9 pr-4 text-sm text-white outline-none placeholder:text-[#8D7B77] focus:border-primary/50"
          />
        </div>
      </div>

      {apiError && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3">
          <XCircle size={18} className="mt-0.5 shrink-0 text-red-400" />
          <span className="flex-1 text-sm text-red-100/80">{apiError}</span>
          <button type="button" onClick={() => void artistsQuery.refetch()} disabled={artistsQuery.isFetching} className="rounded-lg border border-red-300/20 px-2.5 py-1 text-xs text-red-200 disabled:opacity-50">Retry</button>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-white/5 bg-surface">
        <div className="hidden grid-cols-[1.6fr_0.8fr_0.8fr_0.8fr_1.2fr] gap-4 border-b border-white/5 bg-white/5 px-6 py-4 text-xs font-medium uppercase tracking-wider text-[#8D7B77] md:grid">
          <div>Artist</div><div>Verified</div><div>Price</div><div>Status</div><div className="text-right">Action</div>
        </div>

        {artistsQuery.isLoading ? (
          <div className="space-y-4 px-6 py-6">
            {[0, 1, 2].map((value) => <Skeleton key={value} className="h-16 w-full rounded-xl" />)}
          </div>
        ) : items.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <div className="mb-3 inline-flex rounded-full bg-white/5 p-4"><Users size={24} className="text-[#8D7B77]" /></div>
            <p className="text-sm font-medium text-white">No artists found</p>
            <p className="mt-1 text-xs text-[#8D7B77]">Try adjusting your filters or search.</p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {items.map((artist) => {
              const expanded = expandedArtistId === artist.id;
              const profileUrl = safeHttpUrl(artist.profileImage);
              const signatureUrl = safeSignatureUrl(artist.digitalSignature);
              const busy = actionBusyId === artist.id;
              const agreementStatus = String(artist.agreementStatus || "").toUpperCase();

              return (
                <div key={artist.id}>
                  <div className={`flex flex-col items-start gap-4 px-6 py-4 transition-all md:grid md:grid-cols-[1.6fr_0.8fr_0.8fr_0.8fr_1.2fr] md:items-center ${expanded ? "bg-white/[0.02]" : "hover:bg-white/5"}`}>
                    <div className="flex w-full items-center gap-3">
                      <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full border border-white/10 bg-white/5">
                        {profileUrl ? (
                          <img src={getOptimizedImageUrl(profileUrl)} alt={artist.name ?? artist.email} className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[#8D7B77]"><User size={16} /></div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-white">{artist.name ?? "Unnamed Artist"}</p>
                        <div className="mt-0.5 flex items-center gap-1.5"><Mail size={12} className="text-[#8D7B77]" /><span className="truncate text-xs text-[#8D7B77]">{artist.email}</span></div>
                      </div>
                    </div>
                    <VerifiedBadge verified={Boolean(artist.isVerified)} />
                    <span className="text-sm text-white">{formatPrice(artist.subscriptionPrice)}</span>
                    <StatusBadge status={artist.status} isDeleted={artist.isDeleted} />
                    <div className="flex w-full items-center justify-end gap-2 md:w-auto">
                      <button type="button" onClick={() => setExpandedArtistId(expanded ? null : artist.id)} className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm ${expanded ? "border-primary bg-primary/10 text-primary" : "border-white/10 bg-white/5 text-[#8D7B77] hover:text-white"}`}>
                        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />} Agreement
                      </button>
                      <Link to={`/admin/artists/${artist.id}`} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-[#8D7B77] hover:text-white"><Eye size={14} /> Profile</Link>
                    </div>
                  </div>

                  {expanded && (
                    <div className="border-t border-white/5 bg-white/[0.01] px-6 pb-6 pt-4">
                      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                        <section className="space-y-4">
                          <div className="flex items-center gap-2"><FileText size={16} className="text-primary" /><h4 className="text-xs font-bold uppercase tracking-wider text-white">Agreement & Terms Details</h4></div>
                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                            <div className="rounded-xl border border-white/5 bg-black/35 p-3"><div className="text-[10px] uppercase text-[#8D7B77]">Status</div><div className="mt-1 text-xs font-semibold text-white">{agreementStatus || (artist.agreementAccepted ? "ACTIVE" : "NOT SIGNED")}</div></div>
                            <div className="rounded-xl border border-white/5 bg-black/35 p-3"><div className="text-[10px] uppercase text-[#8D7B77]">Artist Share</div><div className="mt-1 text-sm font-bold text-primary">{artist.artistRevenueShare ?? (100 - (artist.platformRevenueShare ?? 10))}%</div></div>
                            <div className="rounded-xl border border-white/5 bg-black/35 p-3"><div className="text-[10px] uppercase text-[#8D7B77]">Platform Share</div><div className="mt-1 text-sm font-bold text-secondary">{artist.platformRevenueShare ?? 10}%</div></div>
                            <div className="rounded-xl border border-white/5 bg-black/35 p-3"><div className="text-[10px] uppercase text-[#8D7B77]">Agreement</div><div className="mt-1 text-xs text-white">{artist.agreementVersion || "—"}</div></div>
                            <div className="rounded-xl border border-white/5 bg-black/35 p-3"><div className="text-[10px] uppercase text-[#8D7B77]">Terms</div><div className="mt-1 text-xs text-white">{artist.termsVersion || "—"}</div></div>
                            <div className="rounded-xl border border-white/5 bg-black/35 p-3"><div className="text-[10px] uppercase text-[#8D7B77]">Agreement ID</div><div className="mt-1 truncate font-mono text-xs text-white" title={artist.agreementId || undefined}>{artist.agreementId || "—"}</div></div>
                          </div>
                          <div className="space-y-1.5 rounded-xl border border-white/5 bg-white/[0.02] p-3.5 text-xs text-[#8D7B77]">
                            <div className="flex justify-between"><span>Accepted</span><span className="text-white">{artist.agreementAccepted ? "Yes" : "No"}</span></div>
                            <div className="flex justify-between"><span>Start date</span><span className="text-white">{formatDateTime(artist.agreementStartDate)}</span></div>
                            <div className="flex justify-between"><span>Signature timestamp</span><span className="text-white">{formatDateTime(artist.signatureSignedAt)}</span></div>
                          </div>
                        </section>

                        <section className="space-y-4">
                          <div className="flex items-center gap-2"><CheckCircle size={16} className="text-purple-400" /><h4 className="text-xs font-bold uppercase tracking-wider text-white">Digital Signature</h4></div>
                          {signatureUrl && !brokenSignatures[artist.id] ? (
                            <div className="flex h-[115px] flex-col items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black/40 p-3.5">
                              <img src={signatureUrl} alt="Digital signature" className="max-h-[95px] max-w-full object-contain" onError={() => setBrokenSignatures((previous) => ({ ...previous, [artist.id]: true }))} />
                            </div>
                          ) : (
                            <div className="flex h-[115px] flex-col items-center justify-center rounded-xl border border-yellow-500/10 bg-yellow-500/5 p-6"><AlertTriangle className="mb-1 h-6 w-6 text-yellow-500" /><p className="text-xs font-semibold text-yellow-500">Signature Not Available</p></div>
                          )}

                          <div className="flex flex-wrap gap-2.5 pt-2">
                            <button type="button" onClick={() => void handleDownloadPdf(artist.id)} disabled={!artist.agreementAccepted || actionBusyId !== null} className="h-[38px] flex-1 rounded-lg border border-primary/30 bg-primary/10 text-xs font-semibold text-primary disabled:opacity-30"><Download size={14} className="mr-1 inline" />{busy ? "Working…" : "Agreement PDF"}</button>

                            {agreementStatus === "PENDING_APPROVAL" && (
                              <>
                                <button type="button" disabled={actionBusyId !== null} onClick={() => void runAgreementAction(artist.id, `/api/v1/admin/artists/${artist.id}/approve-agreement`)} className="h-[38px] flex-1 rounded-lg bg-emerald-600 text-xs font-bold text-white disabled:opacity-50">{busy ? "Working…" : "Approve"}</button>
                                <button type="button" disabled={actionBusyId !== null} onClick={() => {
                                  const reason = window.prompt("Please enter rejection reason (3–500 characters):");
                                  const trimmed = reason?.trim() || "";
                                  if (!trimmed) return;
                                  if (trimmed.length < 3 || trimmed.length > 500) {
                                    setApiError("Agreement rejection reason must be 3–500 characters.");
                                    return;
                                  }
                                  void runAgreementAction(artist.id, `/api/v1/admin/artists/${artist.id}/reject-agreement`, { reason: trimmed });
                                }} className="h-[38px] flex-1 rounded-lg bg-red-600 text-xs font-bold text-white disabled:opacity-50">Reject</button>
                              </>
                            )}

                            {agreementStatus === "ACTIVE" && (
                              <button type="button" disabled={actionBusyId !== null} onClick={() => {
                                if (!window.confirm("Suspend this agreement?")) return;
                                void runAgreementAction(artist.id, `/api/v1/admin/artists/${artist.id}/agreement-status`, { status: "SUSPENDED" });
                              }} className="h-[38px] flex-1 rounded-lg bg-amber-600 text-xs font-bold text-white disabled:opacity-50">{busy ? "Working…" : "Suspend"}</button>
                            )}

                            {agreementStatus === "SUSPENDED" && (
                              <button type="button" disabled={actionBusyId !== null} onClick={() => void runAgreementAction(artist.id, `/api/v1/admin/artists/${artist.id}/agreement-status`, { status: "ACTIVE" })} className="h-[38px] flex-1 rounded-lg bg-emerald-600 text-xs font-bold text-white disabled:opacity-50">{busy ? "Working…" : "Activate"}</button>
                            )}
                          </div>
                        </section>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {totalCount > 0 && (
          <PremiumPagination currentPage={page} totalPages={totalPages} totalItems={totalCount} itemsPerPage={limit} onPageChange={setPage} />
        )}
      </div>
    </PageWrapper>
  );
}
