import { useEffect, useState } from "react";
import { CheckCircle, Eye, FileText, Plus, Shield, XCircle } from "lucide-react";
import { http } from "../services/http";

type TermsVersion = {
  version: string;
  content: string;
  effectiveFrom: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type TermsResponse = {
  success: boolean;
  terms?: TermsVersion[];
  message?: string;
  correlationId?: string;
};

function errorMessage(error: unknown, fallback: string) {
  const value = error as {
    response?: { data?: { message?: string; correlationId?: string } };
    message?: string;
  };
  const message = value?.response?.data?.message || value?.message || fallback;
  const correlationId = value?.response?.data?.correlationId;
  return correlationId ? `${message} (Reference: ${correlationId})` : message;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

export default function AdminTermsManagementPage() {
  const [terms, setTerms] = useState<TermsVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [previewTerms, setPreviewTerms] = useState<TermsVersion | null>(null);

  const fetchTerms = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await http.get<TermsResponse>(
        "/api/v1/admin/artists/terms-versions"
      );
      if (!response.data?.success) {
        throw new Error(response.data?.message || "Failed to load terms versions");
      }
      setTerms(Array.isArray(response.data.terms) ? response.data.terms : []);
    } catch (requestError: unknown) {
      setTerms([]);
      setError(errorMessage(requestError, "Failed to load terms versions"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchTerms();
  }, []);

  const runMutation = async (
    actionKey: string,
    command: () => Promise<unknown>,
    fallback: string
  ) => {
    if (busyAction) return false;
    setBusyAction(actionKey);
    setError(null);
    try {
      await command();
      await fetchTerms();
      return true;
    } catch (requestError: unknown) {
      setError(errorMessage(requestError, fallback));
      return false;
    } finally {
      setBusyAction(null);
    }
  };

  const handleCreateTerms = async (content: string) => {
    const normalized = content.trim();
    if (!normalized) {
      setError("Terms content is required.");
      return false;
    }

    const success = await runMutation(
      "create",
      () => http.post("/api/v1/admin/artists/terms-versions", { content: normalized }),
      "Failed to publish terms version"
    );
    if (success) setShowCreateModal(false);
    return success;
  };

  const handleToggleTermsStatus = async (term: TermsVersion) => {
    const action = term.isActive ? "deactivate" : "activate";
    if (
      term.isActive &&
      !window.confirm(
        `Deactivate ${term.version}? Future onboarding must have another active terms version before it can use updated terms.`
      )
    ) {
      return;
    }

    await runMutation(
      `toggle:${term.version}`,
      () =>
        http.put(`/api/v1/admin/artists/terms-versions/${encodeURIComponent(term.version)}`, {
          isActive: !term.isActive,
        }),
      `Failed to ${action} ${term.version}`
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/20 text-blue-400">
            <Shield size={20} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Terms & Conditions</h1>
            <p className="text-sm text-[#8D7B77]">Manage future onboarding terms versions</p>
          </div>
        </div>
        <button
          type="button"
          disabled={Boolean(busyAction)}
          onClick={() => {
            setError(null);
            setShowCreateModal(true);
          }}
          className="flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus size={18} />
          New Version
        </button>
      </div>

      {error && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
          <span>{error}</span>
          <button
            type="button"
            disabled={loading || Boolean(busyAction)}
            onClick={() => void fetchTerms()}
            className="shrink-0 rounded-lg border border-red-300/20 px-2.5 py-1 text-xs disabled:opacity-50"
          >
            Reload
          </button>
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center">
          <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-4 border-blue-500/30 border-t-blue-500" />
          <p className="text-sm text-[#8D7B77]">Loading terms…</p>
        </div>
      ) : terms.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 py-12 text-center">
          <Shield className="mx-auto mb-4 h-16 w-16 text-[#8D7B77]" />
          <h3 className="mb-2 text-lg font-semibold text-white">No Terms Versions</h3>
          <p className="text-sm text-[#8D7B77]">
            Publish a terms version before future artist onboarding uses this policy.
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {terms.map((term) => {
            const actionBusy = busyAction === `toggle:${term.version}`;
            return (
              <div
                key={term.version}
                className={`rounded-xl border p-6 ${
                  term.isActive
                    ? "border-blue-500/20 bg-blue-500/5"
                    : "border-white/10 bg-white/5 opacity-70"
                }`}
              >
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="mb-2 flex items-center gap-3">
                      <h3 className="text-lg font-semibold text-white">{term.version}</h3>
                      {term.isActive ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-400">
                          <CheckCircle size={12} /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full border border-red-500/20 bg-red-500/10 px-2 py-1 text-xs font-medium text-red-400">
                          <XCircle size={12} /> Inactive
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-[#8D7B77]">
                      Effective from: {formatDate(term.effectiveFrom)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={Boolean(busyAction)}
                      onClick={() => setPreviewTerms(term)}
                      className="rounded-lg p-2 text-[#8D7B77] transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
                      title="Preview Terms"
                    >
                      <Eye size={18} />
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(busyAction)}
                      onClick={() => void handleToggleTermsStatus(term)}
                      className="rounded-lg p-2 text-[#8D7B77] transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                      title={term.isActive ? "Deactivate" : "Activate"}
                    >
                      {actionBusy ? (
                        <span className="block h-[18px] w-[18px] animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      ) : term.isActive ? (
                        <XCircle size={18} className="text-red-400" />
                      ) : (
                        <CheckCircle size={18} className="text-emerald-400" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="max-h-32 overflow-hidden rounded-lg bg-white/5 p-4">
                  <p className="line-clamp-3 whitespace-pre-wrap text-sm text-[#8D7B77]">
                    {term.content}
                  </p>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-[#8D7B77]">
                  <span>Created: {formatDate(term.createdAt)}</span>
                  <span>Updated: {formatDate(term.updatedAt)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/10 bg-background p-6">
            <div className="mb-4 flex items-center gap-3">
              <div className="rounded-xl bg-blue-500/10 p-2 text-blue-400">
                <FileText size={20} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">Create New Terms Version</h2>
                <p className="mt-1 text-xs text-[#8D7B77]">
                  A successful publish becomes the canonical future-onboarding terms version.
                </p>
              </div>
            </div>
            <CreateTermsForm
              busy={busyAction === "create"}
              onSubmit={handleCreateTerms}
              onCancel={() => {
                if (!busyAction) setShowCreateModal(false);
              }}
            />
          </div>
        </div>
      )}

      {previewTerms && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-white/10 bg-background p-6">
            <div className="mb-4 flex items-center justify-between gap-4">
              <h2 className="text-xl font-bold text-white">{previewTerms.version}</h2>
              <button
                type="button"
                onClick={() => setPreviewTerms(null)}
                className="rounded-lg p-2 text-white hover:bg-white/10"
                aria-label="Close preview"
              >
                <XCircle size={20} />
              </button>
            </div>
            <div className="rounded-lg bg-white/5 p-4">
              <pre className="whitespace-pre-wrap break-words font-sans text-sm text-[#B8A6A1]">
                {previewTerms.content}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CreateTermsForm({
  busy,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  onSubmit: (content: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [content, setContent] = useState("");

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalized = content.trim();
    if (!normalized || busy) return;
    const success = await onSubmit(normalized);
    if (success) setContent("");
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="mb-2 block text-sm font-medium text-[#8D7B77]">
          Terms Content
        </label>
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={12}
          disabled={busy}
          className="w-full resize-none rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-white outline-none focus:border-blue-500 disabled:opacity-50"
          placeholder="Enter terms and conditions content…"
        />
      </div>
      <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-3">
        <p className="text-xs text-yellow-400">
          <strong>Note:</strong> Publishing a new version deactivates previous versions according to the backend contract. Existing signed agreements keep their recorded terms version.
        </p>
      </div>
      <div className="flex gap-3 pt-4">
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="flex-1 rounded-lg bg-white/5 px-4 py-3 text-white transition-colors hover:bg-white/10 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy || !content.trim()}
          className="flex-1 rounded-lg bg-blue-500 px-4 py-3 text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Publishing…" : "Publish Version"}
        </button>
      </div>
    </form>
  );
}
