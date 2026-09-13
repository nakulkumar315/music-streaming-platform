import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Flag,
  Music,
  RefreshCw,
  ShieldAlert,
  Video,
  XCircle,
} from "lucide-react";
import PageWrapper from "../components/PageWrapper";
import { http } from "../services/http";

type ModerationItem = {
  id: number;
  title: string;
  type: string;
  genre: string | null;
  lifecycleState: string;
  technicalStatus: string;
  isApproved: boolean;
  isTakenDown: boolean;
  rejectionReason?: string | null;
  reportCount?: number;
  reasons?: Array<{ reason: string; count: number }>;
  artist: { id: number; name: string | null };
  createdAt: string;
  uploadedAt?: string | null;
  publishedAt?: string | null;
};

const pendingKey = ["admin", "content", "pending"] as const;
const reportedKey = ["admin", "content", "reported"] as const;

function technicalClass(status: string) {
  if (status === "READY") return "border-green-500/20 bg-green-500/10 text-green-300";
  if (status === "FAILED") return "border-red-500/20 bg-red-500/10 text-red-300";
  return "border-amber-500/20 bg-amber-500/10 text-amber-300";
}

function MediaIcon({ type }: { type: string }) {
  return type === "VIDEO" ? <Video size={17} /> : <Music size={17} />;
}

