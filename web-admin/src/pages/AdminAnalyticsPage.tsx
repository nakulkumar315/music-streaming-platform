import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
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
  Activity,
  AlertCircle,
  Calendar,
  DollarSign,
  Music,
  RefreshCw,
  TrendingUp,
  Users,
} from "lucide-react";
import PageWrapper from "../components/PageWrapper";
import { http } from "../services/http";

type GlobalSummary = {
  success: boolean;
  totalRevenue: number;
  totalArtists: number;
  totalFans: number;
  totalActiveUsers: number;
  userGrowthRatePct: number;
  currency: string;
};

type SeriesPoint = { date: string; value: number };
type RevenueTrendsResponse = { success: boolean; data: SeriesPoint[]; currency: string };
type TopArtist = {
  artistId: number;
  name: string | null;
  profileImageUrl: string | null;
  subscribers: number;
  plays: number;
};
type TopArtistsResponse = { success: boolean; items: TopArtist[] };
type MetricsResponse = {
  success: boolean;
  metrics?: {
    activeSubscribers?: number;
    conversionRate?: string;
    revenuePerArtist?: Array<{ name: string | null; revenue: number }>;
  };
};

function formatCurrency(amount: number) {
  const value = Number(amount);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

function formatNumber(value: number) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString("en-IN") : "0";
}

function inputDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function defaultRange() {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 29);
  return { start: inputDate(start), end: inputDate(end) };
}

