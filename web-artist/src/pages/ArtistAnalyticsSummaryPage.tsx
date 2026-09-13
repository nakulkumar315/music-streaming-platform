import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertCircle,
  Calendar,
  DollarSign,
  Music,
  PlayCircle,
  RefreshCw,
  Users,
} from "lucide-react";
import { http, toApiFailure } from "../services/http";

type MetricType = "plays" | "earnings";
type TimeFilter = 7 | 30 | 90 | 365;
type Stats = {
  subscribers: number;
  totalPlays: number;
  grossEarnings: number;
};
type GrowthPoint = { date: string; value: number };
type ContentPerformance = {
  contentId: number;
  title: string;
  thumbnailUrl: string | null;
  plays: number;
};

function money(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(Number(value)) ? Number(value) : 0);
}

function count(value: number) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString("en-IN") : "0";
}

export default function ArtistAnalyticsSummaryPage() {
  const [metric, setMetric] = useState<MetricType>("plays");
  const [days, setDays] = useState<TimeFilter>(30);

  const query = useQuery({
    queryKey: ["artist", "analytics", metric, days],
    queryFn: async () => {
      const [summaryResponse, growthResponse, contentResponse] = await Promise.all([
        http.get("/api/v1/artist/dashboard/summary"),
        http.get(`/api/v1/artist/dashboard/growth?days=${days}&metric=${metric}`),
        http.get(`/api/v1/artist/analytics/content-performance?days=${days}`),
      ]);

      return {
        stats: summaryResponse.data?.stats as Stats,
        growth: (Array.isArray(growthResponse.data?.data)
          ? growthResponse.data.data
          : []) as GrowthPoint[],
        content: (Array.isArray(contentResponse.data?.items)
          ? contentResponse.data.items
          : []) as ContentPerformance[],
      };
    },
  });

  const failure = query.isError ? toApiFailure(query.error) : null;
  const stats = query.data?.stats;
  const growth = query.data?.growth ?? [];
  const content = query.data?.content ?? [];

  const chartData = useMemo(
    () =>
      growth.map((point) => ({
        date: point.date.slice(5),
        value: Number(point.value) || 0,
      })),
    [growth]
  );

  return (
    <div className="relative min-h-[500px] overflow-hidden rounded-2xl border border-white/10 bg-background p-6 shadow-2xl">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Analytics</p>
          <h1 className="mt-1 text-2xl font-bold text-white">Channel performance</h1>
          <p className="mt-1 text-sm text-[#8D7B77]">
            Trusted plays, subscribers, and gross captured subscription revenue.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
            {([7, 30, 90, 365] as TimeFilter[]).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setDays(value)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  days === value ? "bg-primary text-white" : "text-[#B8A6A1] hover:text-white"
                }`}>
                {value === 365 ? "1Y" : `${value}D`}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-[#B8A6A1] hover:text-white disabled:opacity-50">
            <RefreshCw size={15} className={query.isFetching ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {failure && (
        <div className="mb-6 rounded-2xl border border-red-400/20 bg-red-500/10 p-5">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-300" />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-red-100">Analytics could not be loaded</p>
              <p className="mt-1 text-sm text-red-200/80">
                {failure.status === 403
                  ? "Your artist account is not currently permitted to view this analytics surface."
                  : failure.message}
              </p>
              {failure.correlationId && (
                <p className="mt-2 break-all text-xs text-red-200/60">
                  Reference: {failure.correlationId}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => void query.refetch()}
              className="rounded-lg border border-red-300/20 px-3 py-1.5 text-sm text-red-100">
              Retry
            </button>
          </div>
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Subscribers"
          value={query.isLoading ? "…" : count(stats?.subscribers ?? 0)}
          detail="Active artist subscriptions"
          icon={<Users size={20} />}
        />
        <StatCard
          label="Trusted plays"
          value={query.isLoading ? "…" : count(stats?.totalPlays ?? 0)}
          detail="Qualified playback sessions"
          icon={<PlayCircle size={20} />}
        />
        <StatCard
          label="Gross captured revenue"
          value={query.isLoading ? "…" : money(stats?.grossEarnings ?? 0)}
          detail="Payment ledger; not payout estimate"
          icon={<DollarSign size={20} />}
        />
      </div>

      <div className="mb-6 rounded-2xl border border-white/10 bg-surface p-5">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-white">Trend</h2>
            <p className="mt-1 text-sm text-[#8D7B77]">
              {metric === "plays" ? "Trusted playback counts" : "Gross captured revenue"} over {days} days.
            </p>
          </div>
          <div className="flex rounded-xl border border-white/10 bg-white/5 p-1">
            <button
              type="button"
              onClick={() => setMetric("plays")}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                metric === "plays" ? "bg-primary text-white" : "text-[#B8A6A1]"
              }`}>
              Plays
            </button>
            <button
              type="button"
              onClick={() => setMetric("earnings")}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                metric === "earnings" ? "bg-primary text-white" : "text-[#B8A6A1]"
              }`}>
              Gross revenue
            </button>
          </div>
        </div>

        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: "#8D7B77", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#8D7B77", fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{
                  background: "#171717",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 12,
                }}
                formatter={(value: number) =>
                  metric === "earnings" ? money(value) : count(value)
                }
              />
              <Line type="monotone" dataKey="value" stroke="var(--color-primary)" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-surface p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-white">Content performance</h2>
            <p className="mt-1 text-sm text-[#8D7B77]">Top content by trusted plays in this period.</p>
          </div>
          <Calendar className="text-primary" size={18} />
        </div>

        <div className="mt-5 space-y-3">
          {!query.isLoading && !failure && content.length === 0 && (
            <div className="rounded-xl border border-white/5 bg-white/[0.03] p-8 text-center">
              <Music className="mx-auto text-[#8D7B77]" size={24} />
              <p className="mt-2 text-sm text-[#8D7B77]">No trusted play data in this period.</p>
            </div>
          )}
          {content.map((item) => (
            <div
              key={item.contentId}
              className="flex items-center justify-between gap-4 rounded-xl border border-white/5 bg-white/[0.03] p-4">
              <div className="min-w-0">
                <p className="truncate font-medium text-white">{item.title}</p>
                <p className="mt-1 text-xs text-[#8D7B77]">Content #{item.contentId}</p>
              </div>
              <div className="text-right">
                <p className="font-semibold text-primary">{count(item.plays)}</p>
                <p className="text-xs text-[#8D7B77]">plays</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-[#8D7B77]">{label}</p>
        <div className="rounded-xl bg-primary/10 p-2 text-primary">{icon}</div>
      </div>
      <p className="mt-3 text-2xl font-bold text-white">{value}</p>
      <p className="mt-1 text-xs text-[#8D7B77]">{detail}</p>
    </div>
  );
}
