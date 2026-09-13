import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle,
  Clock,
  Loader2,
  Music2,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import ErrorBoundary from "../components/ErrorBoundary";
import { http } from "../services/http";

type PricingResponse = {
  success: boolean;
  subscriptionPrice?: number;
  yearlySubscriptionPrice?: number;
  earlyAccessDays?: number;
  subscriptionFeatures?: string[];
  message?: string;
  correlationId?: string;
};

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-white/10 ${className}`} />;
}

function PricingPageSkeleton() {
  return (
    <div className="w-full min-h-screen px-4 py-6 sm:px-8 sm:py-8 lg:px-10 lg:py-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-4 w-[420px] max-w-full" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Skeleton className="h-72 lg:col-span-2" />
          <Skeleton className="h-72" />
        </div>
      </div>
    </div>
  );
}

function hasAtMostTwoDecimals(value: number) {
  const paise = Math.round(value * 100);
  return Number.isSafeInteger(paise) && Math.abs(value * 100 - paise) <= 1e-7;
}

export default function ArtistPricingPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [monthlyPrice, setMonthlyPrice] = useState("");
  const [earlyAccessDays, setEarlyAccessDays] = useState<number | null>(null);

  // These fields already exist in the legacy API/schema. Phase-1 Artist Web
  // does not expose them as editable purchase options, but preserving their
  // current values prevents a monthly-price update from destructively clearing
  // pre-existing data in the legacy route.
  const [existingYearlyPrice, setExistingYearlyPrice] = useState<number | null>(null);
  const [existingFeatures, setExistingFeatures] = useState<string[]>([]);

  const backgroundStyle = useMemo(
    () =>
      ({
        backgroundImage:
          "radial-gradient(circle at 30% 10%, rgba(232,93,44,0.05) 0%, rgba(10,10,10,0.98) 100%)",
      } as const),
    []
  );

  const monthlyAmount = Number(monthlyPrice);
  const monthlyValid =
    Number.isFinite(monthlyAmount) &&
    monthlyAmount > 0 &&
    hasAtMostTwoDecimals(monthlyAmount);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await http.get<PricingResponse>("/api/v1/artist/pricing");
      if (!response.data?.success) {
        throw new Error(response.data?.message || "Failed to load pricing");
      }

      const monthly = Number(response.data.subscriptionPrice);
      if (!Number.isFinite(monthly) || monthly < 0) {
        throw new Error("The saved subscription price is invalid. Please contact support.");
      }

      setMonthlyPrice(monthly > 0 ? monthly.toFixed(2) : "");

      const yearly = Number(response.data.yearlySubscriptionPrice);
      setExistingYearlyPrice(Number.isFinite(yearly) && yearly > 0 ? yearly : null);
      setExistingFeatures(
        Array.isArray(response.data.subscriptionFeatures)
          ? response.data.subscriptionFeatures
              .map((item) => String(item ?? "").trim())
              .filter(Boolean)
              .slice(0, 8)
          : []
      );

      const windowDays = Number(response.data.earlyAccessDays);
      setEarlyAccessDays(
        Number.isSafeInteger(windowDays) && windowDays > 0 ? windowDays : null
      );
    } catch (e: any) {
      const correlationId = e?.response?.data?.correlationId;
      const message =
        e?.response?.data?.message || e?.message || "Failed to load pricing";
      setError(
        correlationId ? `${message} (Reference: ${correlationId})` : message
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaved(false);
    setError(null);

    if (!monthlyValid) {
      setError("Monthly subscription price must be a positive INR amount with at most two decimal places.");
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        subscriptionPrice: monthlyAmount,
        subscriptionFeatures: existingFeatures,
      };
      if (existingYearlyPrice !== null) {
        payload.yearlySubscriptionPrice = existingYearlyPrice;
      }

      await http.patch("/api/v1/artist/pricing", payload);
      await load();
      setSaved(true);
      window.setTimeout(() => setSaved(false), 3000);
    } catch (e: any) {
      const correlationId = e?.response?.data?.correlationId;
      const message =
        e?.response?.data?.message || e?.message || "Failed to save pricing";
      setError(
        correlationId ? `${message} (Reference: ${correlationId})` : message
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <ErrorBoundary label="Artist: Pricing">
        <PricingPageSkeleton />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary label="Artist: Pricing">
      <div className="w-full animate-fadeIn" style={backgroundStyle}>
        <div className="mx-auto max-w-5xl space-y-7 px-4 py-6 sm:px-8 sm:py-8 lg:px-10 lg:py-10">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="mb-1 flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-secondary shadow-lg shadow-primary/25">
                  <Wallet className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h1 className="text-3xl font-bold tracking-tight text-white">
                    Early-Access Pricing
                  </h1>
                  <p className="text-sm text-[#B8A6A1]">
                    Configure the monthly INR price fans pay to support your channel.
                  </p>
                </div>
              </div>
            </div>
            <div className="inline-flex items-center gap-2 self-start rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-xs text-emerald-300">
              <ShieldCheck size={15} />
              Server-authoritative pricing
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
              <div className="flex-1">{error}</div>
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading || saving}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-400/20 px-2.5 py-1.5 text-xs font-medium hover:bg-rose-400/10 disabled:opacity-50"
              >
                <RefreshCw size={13} /> Retry
              </button>
            </div>
          )}

          {saved && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-300">
              <CheckCircle className="h-5 w-5" />
              Pricing saved and refreshed from the server.
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <section className="rounded-2xl border border-white/10 bg-surface p-6 lg:col-span-2">
              <div className="mb-6 flex items-center gap-3 border-b border-white/10 pb-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Music2 size={20} />
                </div>
                <div>
                  <h2 className="font-semibold text-white">Monthly subscription</h2>
                  <p className="text-xs text-[#8D7B77]">
                    Phase 1 uses artist-wise monthly subscriptions.
                  </p>
                </div>
              </div>

              <label className="block text-xs font-semibold uppercase tracking-wider text-[#B8A6A1]">
                Monthly price (INR)
              </label>
              <div className="mt-3 flex items-center gap-2">
                <div className="flex h-14 w-12 items-center justify-center rounded-xl border border-white/10 bg-background/60 text-2xl font-bold text-primary">
                  ₹
                </div>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  value={monthlyPrice}
                  onChange={(event) => {
                    setMonthlyPrice(event.target.value);
                    setError(null);
                    setSaved(false);
                  }}
                  disabled={saving}
                  placeholder="9.99"
                  aria-invalid={monthlyPrice.length > 0 && !monthlyValid}
                  className="h-14 w-full rounded-xl border border-white/10 bg-background/60 px-4 text-2xl font-bold text-white outline-none transition-all focus:border-primary/50 disabled:opacity-50"
                />
              </div>
              <p className="mt-2 text-xs text-[#8D7B77]">
                The backend resolves this configured rupee price and converts it to integer paise at the payment boundary. The browser never supplies the checkout amount.
              </p>

              <div className="mt-7 flex items-center gap-3 border-t border-white/10 pt-6">
                <button
                  type="button"
                  disabled={saving || !monthlyValid}
                  onClick={() => void save()}
                  className="inline-flex h-12 items-center gap-2 rounded-xl bg-gradient-to-r from-primary to-secondary px-7 font-semibold text-white shadow-lg shadow-primary/25 transition-all hover:shadow-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" /> Saving…
                    </>
                  ) : (
                    <>
                      <CheckCircle className="h-5 w-5" /> Save monthly price
                    </>
                  )}
                </button>
                <span className="text-xs text-[#8D7B77]">
                  Duplicate submissions are blocked while saving.
                </span>
              </div>
            </section>

            <aside className="space-y-5">
              <div className="rounded-2xl border border-white/10 bg-surface p-5">
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Clock size={17} className="text-primary" /> Early-access window
                </div>
                <div className="mt-4 text-3xl font-bold text-white">
                  {earlyAccessDays ? `${earlyAccessDays} days` : "Platform policy"}
                </div>
                <p className="mt-2 text-xs leading-relaxed text-[#8D7B77]">
                  This is a content/platform lifecycle policy in Phase 1, not an Artist pricing field. It is displayed from server state and is not edited by this form.
                </p>
              </div>

              <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5">
                <div className="text-sm font-semibold text-white">What this changes</div>
                <ul className="mt-3 space-y-2 text-xs leading-relaxed text-[#B8A6A1]">
                  <li>• Updates your configured monthly subscription price.</li>
                  <li>• Does not activate subscriptions or publish content.</li>
                  <li>• Payment and entitlement state remain server/webhook authoritative.</li>
                </ul>
              </div>
            </aside>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeIn { animation: fadeIn 0.35s ease-out forwards; }
      `}</style>
    </ErrorBoundary>
  );
}