export default function AdminContentApprovalQueuePage() {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pending = useQuery({
    queryKey: pendingKey,
    queryFn: async () => {
      const response = await http.get("/api/v1/admin/content/pending", { params: { limit: 100 } });
      return (Array.isArray(response.data?.items) ? response.data.items : []) as ModerationItem[];
    },
  });

  const reported = useQuery({
    queryKey: reportedKey,
    queryFn: async () => {
      const response = await http.get("/api/v1/admin/content/reported", { params: { limit: 100 } });
      return (Array.isArray(response.data?.items) ? response.data.items : []) as ModerationItem[];
    },
  });

  const refreshAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: pendingKey }),
      queryClient.invalidateQueries({ queryKey: reportedKey }),
    ]);
  };

  const approve = useMutation({
    mutationFn: async (id: number) => {
      await http.patch(`/api/v1/admin/content/${id}/approve`, {});
      return id;
    },
    onSuccess: async () => {
      setError(null);
      setNotice("Content approved for early access.");
      await refreshAll();
    },
    onError: (e: any) => {
      setNotice(null);
      setError(e?.response?.data?.message || "Approval failed");
    },
  });

  const reject = useMutation({
    mutationFn: async ({ id, reason }: { id: number; reason: string }) => {
      await http.patch(`/api/v1/admin/content/${id}/reject`, { reason });
      return id;
    },
    onSuccess: async () => {
      setError(null);
      setNotice("Content rejection recorded.");
      await refreshAll();
    },
    onError: (e: any) => {
      setNotice(null);
      setError(e?.response?.data?.message || "Rejection failed");
    },
  });

  const takedown = useMutation({
    mutationFn: async ({ id, reason }: { id: number; reason: string }) => {
      await http.post(`/api/v1/admin/content/${id}/takedown`, { reason });
      return id;
    },
    onSuccess: async () => {
      setError(null);
      setNotice("Content taken down. New fan discovery and playback access are blocked immediately.");
      await refreshAll();
    },
    onError: (e: any) => {
      setNotice(null);
      setError(e?.response?.data?.message || "Takedown failed");
    },
  });

  const requestReason = (
    label: string,
    item: ModerationItem,
    onValid: (reason: string) => void,
    initial = ""
  ) => {
    const reason = window.prompt(`${label} “${item.title}” (3–500 characters):`, initial);
    if (reason === null) return;
    const trimmed = reason.trim();
    if (trimmed.length < 3 || trimmed.length > 500) {
      setError("Reason must be 3–500 characters.");
      return;
    }
    onValid(trimmed);
  };

  const draftItems = pending.data ?? [];
  const reportedItems = reported.data ?? [];
  const ready = draftItems.filter((item) => item.technicalStatus === "READY").length;
  const processing = draftItems.filter((item) => ["UPLOADING", "PROCESSING"].includes(item.technicalStatus)).length;
  const failed = draftItems.filter((item) => item.technicalStatus === "FAILED").length;
  const totalReports = reportedItems.reduce((sum, item) => sum + Number(item.reportCount || 0), 0);

  return (
    <PageWrapper
      title="Content Moderation"
      subtitle="Approve admin-uploaded DRAFT content and review fan-reported live releases."
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="rounded-2xl border border-white/5 bg-surface p-5">
          <div className="text-sm text-white/50">Ready for review</div>
          <div className="text-3xl font-semibold mt-2 text-green-300">{ready}</div>
        </div>
        <div className="rounded-2xl border border-white/5 bg-surface p-5">
          <div className="text-sm text-white/50">Processing</div>
          <div className="text-3xl font-semibold mt-2 text-amber-300">{processing}</div>
        </div>
        <div className="rounded-2xl border border-white/5 bg-surface p-5">
          <div className="text-sm text-white/50">Upload failed</div>
          <div className="text-3xl font-semibold mt-2 text-red-300">{failed}</div>
        </div>
        <div className="rounded-2xl border border-white/5 bg-surface p-5">
          <div className="text-sm text-white/50">Open fan reports</div>
          <div className="text-3xl font-semibold mt-2 text-orange-300">{totalReports}</div>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-red-200">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="mb-4 flex gap-2 rounded-xl border border-green-500/20 bg-green-500/10 p-4 text-green-200">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      <div className="mb-6 overflow-hidden rounded-2xl border border-white/5 bg-surface">
        <div className="flex items-center justify-between gap-4 border-b border-white/5 px-5 py-4">
          <div>
            <div className="font-semibold">Draft review queue</div>
            <div className="mt-1 text-xs text-white/45">
              Technical readiness never publishes automatically. Approval moves DRAFT → EARLY_ACCESS.
            </div>
          </div>
          <button
            type="button"
            onClick={() => void pending.refetch()}
            disabled={pending.isFetching}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 hover:bg-white/10 disabled:opacity-50"
          >
            <RefreshCw size={16} className={pending.isFetching ? "animate-spin" : ""} /> Refresh
          </button>
        </div>

        {pending.isLoading ? (
          <div className="p-10 text-center text-white/50">Loading draft content…</div>
        ) : pending.isError ? (
          <div className="p-10 text-center text-red-300">Unable to load draft queue.</div>
        ) : draftItems.length === 0 ? (
          <div className="p-10 text-center text-white/50">No DRAFT content awaiting review.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-white/[0.03] text-left text-white/50">
                <tr>
                  <th className="px-4 py-3 font-medium">Release</th>
                  <th className="px-4 py-3 font-medium">Artist</th>
                  <th className="px-4 py-3 font-medium">Technical state</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {draftItems.map((item) => {
                  const busy =
                    (approve.isPending && approve.variables === item.id) ||
                    (reject.isPending && reject.variables?.id === item.id);
                  const canApprove = item.technicalStatus === "READY" && !item.isTakenDown;
                  return (
                    <tr key={item.id} className="border-t border-white/5 align-top">
                      <td className="px-4 py-4">
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 rounded-lg bg-white/5 p-2"><MediaIcon type={item.type} /></div>
                          <div>
                            <div className="font-medium text-white">{item.title}</div>
                            <div className="mt-1 text-xs text-white/40">#{item.id}{item.genre ? ` · ${item.genre}` : ""} · DRAFT</div>
                            {item.rejectionReason && (
                              <div className="mt-1 text-xs text-red-300">Previous rejection: {item.rejectionReason}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div>{item.artist?.name || `Artist #${item.artist?.id}`}</div>
                        <div className="text-xs text-white/40">ID #{item.artist?.id}</div>
                      </td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex rounded-full border px-2 py-1 text-xs ${technicalClass(item.technicalStatus)}`}>
                          {item.technicalStatus === "PROCESSING" && <Clock3 size={12} className="mr-1" />}
                          {item.technicalStatus}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-white/60">{item.createdAt ? new Date(item.createdAt).toLocaleString() : "—"}</td>
                      <td className="px-4 py-4">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            disabled={busy || !canApprove}
                            title={!canApprove ? "Media must be READY before approval" : "Approve for early access"}
                            onClick={() => approve.mutate(item.id)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-green-500/20 bg-green-500/15 px-3 py-2 text-green-200 disabled:opacity-40"
                          >
                            <CheckCircle2 size={15} /> Approve
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => requestReason("Reason for rejecting", item, (reason) => reject.mutate({ id: item.id, reason }), item.rejectionReason || "")}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-red-200 disabled:opacity-40"
                          >
                            <XCircle size={15} /> Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/5 bg-surface">
        <div className="flex items-center justify-between gap-4 border-b border-white/5 px-5 py-4">
          <div>
            <div className="flex items-center gap-2 font-semibold"><Flag size={16} className="text-orange-300" /> Reported live content</div>
            <div className="mt-1 text-xs text-white/45">Fan reports never auto-takedown content. A privileged moderator must review and act.</div>
          </div>
          <button
            type="button"
            onClick={() => void reported.refetch()}
            disabled={reported.isFetching}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 hover:bg-white/10 disabled:opacity-50"
          >
            <RefreshCw size={16} className={reported.isFetching ? "animate-spin" : ""} /> Refresh
          </button>
        </div>

        {reported.isLoading ? (
          <div className="p-10 text-center text-white/50">Loading reported content…</div>
        ) : reported.isError ? (
          <div className="p-10 text-center text-red-300">Unable to load reported content.</div>
        ) : reportedItems.length === 0 ? (
          <div className="p-10 text-center text-white/50">No live content currently has fan reports.</div>
        ) : (
          <div className="divide-y divide-white/5">
            {reportedItems.map((item) => {
              const busy = takedown.isPending && takedown.variables?.id === item.id;
              return (
                <div key={item.id} className="p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="rounded-lg bg-orange-500/10 p-2 text-orange-300"><MediaIcon type={item.type} /></div>
                      <div>
                        <div className="font-medium text-white">{item.title}</div>
                        <div className="mt-1 text-xs text-white/45">
                          #{item.id} · {item.artist?.name || `Artist #${item.artist?.id}`} · {item.reportCount || 0} report(s)
                        </div>
                        {!!item.reasons?.length && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {item.reasons.map((reason, index) => (
                              <span key={`${reason.reason}-${index}`} className="rounded-full border border-orange-500/20 bg-orange-500/10 px-2.5 py-1 text-xs text-orange-200">
                                {reason.reason}: {reason.count}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => requestReason("Reason for taking down", item, (reason) => takedown.mutate({ id: item.id, reason }))}
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-200 disabled:opacity-40"
                    >
                      <ShieldAlert size={15} /> Take down
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </PageWrapper>
  );
}
