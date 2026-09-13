import { useCallback, useMemo, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
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
  AlertTriangle,
  Calendar,
  DollarSign,
  FileWarning,
  RefreshCw,
  UserPlus,
  Users,
} from "lucide-react";
import { http } from "../services/http";
import Skeleton from "../components/Skeleton";

type SummaryData = {
  totalArtists: number;
  totalActiveSubscriptions: number;
  revenueToday: number;
  activeReports?: number;
  subscriptionDetails?: {
    newToday: number;
    renewalsToday: number;
  };
  alerts?: {
    draftCount?: number;
    failedPaymentsCount?: number;
  };
};

type SeriesPoint = { date: string; value: number };

type DashboardDataResponse = {
  success: boolean;
  summary: SummaryData;
  growth: SeriesPoint[];
  revenue: SeriesPoint[];
  alerts: {
    success: boolean;
    drafts: Array<{ id: unknown; title: string | null; created_at: string }>;
    failedPayments: Array<{
      id: unknown;
      amount: number;
      created_at: string;
      status: string;
    }>;
  };
};

function currency(value: number) {
  const amount = Number(value);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(amount) ? amount : 0);
}

function integer(value: number) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toLocaleString("en-IN") : "0";
}

export default function AdminHomePage() {
  const navigate = useNavigate();

  const dashboard = useQuery({
    queryKey: ["adminDashboardData"],
    queryFn: async () => {
      try {
        const response = await http.get<DashboardDataResponse>(
          "/api/v1/admin/analytics/dashboard-data"
        );
        return response.data;
      } catch (error: any) {
        if (Number(error?.response?.status || 0) === 401) {
          localStorage.removeItem("adminToken");
          navigate("/admin/login", { replace: true });
        }
        throw error;
      }
    },
  });

  const pendingApplications = useQuery({
    queryKey: ["adminPendingArtistsCount"],
    queryFn: async () => {
      const response = await http.get("/api/v1/admin/pending-artists");
      return Array.isArray((response.data as any)?.items)
        ? ((response.data as any).items as unknown[]).length
        : 0;
    },
  });

  const retry = useCallback(() => {
    void Promise.all([dashboard.refetch(), pendingApplications.refetch()]);
  }, [dashboard, pendingApplications]);

  const data = dashboard.data;
  const summary = data?.summary;
  const growth = data?.growth ?? [];
  const revenue = data?.revenue ?? [];
  const drafts = data?.alerts?.drafts ?? [];
  const failedPayments = data?.alerts?.failedPayments ?? [];

  const growthChart = useMemo(
    () => growth.map((point) => ({ date: point.date.slice(5), value: point.value })),
    [growth]
  );
  const revenueChart = useMemo(
    () => revenue.map((point) => ({ date: point.date.slice(5), value: point.value })),
    [revenue]
  );

  const requestError: any = dashboard.error;
  const status = Number(requestError?.response?.status || 0);
  const correlationId = requestError?.response?.data?.correlationId;

  return (
    <div className="min-h-screen w-full bg-background px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            Operations
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-white">Dashboard</h1>
          <p className="mt-1 text-sm text-[#8D7B77]">
            Current account, subscription, moderation and captured-payment metrics.
          </p>
        </div>
        <button
          type="button"
          onClick={retry}
          disabled={dashboard.isFetching || pendingApplications.isFetching}
          className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-[#B8A6A1] hover:text-white disabled:opacity-50">
          <RefreshCw
            size={16}
            className={dashboard.isFetching || pendingApplications.isFetching ? "animate-spin" : ""}
          />
          Refresh
        </button>
      </div>

      {dashboard.isError && (
        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-red-400/20 bg-red-500/10 p-5">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-300" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-red-100">Dashboard data is unavailable</p>
            <p className="mt-1 text-sm text-red-200/80">
              {status === 403
                ? "Your authenticated account is not authorized to view the admin dashboard."
                : "The backend could not load dashboard metrics. Retry the request instead of relying on placeholder values."}
            </p>
            {correlationId && (
              <p className="mt-2 break-all text-xs text-red-200/60">
                Reference: {correlationId}
              </p>
            )}
          </div>
        </div>
      )}

      {dashboard.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="rounded-2xl border border-white/5 bg-surface p-6">
              <Skeleton className="mb-3 h-4 w-24" />
              <Skeleton className="h-8 w-32" />
            </div>
          ))}
        </div>
      ) : !dashboard.isError ? (
        <>
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Revenue today"
              value={currency(summary?.revenueToday ?? 0)}
              detail="Captured payment ledger"
              icon={<DollarSign size={20} />}
            />
            <MetricCard
              label="Artists"
              value={integer(summary?.totalArtists ?? 0)}
              detail="Non-deleted artist accounts"
              icon={<Users size={20} />}
            />
            <MetricCard
              label="Active subscriptions"
              value={integer(summary?.totalActiveSubscriptions ?? 0)}
              detail="Current active subscriptions"
              icon={<Activity size={20} />}
            />
            <MetricCard
              label="Active reports"
              value={integer(summary?.activeReports ?? 0)}
              detail="Flagged content requiring attention"
              icon={<AlertTriangle size={20} />}
            />
          </div>

          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
            <ActionCard
              label="Pending artists"
              value={pendingApplications.isLoading ? "…" : integer(pendingApplications.data ?? 0)}
              icon={<UserPlus size={18} />}
              onClick={() => navigate("/admin/artist-applications")}
            />
            <ActionCard
              label="Draft content"
              value={integer(drafts.length || summary?.alerts?.draftCount || 0)}
              icon={<FileWarning size={18} />}
              onClick={() => navigate("/admin/moderation")}
            />
            <ActionCard
              label="Failed payments"
              value={integer(failedPayments.length || summary?.alerts?.failedPaymentsCount || 0)}
              icon={<AlertCircle size={18} />}
              onClick={() => navigate("/admin/analytics")}
            />
            <ActionCard
              label="New today"
              value={integer(summary?.subscriptionDetails?.newToday ?? 0)}
              icon={<UserPlus size={18} />}
              onClick={() => navigate("/admin/analytics")}
            />
            <ActionCard
              label="Renewals today"
              value={integer(summary?.subscriptionDetails?.renewalsToday ?? 0)}
              icon={<Calendar size={18} />}
              onClick={() => navigate("/admin/analytics")}
            />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <ChartCard title="Subscription growth" subtitle="Created subscriptions, last 7 days">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={growthChart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: "#8D7B77", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#8D7B77", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: "#171717", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12 }}
                  />
                  <Line type="monotone" dataKey="value" stroke="var(--color-primary)" strokeWidth={2.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Captured revenue" subtitle="Payment ledger, last 7 days">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={revenueChart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: "#8D7B77", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#8D7B77", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: "#171717", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12 }}
                    formatter={(value: any) => currency(Number(value))}
                  />
                  <Bar dataKey="value" fill="var(--color-primary)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        </>
      ) : null}
    </div>
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
    <div className="rounded-2xl border border-white/5 bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-[#8D7B77]">{label}</p>
        <div className="rounded-xl bg-primary/10 p-2 text-primary">{icon}</div>
      </div>
      <p className="mt-3 text-2xl font-bold text-white">{value}</p>
      <p className="mt-1 text-xs text-[#8D7B77]">{detail}</p>
    </div>
  );
}

function ActionCard({
  label,
  value,
  icon,
  onClick,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border border-white/5 bg-surface p-4 text-left transition hover:border-white/15">
      <div className="flex items-center gap-2 text-primary">{icon}</div>
      <p className="mt-3 text-xl font-bold text-white">{value}</p>
      <p className="mt-1 text-xs text-[#8D7B77]">{label}</p>
    </button>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/5 bg-surface p-6">
      <h2 className="font-semibold text-white">{title}</h2>
      <p className="mt-1 text-sm text-[#8D7B77]">{subtitle}</p>
      <div className="mt-5 h-64">{children}</div>
    </div>
  );
}
