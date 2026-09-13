import { useEffect, useMemo, useRef, useState } from "react";
import ImageCropModal from "../components/ImageCropModal";
import { artistRuntimeConfig } from "../config/runtime";
import { http } from "../services/http";

const CameraIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
    <circle cx="12" cy="13" r="4"/>
  </svg>
);

const ImageIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
    <circle cx="8.5" cy="8.5" r="1.5"/>
    <polyline points="21 15 16 10 5 21"/>
  </svg>
);

const SpotifyIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
  </svg>
);

const YoutubeIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
  </svg>
);

const InstagramIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/>
    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>
  </svg>
);

const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);

const AlertIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="12" y1="8" x2="12" y2="12"/>
    <line x1="12" y1="16" x2="12.01" y2="16"/>
  </svg>
);

const LinkIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
  </svg>
);

type MeResponse = {
  success: boolean;
  artist?: {
    id: number;
    email: string;
    name: string | null;
    profileImageUrl: string | null;
    bannerImageUrl: string | null;
    bio: string;
    accentColor: string | null;
    artistStatus?: string;
    socialLinks?: Record<string, unknown> | null;
  };
};

function normalizeExternalUrl(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export default function ArtistAccountPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [imageUploading, setImageUploading] = useState<"profile" | "banner" | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"profile" | "socials">("profile");

  const [registeredEmail, setRegisteredEmail] = useState<string>("");
  const [artistStatus, setArtistStatus] = useState<string>("PENDING");

  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [profileImageUrl, setProfileImageUrl] = useState<string | null>(null);
  const [bannerImageUrl, setBannerImageUrl] = useState<string | null>(null);

  const [spotify, setSpotify] = useState("");
  const [youtube, setYoutube] = useState("");
  const [instagram, setInstagram] = useState("");

  const [profileLocalPreview, setProfileLocalPreview] = useState<string | null>(null);
  const [bannerLocalPreview, setBannerLocalPreview] = useState<string | null>(null);

  const profileInputRef = useRef<HTMLInputElement | null>(null);
  const bannerInputRef = useRef<HTMLInputElement | null>(null);

  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);
  const [cropType, setCropType] = useState<"profile" | "banner">("profile");
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const apiBaseUrl = artistRuntimeConfig.apiBaseUrl;

  const resolvePublicUrl = (url: string | null) => {
    const raw = String(url ?? "").trim();
    if (!raw) return null;
    if (raw.startsWith("/")) {
      return new URL(raw, `${apiBaseUrl}/`).toString();
    }
    return normalizeExternalUrl(raw);
  };

  const profileSrc = useMemo(() => {
    return profileLocalPreview || resolvePublicUrl(profileImageUrl);
  }, [profileImageUrl, profileLocalPreview]);
  const bannerSrc = useMemo(() => {
    return bannerLocalPreview || resolvePublicUrl(bannerImageUrl);
  }, [bannerImageUrl, bannerLocalPreview]);

  useEffect(() => {
    return () => {
      if (profileLocalPreview) URL.revokeObjectURL(profileLocalPreview);
      if (bannerLocalPreview) URL.revokeObjectURL(bannerLocalPreview);
    };
  }, [bannerLocalPreview, profileLocalPreview]);

  const uploadImage = async (kind: "profile" | "banner", file: File) => {
    setImageError(null);
    setImageUploading(kind);
    try {
      const form = new FormData();
      form.append("kind", kind);
      form.append("image", file);

      const res = await http.post<{ success: boolean; url?: string }>(
        "/api/v1/artist/uploads/image",
        form,
        { headers: { "Content-Type": "multipart/form-data" } }
      );

      const url = resolvePublicUrl(res.data?.url ?? null);
      if (!url) {
        setImageError("Upload failed. Please try again.");
        return;
      }

      if (kind === "profile") setProfileImageUrl(url);
      if (kind === "banner") setBannerImageUrl(url);
    } catch (err: any) {
      const message =
        (err?.response?.data?.message as string | undefined) ||
        (err?.message as string | undefined) ||
        "Upload failed. Please try again.";
      setImageError(message);
    } finally {
      setImageUploading(null);
    }
  };

  const onPickImage = async (kind: "profile" | "banner", file: File) => {
    const objectUrl = URL.createObjectURL(file);
    setCropType(kind);
    setCropImageSrc(objectUrl);
    setPendingFile(file);
    setCropModalOpen(true);
  };

  const handleCropConfirm = async (croppedBlob: Blob) => {
    if (!pendingFile || !cropImageSrc) return;

    const croppedFile = new File(
      [croppedBlob],
      `cropped-${cropType}-${Date.now()}.jpg`,
      { type: "image/jpeg" }
    );

    await uploadImage(cropType, croppedFile);

    URL.revokeObjectURL(cropImageSrc);
    setCropModalOpen(false);
    setCropImageSrc(null);
    setPendingFile(null);
  };

  const handleCropCancel = () => {
    if (cropImageSrc) URL.revokeObjectURL(cropImageSrc);
    setCropModalOpen(false);
    setCropImageSrc(null);
    setPendingFile(null);
  };

  const onPasteImage = async (kind: "profile" | "banner", e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items?.length) return;

    const imgItem = Array.from(items).find((it) => it.type.startsWith("image/"));
    if (!imgItem) return;

    const blob = imgItem.getAsFile();
    if (!blob) return;

    e.preventDefault();

    const ext = blob.type.split("/")[1] || "png";
    const file = new File([blob], `${kind}-${Date.now()}.${ext}`, { type: blob.type });
    const objectUrl = URL.createObjectURL(blob);
    setCropType(kind);
    setCropImageSrc(objectUrl);
    setPendingFile(file);
    setCropModalOpen(true);
  };

  const backgroundStyle = useMemo(() => {
    return {
      backgroundImage:
        "radial-gradient(ellipse at top, rgba(193,117,86,0.15) 0%, rgba(20,16,16,0.8) 50%, rgba(10,8,8,0.95) 100%)"
    } as const;
  }, []);

  const isVerified = artistStatus.toUpperCase() === "APPROVED";
  const completionPercentage = useMemo(() => {
    let score = 0;
    if (name) score += 20;
    if (bio) score += 20;
    if (profileImageUrl) score += 20;
    if (bannerImageUrl) score += 20;
    if (spotify && youtube && instagram) score += 20;
    return score;
  }, [name, bio, profileImageUrl, bannerImageUrl, spotify, youtube, instagram]);

  const load = async () => {
    const res = await http.get<MeResponse>("/api/v1/artist/me");
    const artist = res.data?.artist;
    if (!artist) throw new Error("Artist profile is unavailable");

    setRegisteredEmail(String(artist.email ?? ""));
    setArtistStatus(String(artist.artistStatus ?? "PENDING"));
    setName(artist.name ?? "");
    setBio(artist.bio ?? "");
    setProfileImageUrl(resolvePublicUrl(artist.profileImageUrl ?? null));
    setBannerImageUrl(resolvePublicUrl(artist.bannerImageUrl ?? null));

    const socials = artist.socialLinks ?? {};
    setSpotify(normalizeExternalUrl(socials.spotify) ?? "");
    setYoutube(normalizeExternalUrl(socials.youtube) ?? "");
    setInstagram(normalizeExternalUrl(socials.instagram) ?? "");
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        setSaveError(null);
        await load();
      } catch (err: any) {
        if (mounted) {
          setSaveError(
            err?.response?.data?.message || err?.message || "Failed to load profile"
          );
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setSaveError(null);

    const spotifyUrl = normalizeExternalUrl(spotify);
    const youtubeUrl = normalizeExternalUrl(youtube);
    const instagramUrl = normalizeExternalUrl(instagram);

    if (!spotifyUrl || !youtubeUrl || !instagramUrl) {
      setSaveError("Spotify, YouTube, and Instagram must be valid http(s) URLs.");
      setSaving(false);
      return;
    }

    try {
      await http.patch("/api/v1/artist/me", {
        name,
        bio,
        profileImageUrl: resolvePublicUrl(profileImageUrl),
        bannerImageUrl: resolvePublicUrl(bannerImageUrl),
        socialLinks: {
          spotify: spotifyUrl,
          youtube: youtubeUrl,
          instagram: instagramUrl,
        },
      });
      await load();
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (err: any) {
      setSaveError(err?.response?.data?.message || err?.message || "Failed to save changes");
    } finally {
      setSaving(false);
    }
  };

  const spotifyHref = normalizeExternalUrl(spotify);
  const youtubeHref = normalizeExternalUrl(youtube);
  const instagramHref = normalizeExternalUrl(instagram);

  return (
    <>
      <ImageCropModal
        isOpen={cropModalOpen}
        imageSrc={cropImageSrc}
        cropShape={cropType === "profile" ? "round" : "rect"}
        aspect={cropType === "profile" ? 1 : 3}
        onClose={handleCropCancel}
        onConfirm={handleCropConfirm}
      />

      <div
        className="relative min-h-screen overflow-hidden rounded-[16px] border border-white/10 bg-gradient-to-br from-[#1a1412] via-surface to-[#0a0808] backdrop-blur-xl shadow-[0_30px_100px_rgba(0,0,0,0.6)]"
        style={backgroundStyle}
      >
      <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-secondary/5 rounded-full blur-[150px] pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-secondary/3 rounded-full blur-[120px] pointer-events-none" />
      
      <div className="relative px-6 py-8 sm:px-10 sm:py-10 lg:px-12 lg:py-12">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-[32px] font-bold tracking-tight text-white mb-1">Profile Settings</h1>
            <p className="text-[14px] text-[#a99792]">Manage your artist identity and social presence</p>
          </div>
          <div className="flex items-center gap-3 bg-white/5 rounded-xl px-4 py-3 border border-white/10">
            <div className="relative w-12 h-12">
              <svg className="w-12 h-12 -rotate-90" viewBox="0 0 36 36">
                <path
                  className="text-white/10"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                />
                <path
                  className="text-secondary"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeDasharray={`${completionPercentage}, 100`}
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-white">
                {completionPercentage}%
              </span>
            </div>
            <div className="text-left">
              <p className="text-[13px] font-medium text-white">Profile Completion</p>
              <p className="text-[11px] text-[#8d7b77]">
                {completionPercentage === 100 ? "All set! 🎉" : "Complete your profile"}
              </p>
            </div>
          </div>
        </div>

        <div className="relative rounded-[20px] border border-white/10 bg-[#0e0a0a]/60 overflow-hidden mb-8 shadow-2xl">
          <div className="relative min-h-[240px] max-h-[400px] bg-gradient-to-br from-[#2a1f1a] to-[#0f0c0a] group flex items-center justify-center">
            {bannerSrc ? (
              <img 
                src={bannerSrc} 
                alt="Banner" 
                className="max-h-[400px] w-full object-contain transition-transform duration-700 group-hover:scale-[1.02]" 
              />
            ) : (
              <div className="h-[240px] w-full flex items-center justify-center">
                <div className="text-center">
                  <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-white/5 flex items-center justify-center border border-white/10">
                    <ImageIcon />
                  </div>
                  <p className="text-[#8d7b77] text-sm">Add a banner image</p>
                </div>
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-[#0e0a0a] via-transparent to-black/20 pointer-events-none" />
            <button
              type="button"
              disabled={Boolean(imageUploading)}
              onClick={() => bannerInputRef.current?.click()}
              className="absolute top-4 right-4 flex items-center gap-2 px-4 py-2 rounded-lg bg-black/60 backdrop-blur-md border border-white/10 text-[13px] text-white hover:bg-black/80 transition-all group/btn disabled:opacity-50"
            >
              <CameraIcon />
              <span className="hidden sm:inline">{bannerSrc ? "Change Banner" : "Add Banner"}</span>
            </button>

            <input
              ref={bannerInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              disabled={Boolean(imageUploading)}
              onChange={async (e) => {
                const input = e.currentTarget;
                const file = e.target.files?.[0];
                if (!file) return;
                await onPickImage("banner", file);
                input.value = "";
              }}
            />
          </div>

          <div className="px-6 pb-6 sm:px-8 sm:pb-8">
            <div className="flex flex-col sm:flex-row items-start sm:items-end gap-5 -mt-16 relative z-10">
              <div className="relative group">
                <div className="w-[120px] h-[120px] rounded-full overflow-hidden border-4 border-[#0e0a0a] bg-surface shadow-2xl">
                  {profileSrc ? (
                    <img src={profileSrc} alt="Profile" className="h-full w-full object-cover" />
                  ) : (
                    <div className="h-full w-full bg-gradient-to-br from-secondary/20 to-[#2a1a17] flex items-center justify-center">
                      <span className="text-[40px] font-bold text-secondary">
                        {name ? name[0].toUpperCase() : "A"}
                      </span>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  disabled={Boolean(imageUploading)}
                  onClick={() => profileInputRef.current?.click()}
                  className="absolute inset-0 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all border-4 border-[#0e0a0a] disabled:cursor-not-allowed"
                >
                  <div className="text-center text-white">
                    <CameraIcon />
                    <span className="text-[11px] block mt-1">Change</span>
                  </div>
                </button>

                <div className={`absolute -bottom-2 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border-2 border-[#0e0a0a] whitespace-nowrap shadow-lg ${
                  isVerified
                    ? "bg-emerald-500 text-white border-emerald-600"
                    : "bg-amber-500 text-white border-amber-600"
                }`}>
                  {isVerified ? (
                    <span className="flex items-center gap-1">
                      <CheckIcon /> Verified
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <AlertIcon /> Pending
                    </span>
                  )}
                </div>

                <input
                  ref={profileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  disabled={Boolean(imageUploading)}
                  onChange={async (e) => {
                    const input = e.currentTarget;
                    const file = e.target.files?.[0];
                    if (!file) return;
                    await onPickImage("profile", file);
                    input.value = "";
                  }}
                />
              </div>

              <div className="flex-1 pb-2">
                <h2 className="text-[24px] font-bold text-white tracking-tight">{name || "Your Name"}</h2>
                <p className="text-[14px] text-[#a99792] flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-secondary"></span>
                  {registeredEmail || "artist@example.com"}
                </p>
              </div>

              {imageUploading && (
                <div className="px-4 py-2 rounded-lg bg-secondary/10 border border-secondary/30 text-[13px] text-secondary flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-secondary/30 border-t-secondary rounded-full animate-spin" />
                  Uploading {imageUploading} image...
                </div>
              )}
            </div>
          </div>
        </div>

        {imageError && (
          <div className="mb-6 rounded-xl border border-rose-500/30 bg-rose-500/10 px-5 py-4 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-rose-500/20 flex items-center justify-center text-rose-400">
              <AlertIcon />
            </div>
            <p className="text-[14px] text-rose-300">{imageError}</p>
          </div>
        )}
        
        {saveError && (
          <div className="mb-6 rounded-xl border border-rose-500/30 bg-rose-500/10 px-5 py-4 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-rose-500/20 flex items-center justify-center text-rose-400">
              <AlertIcon />
            </div>
            <p className="text-[14px] text-rose-300">{saveError}</p>
          </div>
        )}

        {saved && (
          <div className="mb-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-4 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400">
              <CheckIcon />
            </div>
            <p className="text-[14px] text-emerald-300">Profile saved successfully!</p>
          </div>
        )}

        <div className="flex items-center gap-2 mb-6">
          <button
            type="button"
            onClick={() => setActiveTab("profile")}
            className={`px-6 py-3 rounded-xl text-[14px] font-medium transition-all ${
              activeTab === "profile"
                ? "bg-secondary text-white shadow-lg shadow-secondary/25"
                : "bg-white/5 text-[#a99792] hover:bg-white/10 hover:text-white"
            }`}
          >
            <span className="flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
              Profile Info
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("socials")}
            className={`px-6 py-3 rounded-xl text-[14px] font-medium transition-all ${
              activeTab === "socials"
                ? "bg-secondary text-white shadow-lg shadow-secondary/25"
                : "bg-white/5 text-[#a99792] hover:bg-white/10 hover:text-white"
            }`}
          >
            <span className="flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
              Social Links
            </span>
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
          <div className="space-y-6">
            {activeTab === "profile" ? (
              <div className="rounded-[20px] border border-white/10 bg-[#0e0a0a]/40 p-6 sm:p-8 backdrop-blur-sm">
                <h3 className="text-[18px] font-semibold text-white mb-6 flex items-center gap-2">
                  <span className="w-8 h-8 rounded-lg bg-secondary/20 flex items-center justify-center text-secondary">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                  </span>
                  Basic Information
                </h3>

                <div className="space-y-5">
                  <div>
                    <label className="block text-[12px] uppercase tracking-wider text-[#8d7b77] mb-2 font-medium">
                      Display Name <span className="text-secondary">*</span>
                    </label>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      disabled={loading || saving}
                      className="w-full h-[52px] rounded-xl bg-white/5 border border-white/10 px-5 text-[15px] text-white placeholder-[#5a4a45] outline-none focus:border-secondary/50 focus:bg-white/[0.07] focus:ring-1 focus:ring-secondary/20 transition-all disabled:opacity-50"
                      placeholder="How fans will know you"
                    />
                  </div>

                  <div>
                    <label className="block text-[12px] uppercase tracking-wider text-[#8d7b77] mb-2 font-medium">
                      Bio <span className="text-secondary">*</span>
                    </label>
                    <textarea
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                      rows={4}
                      maxLength={500}
                      disabled={loading || saving}
                      className="w-full rounded-xl bg-white/5 border border-white/10 px-5 py-4 text-[15px] text-white placeholder-[#5a4a45] outline-none focus:border-secondary/50 focus:bg-white/[0.07] focus:ring-1 focus:ring-secondary/20 transition-all resize-none disabled:opacity-50"
                      placeholder="Tell fans about your music, style, and story..."
                    />
                    <div className="flex justify-between mt-2">
                      <span className="text-[12px] text-[#5a4a45]">Max 500 characters</span>
                      <span className="text-[12px] text-[#5a4a45]">{bio.length}/500</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div>
                      <label className="block text-[12px] uppercase tracking-wider text-[#8d7b77] mb-2 font-medium">
                        Profile Image URL
                      </label>
                      <div className="relative">
                        <input
                          value={profileImageUrl ?? ""}
                          onChange={(e) => setProfileImageUrl(e.target.value || null)}
                          disabled={loading || saving || Boolean(imageUploading)}
                          className="w-full h-[48px] rounded-xl bg-white/5 border border-white/10 pl-11 pr-4 text-[14px] text-white placeholder-[#5a4a45] outline-none focus:border-secondary/50 focus:bg-white/[0.07] transition-all disabled:opacity-50"
                          placeholder="https://..."
                        />
                        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[#5a4a45]">
                          <LinkIcon />
                        </div>
                      </div>
                      <div 
                        className="mt-3 rounded-xl border border-dashed border-white/20 bg-white/[0.03] p-4 text-center cursor-pointer hover:border-secondary/40 hover:bg-white/[0.05] transition-all"
                        tabIndex={0}
                        onPaste={(e) => onPasteImage("profile", e)}
                      >
                        <div className="text-[#8d7b77] text-[13px]">
                          <span className="text-secondary">Paste</span> image here or
                          <button
                            type="button"
                            disabled={Boolean(imageUploading)}
                            onClick={() => profileInputRef.current?.click()}
                            className="ml-1 text-white hover:underline disabled:opacity-50"
                          >
                            browse
                          </button>
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[12px] uppercase tracking-wider text-[#8d7b77] mb-2 font-medium">
                        Banner Image URL
                      </label>
                      <div className="relative">
                        <input
                          value={bannerImageUrl ?? ""}
                          onChange={(e) => setBannerImageUrl(e.target.value || null)}
                          disabled={loading || saving || Boolean(imageUploading)}
                          className="w-full h-[48px] rounded-xl bg-white/5 border border-white/10 pl-11 pr-4 text-[14px] text-white placeholder-[#5a4a45] outline-none focus:border-secondary/50 focus:bg-white/[0.07] transition-all disabled:opacity-50"
                          placeholder="https://..."
                        />
                        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[#5a4a45]">
                          <LinkIcon />
                        </div>
                      </div>
                      <div 
                        className="mt-3 rounded-xl border border-dashed border-white/20 bg-white/[0.03] p-4 text-center cursor-pointer hover:border-secondary/40 hover:bg-white/[0.05] transition-all"
                        tabIndex={0}
                        onPaste={(e) => onPasteImage("banner", e)}
                      >
                        <div className="text-[#8d7b77] text-[13px]">
                          <span className="text-secondary">Paste</span> image here or
                          <button
                            type="button"
                            disabled={Boolean(imageUploading)}
                            onClick={() => bannerInputRef.current?.click()}
                            className="ml-1 text-white hover:underline disabled:opacity-50"
                          >
                            browse
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-[20px] border border-white/10 bg-[#0e0a0a]/40 p-6 sm:p-8 backdrop-blur-sm">
                <h3 className="text-[18px] font-semibold text-white mb-6 flex items-center gap-2">
                  <span className="w-8 h-8 rounded-lg bg-secondary/20 flex items-center justify-center text-secondary">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                    </svg>
                  </span>
                  Social Connections
                </h3>

                <div className="space-y-5">
                  <div>
                    <label className="flex items-center gap-2 text-[12px] uppercase tracking-wider text-[#8d7b77] mb-2 font-medium">
                      <span className="text-[#1DB954]"><SpotifyIcon /></span>
                      Spotify Profile <span className="text-secondary">*</span>
                    </label>
                    <div className="relative">
                      <input
                        type="url"
                        value={spotify}
                        onChange={(e) => setSpotify(e.target.value)}
                        disabled={loading || saving}
                        className="w-full h-[52px] rounded-xl bg-white/5 border border-white/10 pl-12 pr-5 text-[15px] text-white placeholder-[#5a4a45] outline-none focus:border-[#1DB954]/50 focus:bg-white/[0.07] transition-all disabled:opacity-50"
                        placeholder="https://open.spotify.com/artist/..."
                      />
                      <div className="absolute left-4 top-1/2 -translate-y-1/2">
                        <SpotifyIcon />
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="flex items-center gap-2 text-[12px] uppercase tracking-wider text-[#8d7b77] mb-2 font-medium">
                      <span className="text-[#FF0000]"><YoutubeIcon /></span>
                      YouTube Channel <span className="text-secondary">*</span>
                    </label>
                    <div className="relative">
                      <input
                        type="url"
                        value={youtube}
                        onChange={(e) => setYoutube(e.target.value)}
                        disabled={loading || saving}
                        className="w-full h-[52px] rounded-xl bg-white/5 border border-white/10 pl-12 pr-5 text-[15px] text-white placeholder-[#5a4a45] outline-none focus:border-[#FF0000]/50 focus:bg-white/[0.07] transition-all disabled:opacity-50"
                        placeholder="https://youtube.com/@..."
                      />
                      <div className="absolute left-4 top-1/2 -translate-y-1/2">
                        <YoutubeIcon />
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="flex items-center gap-2 text-[12px] uppercase tracking-wider text-[#8d7b77] mb-2 font-medium">
                      <span className="text-[#E4405F]"><InstagramIcon /></span>
                      Instagram Profile <span className="text-secondary">*</span>
                    </label>
                    <div className="relative">
                      <input
                        type="url"
                        value={instagram}
                        onChange={(e) => setInstagram(e.target.value)}
                        disabled={loading || saving}
                        className="w-full h-[52px] rounded-xl bg-white/5 border border-white/10 pl-12 pr-5 text-[15px] text-white placeholder-[#5a4a45] outline-none focus:border-[#E4405F]/50 focus:bg-white/[0.07] transition-all disabled:opacity-50"
                        placeholder="https://instagram.com/..."
                      />
                      <div className="absolute left-4 top-1/2 -translate-y-1/2">
                        <InstagramIcon />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-6 p-4 rounded-xl bg-secondary/10 border border-secondary/20">
                  <p className="text-[13px] text-secondary flex items-start gap-2">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mt-0.5 flex-shrink-0">
                      <circle cx="12" cy="12" r="10"/>
                      <line x1="12" y1="16" x2="12" y2="12"/>
                      <line x1="12" y1="8" x2="12.01" y2="8"/>
                    </svg>
                    All social links are required and will be displayed on your public artist profile for fans to connect with you.
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-6">
            <div className="rounded-[20px] border border-white/10 bg-[#0e0a0a]/40 p-6 backdrop-blur-sm">
              <h4 className="text-[14px] uppercase tracking-wider text-[#8d7b77] mb-4 font-semibold">Profile Preview</h4>
              <div className="rounded-xl overflow-hidden border border-white/10 bg-surface">
                <div className="h-[100px] bg-gradient-to-br from-secondary/30 to-[#2a1a17] relative flex items-center justify-center overflow-hidden">
                  {bannerSrc && <img src={bannerSrc} alt="" className="h-full w-full object-contain" />}
                </div>
                <div className="px-4 pb-4 relative">
                  <div className="relative -mt-8 mb-2">
                    <div className="w-16 h-16 rounded-full overflow-hidden border-4 border-surface bg-[#0e0a0a] shadow-xl">
                      {profileSrc ? (
                        <img src={profileSrc} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="h-full w-full bg-gradient-to-br from-secondary/20 to-[#2a1a17] flex items-center justify-center text-secondary font-bold text-xl">
                          {name ? name[0].toUpperCase() : "A"}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <h5 className="text-white font-semibold truncate">{name || "Artist Name"}</h5>
                    {isVerified && (
                      <span className="w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] text-[#8d7b77] line-clamp-2 mt-1">{bio || "No bio yet"}</p>
                  <div className="flex items-center gap-3 mt-3">
                    {spotifyHref && (
                      <a href={spotifyHref} target="_blank" rel="noopener noreferrer" className="w-8 h-8 rounded-full bg-[#1DB954]/20 flex items-center justify-center text-[#1DB954] hover:bg-[#1DB954]/30 transition-colors">
                        <SpotifyIcon />
                      </a>
                    )}
                    {youtubeHref && (
                      <a href={youtubeHref} target="_blank" rel="noopener noreferrer" className="w-8 h-8 rounded-full bg-[#FF0000]/20 flex items-center justify-center text-[#FF0000] hover:bg-[#FF0000]/30 transition-colors">
                        <YoutubeIcon />
                      </a>
                    )}
                    {instagramHref && (
                      <a href={instagramHref} target="_blank" rel="noopener noreferrer" className="w-8 h-8 rounded-full bg-[#E4405F]/20 flex items-center justify-center text-[#E4405F] hover:bg-[#E4405F]/30 transition-colors">
                        <InstagramIcon />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-[20px] border border-white/10 bg-[#0e0a0a]/40 p-6 backdrop-blur-sm">
              <h4 className="text-[14px] uppercase tracking-wider text-[#8d7b77] mb-4 font-semibold">Actions</h4>
              <button
                type="button"
                disabled={saving || loading || Boolean(imageUploading)}
                onClick={save}
                className="w-full h-[52px] rounded-xl bg-gradient-to-r from-secondary to-[#a85d3c] text-white font-semibold text-[15px] shadow-lg shadow-secondary/25 hover:shadow-secondary/40 hover:from-[#d48a64] hover:to-[#b86d4c] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {saving ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <CheckIcon />
                    Save Changes
                  </>
                )}
              </button>
              
              {saved && (
                <p className="text-center text-[13px] text-emerald-400 mt-3 flex items-center justify-center gap-1">
                  <CheckIcon /> Saved successfully
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
