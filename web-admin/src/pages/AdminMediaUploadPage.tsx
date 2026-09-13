import { FormEvent, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Music, UploadCloud, Video } from "lucide-react";
import PageWrapper from "../components/PageWrapper";
import { http } from "../services/http";

type ArtistOption = {
  id: number;
  name: string | null;
  email: string;
  isVerified: boolean;
  status: string;
};

type UploadResult = {
  id: number;
  artistId: number;
  title: string;
  type: "AUDIO" | "VIDEO";
  lifecycleState: string;
  technicalStatus: string;
};

export default function AdminMediaUploadPage() {
  const [artists, setArtists] = useState<ArtistOption[]>([]);
  const [artistId, setArtistId] = useState("");
  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState("");
  const [contentType, setContentType] = useState<"AUDIO" | "VIDEO">("AUDIO");
  const [subscriptionRequired, setSubscriptionRequired] = useState(true);
  const [thumbnail, setThumbnail] = useState<File | null>(null);
  const [media, setMedia] = useState<File | null>(null);
  const [loadingArtists, setLoadingArtists] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoadingArtists(true);
        const response = await http.get("/api/v1/admin/artists", {
          params: { page: 1, limit: 100 },
        });
        const rows = Array.isArray(response.data?.items) ? response.data.items : [];
        const eligible = rows.filter(
          (artist: ArtistOption) =>
            artist.isVerified === true && String(artist.status || "").toUpperCase() === "ACTIVE"
        );
        if (mounted) setArtists(eligible);
      } catch (e: any) {
        if (mounted) setError(e?.response?.data?.message || "Failed to load approved artists");
      } finally {
        if (mounted) setLoadingArtists(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const selectedArtist = useMemo(
    () => artists.find((artist) => String(artist.id) === artistId) || null,
    [artists, artistId]
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setResult(null);

    if (!artistId || !title.trim() || !genre.trim() || !thumbnail || !media) {
      setError("Artist, title, genre, thumbnail and media file are required.");
      return;
    }

    const form = new FormData();
    form.append("artistId", artistId);
    form.append("title", title.trim());
    form.append("genre", genre.trim());
    form.append("contentType", contentType);
    form.append("subscriptionRequired", String(subscriptionRequired));
    form.append("thumbnail", thumbnail);
    form.append("media", media);

    try {
      setSubmitting(true);
      const response = await http.post("/api/v1/admin/media/upload", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setResult(response.data?.content || null);
      setTitle("");
      setGenre("");
      setThumbnail(null);
      setMedia(null);
    } catch (e: any) {
      setError(e?.response?.data?.message || "Content upload failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageWrapper
      title="Upload Content"
      subtitle="ADMIN-governed upload. New releases remain DRAFT until moderation approval."
    >
      {error && (
        <div className="mb-5 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-red-200 flex gap-2">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {result && (
        <div className="mb-5 rounded-xl border border-green-500/20 bg-green-500/10 p-4 text-green-200 flex gap-3">
          <CheckCircle2 size={19} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">Upload registered as DRAFT.</div>
            <div className="text-sm text-green-200/70 mt-1">
              Content #{result.id} · {result.type} · technical state {result.technicalStatus}. It will not be visible to fans until READY and approved.
            </div>
          </div>
        </div>
      )}

      <form onSubmit={submit} className="rounded-2xl border border-white/5 bg-surface p-6 max-w-4xl">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <label className="block">
            <span className="text-sm text-white/60">Artist</span>
            <select
              value={artistId}
              onChange={(e) => setArtistId(e.target.value)}
              disabled={loadingArtists || submitting}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-white outline-none focus:border-primary/50"
            >
              <option value="">{loadingArtists ? "Loading artists…" : "Select approved artist"}</option>
              {artists.map((artist) => (
                <option key={artist.id} value={artist.id}>
                  {artist.name || artist.email} (#{artist.id})
                </option>
              ))}
            </select>
            {selectedArtist && (
              <div className="text-xs text-white/35 mt-1">{selectedArtist.email}</div>
            )}
          </label>

          <label className="block">
            <span className="text-sm text-white/60">Content type</span>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(["AUDIO", "VIDEO"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => setContentType(kind)}
                  className={`rounded-xl border px-3 py-3 flex items-center justify-center gap-2 ${
                    contentType === kind
                      ? "border-primary/40 bg-primary/10 text-white"
                      : "border-white/10 bg-black/20 text-white/55"
                  }`}
                >
                  {kind === "AUDIO" ? <Music size={16} /> : <Video size={16} />}
                  {kind}
                </button>
              ))}
            </div>
          </label>

          <label className="block">
            <span className="text-sm text-white/60">Title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              disabled={submitting}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-white outline-none focus:border-primary/50"
              placeholder="Release title"
            />
          </label>

          <label className="block">
            <span className="text-sm text-white/60">Genre</span>
            <input
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              maxLength={80}
              disabled={submitting}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-white outline-none focus:border-primary/50"
              placeholder="e.g. Indie Pop"
            />
          </label>

          <label className="block">
            <span className="text-sm text-white/60">Thumbnail</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={submitting}
              onChange={(e) => setThumbnail(e.target.files?.[0] || null)}
              className="mt-2 block w-full text-sm text-white/60 file:mr-4 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-white"
            />
            <div className="text-xs text-white/35 mt-1">JPEG, PNG or WebP.</div>
          </label>

          <label className="block">
            <span className="text-sm text-white/60">{contentType === "VIDEO" ? "Video" : "Audio"} file</span>
            <input
              type="file"
              accept={
                contentType === "VIDEO"
                  ? "video/mp4,video/quicktime"
                  : "audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/x-wav,audio/aac"
              }
              disabled={submitting}
              onChange={(e) => setMedia(e.target.files?.[0] || null)}
              className="mt-2 block w-full text-sm text-white/60 file:mr-4 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-white"
            />
            <div className="text-xs text-white/35 mt-1">
              Server validates MIME, size and file signature before provider upload.
            </div>
          </label>
        </div>

        <label className="mt-5 flex items-center gap-3 text-sm text-white/70">
          <input
            type="checkbox"
            checked={subscriptionRequired}
            onChange={(e) => setSubscriptionRequired(e.target.checked)}
            disabled={submitting}
          />
          Require an active subscription for playback
        </label>

        <div className="mt-6 rounded-xl border border-white/5 bg-black/20 p-4 text-sm text-white/50">
          Upload completion does <strong className="text-white/70">not</strong> publish the release. Cloudinary video may remain PROCESSING until its authenticated eager-processing callback arrives. Moderation approval is a separate action.
        </div>

        <button
          type="submit"
          disabled={submitting || loadingArtists}
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 font-medium text-white disabled:opacity-50"
        >
          <UploadCloud size={18} />
          {submitting ? "Uploading…" : "Upload as DRAFT"}
        </button>
      </form>
    </PageWrapper>
  );
}
