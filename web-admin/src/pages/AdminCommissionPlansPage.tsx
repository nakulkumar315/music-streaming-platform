import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle,
  DollarSign,
  Edit,
  Plus,
  Trash2,
  XCircle,
} from "lucide-react";
import { http } from "../services/http";

type CommissionPlan = {
  id: number;
  version: string;
  name: string;
  description: string;
  benefits: string[];
  artistShare: number;
  platformShare: number;
  effectiveFrom: string;
  isActive: boolean;
  createdAt: string;
};

type PlanCommand = {
  version: "basic" | "growth" | "pro" | "managed";
  artistShare: number;
  platformShare: number;
};

function failureMessage(error: unknown, fallback: string) {
  const value = error as {
    response?: { data?: { message?: string; correlationId?: string } };
    message?: string;
  };
  const message = value?.response?.data?.message || value?.message || fallback;
  const correlationId = value?.response?.data?.correlationId;
  return correlationId ? `${message} (Reference: ${correlationId})` : message;
}

export default function AdminCommissionPlansPage() {
  const [plans, setPlans] = useState<CommissionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const fetchPlans = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await http.get("/api/v1/admin/artists/revenue-share-config");
      if (!response.data?.success) throw new Error("Failed to load commission plans");
      setPlans(Array.isArray(response.data.configs) ? response.data.configs : []);
    } catch (requestError: unknown) {
      setError(failureMessage(requestError, "Failed to load commission plans"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchPlans();
  }, []);

  const runCommand = async (
    key: string,
    command: () => Promise<unknown>,
    fallback: string
  ) => {
    if (busyKey) return false;
    setBusyKey(key);
    setError(null);
    try {
      await command();
      await fetchPlans();
      return true;
    } catch (requestError: unknown) {
      setError(failureMessage(requestError, fallback));
      return false;
    } finally {
      setBusyKey(null);
    }
  };

  const handleCreatePlan = async (data: PlanCommand) => {
    const created = await runCommand(
      "create",
      () => http.post("/api/v1/admin/artists/revenue-share-config", data),
      "Failed to create commission plan"
    );
    if (created) setShowCreateModal(false);
  };

  const handleToggleStatus = async (plan: CommissionPlan) => {
    await runCommand(
      `status:${plan.id}`,
      () =>
        http.put(`/api/v1/admin/artists/revenue-share-config/${plan.id}`, {
          isActive: !plan.isActive,
        }),
      "Failed to update commission plan status"
    );
  };

  const handleEditPlan = async (plan: CommissionPlan) => {
    if (busyKey) return;
    const raw = window.prompt("Enter new artist share % (whole number 0–100):", String(plan.artistShare));
    if (raw === null) return;
    const artistShare = Number(raw);
    if (!Number.isInteger(artistShare) || artistShare < 0 || artistShare > 100) {
      setError("Artist share must be a whole percentage between 0 and 100.");
      return;
    }

    await runCommand(
      `edit:${plan.id}`,
      () =>
        http.put(`/api/v1/admin/artists/revenue-share-config/${plan.id}`, {
          artistShare,
          platformShare: 100 - artistShare,
        }),
      "Failed to update commission plan"
    );
  };

  const handleDeletePlan = async (plan: CommissionPlan) => {
    if (busyKey) return;
    if (
      !window.confirm(
        `Delete commission plan ${plan.name || plan.version}? Existing signed artist agreement snapshots are not changed by this action.`
      )
    ) {
      return;
    }

    await runCommand(
      `delete:${plan.id}`,
      () => http.delete(`/api/v1/admin/artists/revenue-share-config/${plan.id}`),
      "Failed to delete commission plan"
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/20 text-primary">
            <DollarSign size={20} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Commission Plans</h1>
            <p className="text-sm text-[#8D7B77]">
              Manage future artist onboarding revenue-sharing plans
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled={Boolean(busyKey)}
          onClick={() => {
            setError(null);
            setShowCreateModal(true);
          }}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          <Plus size={18} /> Create Plan
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button
            type="button"
            disabled={loading || Boolean(busyKey)}
            onClick={() => void fetchPlans()}
            className="rounded-lg border border-red-300/20 px-2.5 py-1 text-xs disabled:opacity-50"
          >
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center">
          <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-4 border-primary/30 border-t-primary" />
          <p className="text-sm text-[#8D7B77]">Loading plans...</p>
        </div>
      ) : plans.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 py-12 text-center">
          <DollarSign className="mx-auto mb-4 h-16 w-16 text-[#8D7B77]" />
          <h3 className="mb-2 text-lg font-semibold text-white">No Commission Plans</h3>
          <p className="mb-4 text-sm text-[#8D7B77]">
            Create a future onboarding commission plan to get started.
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {plans.map((plan) => {
            const busy = busyKey?.endsWith(`:${plan.id}`) ?? false;
            return (
              <div
                key={plan.id}
                className={`rounded-xl border p-6 ${
                  plan.isActive
                    ? "border-primary/20 bg-primary/5"
                    : "border-white/10 bg-white/5 opacity-70"
                }`}
              >
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="mb-2 flex items-center gap-3">
                      <h3 className="text-lg font-semibold text-white">
                        {plan.name || plan.version}
                      </h3>
                      {plan.isActive ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-400">
                          <CheckCircle size={12} /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full border border-red-500/20 bg-red-500/10 px-2 py-1 text-xs font-medium text-red-400">
                          <XCircle size={12} /> Inactive
                        </span>
                      )}
                    </div>
                    <p className="mb-2 text-sm text-[#8D7B77]">{plan.description}</p>
                    <p className="text-xs text-[#8D7B77]">
                      Effective from: {new Date(plan.effectiveFrom).toLocaleDateString()}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={Boolean(busyKey)}
                      onClick={() => void handleEditPlan(plan)}
                      className="rounded-lg p-2 text-[#8D7B77] transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
                      title="Edit Plan"
                    >
                      <Edit size={18} />
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(busyKey)}
                      onClick={() => void handleToggleStatus(plan)}
                      className="rounded-lg p-2 text-[#8D7B77] transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
                      title={plan.isActive ? "Deactivate" : "Activate"}
                    >
                      {plan.isActive ? <XCircle size={18} /> : <CheckCircle size={18} />}
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(busyKey)}
                      onClick={() => void handleDeletePlan(plan)}
                      className="rounded-lg p-2 text-red-400 transition-colors hover:bg-white/10 hover:text-red-300 disabled:opacity-40"
                      title="Delete Plan"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>

                <div className="mb-4 grid grid-cols-2 gap-4">
                  <div className="rounded-lg bg-white/5 p-4">
                    <div className="text-3xl font-bold text-primary">{plan.artistShare}%</div>
                    <div className="text-sm text-[#8D7B77]">Artist Share</div>
                  </div>
                  <div className="rounded-lg bg-white/5 p-4">
                    <div className="text-3xl font-bold text-secondary">{plan.platformShare}%</div>
                    <div className="text-sm text-[#8D7B77]">Platform Share</div>
                  </div>
                </div>

                {plan.benefits?.length > 0 && (
                  <div className="mb-4">
                    <div className="mb-2 text-xs font-medium uppercase tracking-wider text-[#8D7B77]">
                      Benefits
                    </div>
                    <ul className="space-y-1">
                      {plan.benefits.map((benefit, index) => (
                        <li key={`${benefit}-${index}`} className="flex items-start gap-2 text-sm text-[#B8A6A1]">
                          <span className="mt-1 text-primary">•</span> {benefit}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="text-xs text-[#8D7B77]">
                  {busy ? "Updating…" : `Created: ${new Date(plan.createdAt).toLocaleString()}`}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-background p-6">
            <h2 className="mb-4 text-xl font-bold text-white">Create Commission Plan</h2>
            <CreatePlanForm
              busy={busyKey === "create"}
              onSubmit={handleCreatePlan}
              onCancel={() => {
                if (!busyKey) setShowCreateModal(false);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function CreatePlanForm({
  busy,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  onSubmit: (data: PlanCommand) => Promise<void>;
  onCancel: () => void;
}) {
  const [planType, setPlanType] = useState<PlanCommand["version"] | "">("");
  const [artistShare, setArtistShare] = useState(50);
  const [platformShare, setPlatformShare] = useState(50);
  const [validationError, setValidationError] = useState<string | null>(null);

  const planPresets: Record<PlanCommand["version"], { artistShare: number; platformShare: number }> = {
    basic: { artistShare: 70, platformShare: 30 },
    growth: { artistShare: 65, platformShare: 35 },
    pro: { artistShare: 60, platformShare: 40 },
    managed: { artistShare: 55, platformShare: 45 },
  };

  const handlePlanTypeChange = (type: string) => {
    if (!(type in planPresets)) {
      setPlanType("");
      return;
    }
    const nextType = type as PlanCommand["version"];
    setPlanType(nextType);
    setArtistShare(planPresets[nextType].artistShare);
    setPlatformShare(planPresets[nextType].platformShare);
    setValidationError(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!planType) {
      setValidationError("Select a commission plan type.");
      return;
    }
    if (
      !Number.isInteger(artistShare) ||
      !Number.isInteger(platformShare) ||
      artistShare < 0 ||
      platformShare < 0 ||
      artistShare > 100 ||
      platformShare > 100 ||
      artistShare + platformShare !== 100
    ) {
      setValidationError("Revenue shares must be whole percentages totaling 100%.");
      return;
    }
    setValidationError(null);
    await onSubmit({ version: planType, artistShare, platformShare });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {validationError && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
          {validationError}
        </div>
      )}
      <div>
        <label className="mb-2 block text-sm font-medium text-[#8D7B77]">Plan Type</label>
        <select
          value={planType}
          disabled={busy}
          onChange={(event) => handlePlanTypeChange(event.target.value)}
          className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white focus:border-primary focus:outline-none disabled:opacity-50"
        >
          <option value="" className="text-[#5a4a46]">Select plan type</option>
          <option value="basic" className="bg-[#1a1210] text-white">Basic (70% Artist / 30% Platform)</option>
          <option value="growth" className="bg-[#1a1210] text-white">Growth (65% Artist / 35% Platform)</option>
          <option value="pro" className="bg-[#1a1210] text-white">Pro (60% Artist / 40% Platform)</option>
          <option value="managed" className="bg-[#1a1210] text-white">Managed (55% Artist / 45% Platform)</option>
        </select>
      </div>
      <div>
        <label className="mb-2 block text-sm font-medium text-[#8D7B77]">Artist Share (%)</label>
        <input
          type="number"
          min="0"
          max="100"
          step="1"
          value={artistShare}
          disabled={busy}
          onChange={(event) => {
            const value = Number(event.target.value);
            setArtistShare(value);
            if (Number.isInteger(value)) setPlatformShare(100 - value);
          }}
          className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white focus:border-primary focus:outline-none disabled:opacity-50"
        />
      </div>
      <div>
        <label className="mb-2 block text-sm font-medium text-[#8D7B77]">Platform Share (%)</label>
        <input
          type="number"
          min="0"
          max="100"
          step="1"
          value={platformShare}
          disabled={busy}
          onChange={(event) => {
            const value = Number(event.target.value);
            setPlatformShare(value);
            if (Number.isInteger(value)) setArtistShare(100 - value);
          }}
          className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white focus:border-primary focus:outline-none disabled:opacity-50"
        />
      </div>
      <div className="flex gap-3 pt-4">
        <button type="button" disabled={busy} onClick={onCancel} className="flex-1 rounded-lg bg-white/5 px-4 py-3 text-white transition-colors hover:bg-white/10 disabled:opacity-50">Cancel</button>
        <button type="submit" disabled={busy} className="flex-1 rounded-lg bg-primary px-4 py-3 text-white transition-colors hover:bg-primary/90 disabled:opacity-50">{busy ? "Creating…" : "Create Plan"}</button>
      </div>
    </form>
  );
}
