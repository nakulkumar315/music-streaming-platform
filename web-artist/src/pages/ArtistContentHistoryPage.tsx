import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle,
  Clock3,
  History,
  Music,
  Search,
  ShieldAlert,
  Video,
} from "lucide-react";
import { http } from "../services/http";
import Skeleton from "../components/Skeleton";

type ContentItem = {
  id: number;
  title: string;
  type: string;
  genre: string | null;
  lifecycleState: "DRAFT" | "EARLY_ACCESS" | string;
  technicalStatus: "UPLOADING" | "PROCESSING" | "READY" | "FAILED" | string;
  isApproved: boolean;
  isTakenDown: boolean;
  rejectionReason: string | null;
  subscriptionRequired: boolean;
  hasArtwork: boolean;
  hasAudio: boolean;
  hasVideo: boolean;
  totalPlays: number;
  createdAt: string;
  publishedAt: string | null;
};

type MineResponse = {
  success: boolean;
  items?: ContentItem[];
  message?: string;
};

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function badgeClass(kind: "success" | "warning" | "danger" | "neutral") {
  if (kind === "success") return "border-emerald-500/25 bg-emerald-500/10 text-emerald-300";
  if (kind === "warning") return "border-amber-500/25 bg-amber-500/10 text-amber-300";
  if (kind === "danger") return "border-rose-500/25 bg-rose-500/10 text-rose-300";
  return "border-white/10 bg-white/5 text-[#B8A6A1]";
}

export default function ArtistContentHistoryPage() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"ALL" | "AUDIO" | "VIDEO">("ALL");

  const query = useQuery({
    queryKey: ["artist", "content", "mine"],
    queryFn: async () => {
      const response = await http.get<MineResponse>("/api/v1/content/mine");
      if (!response.data?.success) {
        throw new Error(response.data?.message || "Failed to load content");
      }
      return Array.isArray(response.data.items) ? response.data.items : [];
    },
  });

  const items = query.data ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (filter === "AUDIO" && !item.hasAudio) return false;
      if (filter === "VIDEO" && !item.hasVideo) return false;
      if (!q) return true;
      return `${item.title} ${item.genre || ""}`.toLowerCase().includes(q);
    });
  }, [filter, items, search]);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-white/10 bg-surface p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-xl border border-primary/30 bg-primary/10 p-2.5 text-primary">
              <History size={20} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">My Content</h1>
              <p className="mt-1 text-sm text-[#B8A6A1]">
                Read-only Phase 1 view of content uploaded and governed by the platform team.
              </p>
            </div>
          </div>
          <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-[#B8A6A1]">
            {items.length} {items.length === 1 ? "item" : "items"}
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="relative w-full md:max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8D7B77]" size={16} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search title or genre"
              className="w-full rounded-xl border border-white/10 bg-black/20 py-2.5 pl-10 pr-3 text-sm text-white outline-none focus:border-primary/50"
            />
          </div>
          <div className="flex gap-2">
            {(["ALL", "AUDIO", "VIDEO"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                  filter === value
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-white/10 bg-white/5 text-[#B8A6A1] hover:text-white"
                }`}
              >
                {value === "ALL" ? "All" : value === "AUDIO" ? "Audio" : "Video"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {query.isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((value) => (
            <Skeleton key={value} className="h-28 w-full rounded-2xl" />
          ))}
        </div>
      ) : query.isError ? (
        <div className="rounded-2xl border border-rose-500/25 bg-rose-500/10 p-5 text-sm text-rose-300">
          {(query.error as any)?.response?.data?.message || (query.error as any)?.message || "Failed to load content"}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-surface p-10 text-center text-[#B8A6A1]">
          No content matches this view.
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => {
            const technicalKind =
              item.technicalStatus === "READY"
                ? "success"
                : item.technicalStatus === "FAILED"
                ? "danger"
                : "warning";
            const businessKind = item.isTakenDown
              ? "danger"
              : item.lifecycleState === "EARLY_ACCESS" && item.isApproved
              ? "success"
              : "neutral";

            return (
              <div key={item.id} className="rounded-2xl border border-white/10 bg-surface p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {item.hasVideo ? <Video size={17} className="text-primary" /> : <Music size={17} className="text-primary" />}
                      <h2 className="truncate font-semibold text-white">{item.title}</h2>
                      <span className="text-xs text-[#8D7B77]">#{item.id}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      <span className={`rounded-full border px-2.5 py-1 ${badgeClass(technicalKind)}`}>
                        Technical: {item.technicalStatus}
                      </span>
                      <span className={`rounded-full border px-2.5 py-1 ${badgeClass(businessKind)}`}>
                        {item.isTakenDown ? "TAKEN DOWN" : `Business: ${item.lifecycleState}`}
                      </span>
                      {item.subscriptionRequired && (
                        <span className={`rounded-full border px-2.5 py-1 ${badgeClass("neutral")}`}>
                          Subscriber only
                        </span>
                      )}
                    </div>
                    {item.rejectionReason && (
                      <div className="mt-3 flex items-start gap-2 text-sm text-rose-300">
                        <AlertCircle size={15} className="mt-0.5 shrink-0" />
                        <span>{item.rejectionReason}</span>
                      </div>
                    )}
                  </div>

                  <div className="grid min-w-[280px] grid-cols-2 gap-3 text-sm">
                    <div className="rounded-xl border border-white/5 bg-black/20 p-3">
                      <div className="flex items-center gap-1.5 text-xs text-[#8D7B77]">
                        <Clock3 size={13} /> Created
                      </div>
                      <div className="mt-1 text-white">{formatDate(item.createdAt)}</div>
                    </div>
                    <div className="rounded-xl border border-white/5 bg-black/20 p-3">
                      <div className="flex items-center gap-1.5 text-xs text-[#8D7B77]">
                        {item.isTakenDown ? <ShieldAlert size={13} /> : <CheckCircle size={13} />}
                        Plays
                      </div>
                      <div className="mt-1 text-white">{item.totalPlays}</div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
