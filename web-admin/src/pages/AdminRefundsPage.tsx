import { AlertTriangle, CheckCircle2, RefreshCw, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import PageWrapper from "../components/PageWrapper";
import { http } from "../services/http";
import { getPrivilegedRole } from "../services/adminSession";

type RefundRequestSummary = {
  id: string;
  status: string;
  providerRefundId: string | null;
  providerStatus: string | null;
  failureCode: string | null;
  updatedAt: string | null;
};

type PaymentRow = {
  paymentId: string;
  gatewayPaymentId: string;
  userId: number;
  subscriptionId: number;
  artistId: number;
  artistName: string;
  amount: number;
  currency: string;
  paymentStatus: string;
  subscriptionStatus: string;
  capturedAt: string | null;
  refundAmount: number;
  refundStatus: string | null;
  refundRequest: RefundRequestSummary | null;
};

function money(amountPaise: number, currency: string) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: currency || "INR",
  }).format((Number(amountPaise) || 0) / 100);
}

function badgeClass(status: string) {
  const value = String(status || "").toUpperCase();
  if (["SUCCESS", "COMPLETED", "ACTIVE", "REFUNDED"].includes(value)) {
    return "bg-green-500/10 text-green-300 border-green-500/20";
  }
  if (["FAILED", "CANCELLED"].includes(value)) {
    return "bg-red-500/10 text-red-300 border-red-500/20";
  }
  return "bg-amber-500/10 text-amber-300 border-amber-500/20";
}

export default function AdminRefundsPage() {
  const role = getPrivilegedRole();
  const [items, setItems] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await http.get("/api/v1/admin/refunds/payments?limit=100");
      setItems(Array.isArray(response.data?.items) ? response.data.items : []);
    } catch (e: any) {
      setError(e?.response?.data?.message || "Unable to load payments and refunds");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    return {
      captured: items.filter((item) => item.paymentStatus === "SUCCESS").length,
      completed: items.filter((item) => item.refundRequest?.status === "COMPLETED").length,
      attention: items.filter((item) =>
        ["GATEWAY_REQUESTED", "PROVIDER_PENDING", "RECONCILIATION_REQUIRED", "FAILED"].includes(
          item.refundRequest?.status || ""
        )
      ).length,
    };
  }, [items]);

  const initiate = async (payment: PaymentRow) => {
    if (!window.confirm(`Issue a full refund of ${money(payment.amount, payment.currency)}?`)) return;
    setWorkingId(payment.paymentId);
    setError(null);
    setNotice(null);
    try {
      const response = await http.post(
        `/api/v1/admin/refunds/payments/${encodeURIComponent(payment.paymentId)}`,
        {}
      );
      const status = response.data?.refund?.status || "REQUESTED";
      setNotice(`Refund ${status.toLowerCase().replace(/_/g, " ")}.`);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message || "Refund request failed");
      await load();
    } finally {
      setWorkingId(null);
    }
  };

  const reconcile = async (request: RefundRequestSummary) => {
    setWorkingId(request.id);
    setError(null);
    setNotice(null);
    try {
      const response = await http.post(
        `/api/v1/admin/refunds/${encodeURIComponent(request.id)}/reconcile`,
        {}
      );
      const status = response.data?.refund?.status || "UNKNOWN";
      setNotice(`Reconciliation result: ${status}.`);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message || "Refund reconciliation failed");
      await load();
    } finally {
      setWorkingId(null);
    }
  };

  return (
    <PageWrapper
      title="Refund Management"
      subtitle="Review captured payments, initiate server-authoritative full refunds, and track provider reconciliation"
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="rounded-2xl border border-white/5 bg-surface p-5">
          <div className="text-sm text-white/50">Captured payments</div>
          <div className="text-3xl font-semibold mt-2">{stats.captured}</div>
        </div>
        <div className="rounded-2xl border border-white/5 bg-surface p-5">
          <div className="text-sm text-white/50">Completed refunds</div>
          <div className="text-3xl font-semibold mt-2 text-green-300">{stats.completed}</div>
        </div>
        <div className="rounded-2xl border border-white/5 bg-surface p-5">
          <div className="text-sm text-white/50">Needs attention</div>
          <div className="text-3xl font-semibold mt-2 text-amber-300">{stats.attention}</div>
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
            <div className="font-semibold">Payment & refund ledger</div>
            <div className="text-xs text-white/45 mt-1">
              Refund amount is always derived from the captured payment. Partial refund is not available in Phase 1.
            </div>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 disabled:opacity-50"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="p-10 text-center text-white/50">Loading payment history…</div>
        ) : items.length === 0 ? (
          <div className="p-10 text-center text-white/50">No payments found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-white/[0.03] text-white/50 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Payment</th>
                  <th className="px-4 py-3 font-medium">Artist</th>
                  <th className="px-4 py-3 font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Payment</th>
                  <th className="px-4 py-3 font-medium">Entitlement</th>
                  <th className="px-4 py-3 font-medium">Refund</th>
                  <th className="px-4 py-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const request = item.refundRequest;
                  const canRefund = item.paymentStatus === "SUCCESS" && !request;
                  const canReconcile =
                    role === "ADMIN" &&
                    request &&
                    ["GATEWAY_REQUESTED", "PROVIDER_PENDING", "RECONCILIATION_REQUIRED"].includes(
                      request.status
                    );
                  const busy = workingId === item.paymentId || workingId === request?.id;

                  return (
                    <tr key={item.paymentId} className="border-t border-white/5 align-top">
                      <td className="px-4 py-4">
                        <div className="font-mono text-xs text-white/80">{item.gatewayPaymentId}</div>
                        <div className="text-xs text-white/40 mt-1">Local: {item.paymentId}</div>
                        <div className="text-xs text-white/40 mt-1">User #{item.userId}</div>
                      </td>
                      <td className="px-4 py-4">
                        <div>{item.artistName}</div>
                        <div className="text-xs text-white/40">Artist #{item.artistId}</div>
                      </td>
                      <td className="px-4 py-4 font-medium">{money(item.amount, item.currency)}</td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex rounded-full border px-2 py-1 text-xs ${badgeClass(item.paymentStatus)}`}>
                          {item.paymentStatus}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex rounded-full border px-2 py-1 text-xs ${badgeClass(item.subscriptionStatus)}`}>
                          {item.subscriptionStatus}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        {request ? (
                          <div className="space-y-1">
                            <span className={`inline-flex rounded-full border px-2 py-1 text-xs ${badgeClass(request.status)}`}>
                              {request.status}
                            </span>
                            {request.providerRefundId && (
                              <div className="font-mono text-xs text-white/45">{request.providerRefundId}</div>
                            )}
                            {request.failureCode && (
                              <div className="text-xs text-red-300">{request.failureCode}</div>
                            )}
                          </div>
                        ) : (
                          <span className="text-white/35">—</span>
                        )}
                      </td>
                      <td className="px-4 py-4 text-right">
                        {canRefund && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void initiate(item)}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-white hover:opacity-90 disabled:opacity-50"
                          >
                            <RotateCcw size={15} />
                            Full refund
                          </button>
                        )}
                        {canReconcile && request && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void reconcile(request)}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-500/20 bg-amber-500/10 text-amber-200 hover:bg-amber-500/15 disabled:opacity-50"
                          >
                            <RefreshCw size={15} className={busy ? "animate-spin" : ""} />
                            Reconcile
                          </button>
                        )}
                        {!canRefund && !canReconcile && (
                          <span className="text-xs text-white/35">No action</span>
                        )}
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
