import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock3, Music, RefreshCw, Video, XCircle } from "lucide-react";
import PageWrapper from "../components/PageWrapper";
import { http } from "../services/http";

type PendingContent = {
  id: number;
  title: string;
  type: string;
  genre: string | null;
  lifecycleState: string;
  technicalStatus: string;
  isApproved: boolean;
  isTakenDown: boolean;
  rejectionReason: string | null;
  artist: { id: number; name: string | null };
  createdAt: string;
  uploadedAt: string | null;
};

const queryKey = ["admin", "content", "pending"] as const;

function statusClass(status: string) {
  if (status === "READY") return "border-green-500/20 bg-green-500/10 text-green-300";
  if (status === "FAILED") return "border-red-500/20 bg-red-500/10 text-red-300";
  return "border-amber-500/20 bg-amber-500/10 text-amber-300";
}

export default function AdminContentApprovalQueuePage() {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pending = useQuery({
    queryKey,
    queryFn: async () => {
      const response = await http.get("/api/v1/admin/content/pending", {
        params: { limit: 100 },
      });
      return (Array.isArray(response.data?.items) ? response.data.items : []) as PendingContent[];
    },
  });

  const approve = useMutation({
    mutationFn: async (id: number) => {
      await http.patch(`/api/v1/admin/content/${id}/approve`, {});
      return id;
    },
    onSuccess: async () => {
      setError(null);
      setNotice("Content approved for early access.");
      await queryClient.invalidateQueries({ queryKey });
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
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (e: any) => {
      setNotice(null);
      setError(e?.response?.data?.message || "Rejection failed");
    },
  });

  const requestReject = (item: PendingContent) => {
    const reason = window.prompt(
      `Reason for rejecting “${item.title}” (3–500 characters):`,
      item.rejectionReason || ""
    );
    if (reason === null) return;
    const trimmed = reason.trim();
    if (trimmed.length < 3 || trimmed.length > 500) {
      setError("Rejection reason must be 3–500 characters.");
      return;
    }
    reject.mutate({ id: item.id, reason: trimmed });
  };

  const items = pending.data ?? [];
  const ready = items.filter((item) => item.technicalStatus === "READY").length;
  const processing = items.filter((item) => ["UPLOADING", "PROCESSING"].includes(item.technicalStatus)).length;
  const failed = items.filter((item) => item.technicalStatus === "FAILED").length;

  return (
    <PageWrapper
      title="Content Moderation"
      subtitle="Review DRAFT releases. Approval is allowed only after media processing is READY."
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
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
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-red-200 flex gap-2">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-xl border border-green-500/20 bg-green-500/10 p-4 text-green-200 flex gap-2">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      <div className="rounded-2xl border border-white/5 bg-surface overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between gap-4">
          <div>
            <div className="font-semibold">Draft review queue</div>
            <div className="text-xs text-white/45 mt-1">
              Technical readiness never publishes automatically. Approval moves DRAFT → EARLY_ACCESS.
            </div>
          </div>
          <button
            type="button"
            onClick={() => void pending.refetch()}
            disabled={pending.isFetching}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 disabled:opacity-50"
          >
            <RefreshCw size={16} className={pending.isFetching ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        {pending.isLoading ? (
          <div className="p-10 text-center text-white/50">Loading draft content…</div>
        ) : pending.isError ? (
          <div className="p-10 text-center text-red-300">Unable to load moderation queue.</div>
        ) : items.length === 0 ? (
          <div className="p-10 text-center text-white/50">No DRAFT content awaiting review.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-white/[0.03] text-white/50 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Release</th>
                  <th className="px-4 py-3 font-medium">Artist</th>
                  <th className="px-4 py-3 font-medium">Technical state</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const busy =
                    (approve.isPending && approve.variables === item.id) ||
                    (reject.isPending && reject.variables?.id === item.id);
                  const canApprove = item.technicalStatus === "READY" && !item.isTakenDown;
                  return (
                    <tr key={item.id} className="border-t border-white/5 align-top">
                      <td className="px-4 py-4">
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 rounded-lg bg-white/5 p-2">
                            {item.type === "VIDEO" ? <Video size={17} /> : <Music size={17} />}
                          </div>
                          <div>
                            <div className="font-medium text-white">{item.title}</div>
                            <div className="text-xs text-white/40 mt-1">
                              #{item.id}{item.genre ? ` · ${item.genre}` : ""} · DRAFT
                            </div>
                            {item.rejectionReason && (
                              <div className="text-xs text-red-300 mt-1">Previous rejection: {item.rejectionReason}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div>{item.artist?.name || `Artist #${item.artist?.id}`}</div>
                        <div className="text-xs text-white/40">ID #{item.artist?.id}</div>
                      </td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex rounded-full border px-2 py-1 text-xs ${statusClass(item.technicalStatus)}`}>
                          {item.technicalStatus === "PROCESSING" && <Clock3 size={12} className="mr-1" />}
                          {item.technicalStatus}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-white/60">
                        {item.createdAt ? new Date(item.createdAt).toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            disabled={busy || !canApprove}
                            title={!canApprove ? "Media must be READY before approval" : "Approve for early access"}
                            onClick={() => approve.mutate(item.id)}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-green-500/15 text-green-200 border border-green-500/20 disabled:opacity-40"
                          >
                            <CheckCircle2 size={15} /> Approve
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => requestReject(item)}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-500/10 text-red-200 border border-red-500/20 disabled:opacity-40"
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
    </PageWrapper>
  );
}
