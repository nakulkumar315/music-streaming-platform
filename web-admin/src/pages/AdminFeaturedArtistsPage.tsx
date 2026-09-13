import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Eye, EyeOff, RefreshCw, Star, Trash2, User } from "lucide-react";
import PageWrapper from "../components/PageWrapper";
import { http } from "../services/http";

type Artist = {
  id: number;
  name: string | null;
  email?: string;
  profileImageUrl: string | null;
  isVerified?: boolean;
  status?: string;
  artistStatus?: string;
  isDeleted?: boolean;
};

type FeaturedArtist = {
  id: number;
  artistId: number;
  name: string;
  avatar: string | null;
  isActive: boolean;
  eligible?: boolean;
  createdAt: string;
};

function isEligibleArtist(artist: Artist) {
  const status = String(artist.status || "ACTIVE").toUpperCase();
  const artistStatus = String(artist.artistStatus || "APPROVED").toUpperCase();
  return (
    artist.isDeleted !== true &&
    status === "ACTIVE" &&
    artistStatus === "APPROVED" &&
    artist.isVerified === true
  );
}

export default function AdminFeaturedArtistsPage() {
  const [artists, setArtists] = useState<Artist[]>([]);
  const [featured, setFeatured] = useState<FeaturedArtist[]>([]);
  const [artistId, setArtistId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [artistsResponse, featuredResponse] = await Promise.all([
        http.get("/api/v1/admin/artists", { params: { page: 1, limit: 100 } }),
        http.get("/api/v1/admin/featured-artists"),
      ]);
      setArtists(Array.isArray(artistsResponse.data?.items) ? artistsResponse.data.items : []);
      setFeatured(Array.isArray(featuredResponse.data?.featured) ? featuredResponse.data.featured : []);
    } catch (e: any) {
      setError(e?.response?.data?.message || "Failed to load featured artists");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const available = useMemo(() => {
    const featuredIds = new Set(featured.map((item) => item.artistId));
    return artists.filter((artist) => isEligibleArtist(artist) && !featuredIds.has(artist.id));
  }, [artists, featured]);

  const add = async () => {
    const selected = Number(artistId);
    if (!Number.isSafeInteger(selected) || selected <= 0) return;
    setSaving(true);
    setError(null);
    try {
      await http.post("/api/v1/admin/featured-artists", { artistId: selected });
      setArtistId("");
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message || "Failed to feature artist");
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (item: FeaturedArtist) => {
    setError(null);
    try {
      await http.patch(`/api/v1/admin/featured-artists/${item.id}`, { isActive: !item.isActive });
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message || "Failed to update featured artist");
    }
  };

  const remove = async (item: FeaturedArtist) => {
    if (!window.confirm(`Remove ${item.name} from Featured Artists?`)) return;
    setError(null);
    try {
      await http.delete(`/api/v1/admin/featured-artists/${item.id}`);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.message || "Failed to remove featured artist");
    }
  };

  const activeCount = featured.filter((item) => item.isActive && item.eligible !== false).length;

  return (
    <PageWrapper
      title="Featured Artists"
      subtitle="Feature approved platform artists on the fan experience. Manual/orphan artist entries are intentionally not supported."
    >
      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <div className="rounded-2xl border border-white/5 bg-surface p-5">
          <div className="text-sm text-white/45">Featured records</div>
          <div className="mt-2 text-3xl font-semibold">{featured.length}</div>
        </div>
        <div className="rounded-2xl border border-white/5 bg-surface p-5">
          <div className="text-sm text-white/45">Live & eligible</div>
          <div className="mt-2 text-3xl font-semibold text-green-300">{activeCount}</div>
        </div>
        <div className="rounded-2xl border border-white/5 bg-surface p-5">
          <div className="text-sm text-white/45">Approved artists available</div>
          <div className="mt-2 text-3xl font-semibold text-blue-300">{available.length}</div>
        </div>
      </div>

      {error && (
        <div className="mb-5 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-red-200">
          {error}
        </div>
      )}

      <div className="rounded-2xl border border-white/5 bg-surface p-6 mb-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end">
          <label className="flex-1">
            <span className="block text-xs uppercase tracking-wide text-white/45 mb-2">Approved artist</span>
            <select
              value={artistId}
              onChange={(event) => setArtistId(event.target.value)}
              disabled={loading || saving}
              className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-white"
            >
              <option value="">Select artist</option>
              {available.map((artist) => (
                <option key={artist.id} value={artist.id}>
                  {artist.name || artist.email || `Artist #${artist.id}`}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={add}
            disabled={!artistId || saving}
            className="rounded-xl bg-primary px-5 py-3 font-medium text-white disabled:opacity-40"
          >
            {saving ? "Adding…" : "Add to Featured"}
          </button>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 disabled:opacity-40"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
        <p className="mt-3 text-xs text-white/35">
          The API re-validates ACTIVE + APPROVED + VERIFIED status. UI filtering is convenience only.
        </p>
      </div>

      <div className="rounded-2xl border border-white/5 bg-surface overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-white/45">Loading featured artists…</div>
        ) : featured.length === 0 ? (
          <div className="p-10 text-center text-white/45">
            <Star className="mx-auto mb-3" /> No featured artists configured.
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {featured.map((item) => {
              const eligible = item.eligible !== false;
              return (
                <div key={item.id} className="flex flex-col gap-4 p-5 md:flex-row md:items-center">
                  <div className="flex flex-1 items-center gap-4 min-w-0">
                    <div className="h-12 w-12 rounded-full overflow-hidden border border-white/10 bg-white/5 shrink-0">
                      {item.avatar ? (
                        <img src={item.avatar} alt={item.name} className="h-full w-full object-cover" />
                      ) : (
                        <div className="h-full w-full grid place-items-center text-white/40"><User size={20} /></div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium truncate">{item.name}</div>
                      <div className="mt-1 flex flex-wrap gap-2 text-xs">
                        <span className="text-white/40">Artist #{item.artistId}</span>
                        {eligible ? (
                          <span className="inline-flex items-center gap-1 text-green-300"><CheckCircle2 size={12} /> Eligible</span>
                        ) : (
                          <span className="text-amber-300">Artist account is no longer eligible</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void toggle(item)}
                      disabled={!eligible && !item.isActive}
                      className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 disabled:opacity-40"
                    >
                      {item.isActive ? <Eye size={15} /> : <EyeOff size={15} />}
                      {item.isActive ? "Active" : "Inactive"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(item)}
                      className="rounded-lg border border-red-500/20 bg-red-500/10 p-2 text-red-300"
                      title="Remove"
                    >
                      <Trash2 size={16} />
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