export default function AdminAnalyticsPage() {
  const navigate = useNavigate();
  const initial = useMemo(defaultRange, []);
  const [startDate, setStartDate] = useState(initial.start);
  const [endDate, setEndDate] = useState(initial.end);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<GlobalSummary | null>(null);
  const [revenue, setRevenue] = useState<SeriesPoint[]>([]);
  const [topArtists, setTopArtists] = useState<TopArtist[]>([]);
  const [metrics, setMetrics] = useState<MetricsResponse["metrics"] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = startDate && endDate
        ? `?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`
        : "";
      const [summaryResponse, revenueResponse, artistsResponse, metricsResponse] =
        await Promise.all([
          http.get<GlobalSummary>(`/api/v1/admin/analytics/global-summary${query}`),
          http.get<RevenueTrendsResponse>(`/api/v1/admin/analytics/revenue-trends${query}`),
          http.get<TopArtistsResponse>("/api/v1/admin/analytics/top-artists"),
          http.get<MetricsResponse>("/api/v1/admin/analytics/metrics"),
        ]);

      setSummary(summaryResponse.data);
      setRevenue(Array.isArray(revenueResponse.data?.data) ? revenueResponse.data.data : []);
      setTopArtists(Array.isArray(artistsResponse.data?.items) ? artistsResponse.data.items : []);
      setMetrics(metricsResponse.data?.metrics ?? null);
    } catch (requestError: any) {
      const status = Number(requestError?.response?.status || 0);
      if (status === 401) {
        localStorage.removeItem("adminToken");
        navigate("/admin/login", { replace: true });
        return;
      }
      if (status === 403) {
        setError("Your authenticated account is not authorized to view platform analytics.");
      } else {
        const correlation = requestError?.response?.data?.correlationId;
        setError(
          correlation
            ? `Analytics could not be loaded. Reference: ${correlation}`
            : "Analytics could not be loaded. Please retry."
        );
      }
    } finally {
      setLoading(false);
    }
  }, [endDate, navigate, startDate]);

  useEffect(() => {
    void load();
  }, [load]);

  const chartData = revenue.map((point) => ({
    date: point.date.slice(5),
    revenue: Number(point.value) || 0,
  }));

  return (
    <PageWrapper
      title="Analytics"
      subtitle="Canonical platform revenue and trusted engagement metrics">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-[#B8A6A1]">
          <Calendar size={16} />
          <input
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            className="bg-transparent text-white outline-none"
            style={{ colorScheme: "dark" }}
          />
        </label>
        <span className="text-sm text-[#8D7B77]">to</span>
        <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-[#B8A6A1]">
          <Calendar size={16} />
          <input
            type="date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
            className="bg-transparent text-white outline-none"
            style={{ colorScheme: "dark" }}
          />
        </label>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
        <button
          type="button"
          onClick={() => {
            const range = defaultRange();
            setStartDate(range.start);
            setEndDate(range.end);
          }}
          className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-[#B8A6A1] hover:text-white">
          Last 30 days
        </button>
        <button
          type="button"
          onClick={() => {
            setStartDate("");
            setEndDate("");
          }}
          className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-[#B8A6A1] hover:text-white">
          All time
        </button>
      </div>

      {error && (
        <div className="mb-6 flex items-start justify-between gap-4 rounded-2xl border border-red-400/20 bg-red-500/10 p-5">
          <div className="flex gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 text-red-300" />
            <div>
              <p className="font-medium text-red-100">Analytics unavailable</p>
              <p className="mt-1 text-sm text-red-200/80">{error}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg border border-red-300/20 px-3 py-1.5 text-sm text-red-100">
            Retry
          </button>
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Captured Revenue"
          value={loading ? "…" : formatCurrency(summary?.totalRevenue ?? 0)}
          detail="Payment ledger only"
          icon={<DollarSign size={20} />}
        />
        <MetricCard
          label="Artists"
          value={loading ? "…" : formatNumber(summary?.totalArtists ?? 0)}
          detail="Active platform accounts"
          icon={<Music size={20} />}
        />
        <MetricCard
          label="Fans"
          value={loading ? "…" : formatNumber(summary?.totalFans ?? 0)}
          detail={`${formatNumber(summary?.totalActiveUsers ?? 0)} active users`}
          icon={<Users size={20} />}
        />
        <MetricCard
          label="Conversion"
          value={loading ? "…" : metrics?.conversionRate ?? "0%"}
          detail="Active subscribers vs fans"
          icon={<TrendingUp size={20} />}
        />
      </div>

      <div className="mb-6 rounded-2xl border border-white/10 bg-surface p-6">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-white">Revenue trend</h3>
            <p className="mt-1 text-sm text-[#8D7B77]">
              Successful payment-ledger entries; analytics events do not affect financial totals.
            </p>
          </div>
          <Activity className="text-primary" size={20} />
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
                formatter={(value: any) => formatCurrency(Number(value))}
              />
              <Line type="monotone" dataKey="revenue" stroke="var(--color-primary)" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-surface p-6">
          <h3 className="font-semibold text-white">Popular artists</h3>
          <p className="mt-1 text-sm text-[#8D7B77]">Trusted plays plus active subscribers.</p>
          <div className="mt-5 space-y-3">
            {!loading && topArtists.length === 0 && (
              <p className="text-sm text-[#8D7B77]">No artist engagement data yet.</p>
            )}
            {topArtists.map((artist) => (
              <div key={artist.artistId} className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.03] p-4">
                <div className="min-w-0">
                  <p className="truncate font-medium text-white">{artist.name || `Artist #${artist.artistId}`}</p>
                  <p className="mt-1 text-xs text-[#8D7B77]">{formatNumber(artist.subscribers)} subscribers</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-primary">{formatNumber(artist.plays)}</p>
                  <p className="text-xs text-[#8D7B77]">plays</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-surface p-6">
          <h3 className="font-semibold text-white">Revenue by artist</h3>
          <p className="mt-1 text-sm text-[#8D7B77]">Gross captured artist-subscription payments.</p>
          <div className="mt-5 space-y-3">
            {!loading && !(metrics?.revenuePerArtist?.length) && (
              <p className="text-sm text-[#8D7B77]">No captured artist revenue in this view.</p>
            )}
            {metrics?.revenuePerArtist?.map((artist, index) => (
              <div key={`${artist.name || "artist"}-${index}`} className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.03] p-4">
                <span className="truncate text-sm text-white">{artist.name || "Unnamed artist"}</span>
                <span className="font-medium text-primary">{formatCurrency(artist.revenue)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </PageWrapper>
  );
}

function MetricCard({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: ReactNode;
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
