import { useEffect, useMemo, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  BarChart3,
  Bell,
  CircleDollarSign,
  Gauge,
  History,
  LogOut,
  Menu,
  Settings,
  User,
  X,
} from "lucide-react";
import { artistRuntimeConfig } from "../config/runtime";
import { clearArtistSession, getArtistToken } from "../services/artistSession";
import { http, toApiFailure } from "../services/http";
import ThemeSwitcher from "./ThemeSwitcher";

type MeResponse = {
  success: boolean;
  artist?: {
    id: number;
    name: string | null;
    email: string;
    isVerified: boolean;
    status: string;
    artistStatus?: string;
    profileImageUrl: string | null;
    accentColor: string | null;
  };
};

type NavItem = {
  path: string;
  label: string;
  icon: React.ReactNode;
};

export default function ArtistShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [me, setMe] = useState<MeResponse["artist"] | null>(null);
  const [sessionUnavailable, setSessionUnavailable] = useState(false);

  const profileSrc = useMemo(() => {
    const raw = String(me?.profileImageUrl || "").trim();
    if (!raw) return null;
    if (/^https?:\/\//i.test(raw)) return raw;
    return raw.startsWith("/")
      ? `${artistRuntimeConfig.apiBaseUrl}${raw}`
      : `${artistRuntimeConfig.apiBaseUrl}/${raw}`;
  }, [me?.profileImageUrl]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!getArtistToken()) {
        navigate("/artist/login", { replace: true });
        return;
      }

      try {
        const res = await http.get<MeResponse>("/api/v1/artist/me");
        if (!mounted) return;
        const artist = res.data?.artist ?? null;
        setMe(artist);
        setSessionUnavailable(false);

        const accountStatus = String(artist?.status || "").toUpperCase();
        const artistStatus = String(artist?.artistStatus || "").toUpperCase();

        if (accountStatus && accountStatus !== "ACTIVE") {
          clearArtistSession();
          navigate("/artist/account-inactive", { replace: true });
          return;
        }
        if (artistStatus === "PENDING") {
          navigate("/artist/under-review", { replace: true });
          return;
        }
        if (artistStatus === "REJECTED") {
          navigate("/artist/rejected", { replace: true });
          return;
        }
        if (!artistStatus && artist && !artist.isVerified) {
          navigate("/artist/pending-approval", { replace: true });
        }
      } catch (error) {
        if (!mounted) return;
        const failure = toApiFailure(error);
        if (failure.status === 401) {
          clearArtistSession();
          navigate("/artist/login", { replace: true });
          return;
        }
        if (failure.status === 403 && failure.code === "ACCOUNT_INACTIVE") {
          clearArtistSession();
          navigate("/artist/account-inactive", { replace: true });
          return;
        }
        if (failure.status === 403 && failure.code === "ARTIST_NOT_APPROVED") {
          navigate("/artist/under-review", { replace: true });
          return;
        }
        setSessionUnavailable(true);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [navigate]);

  const navItems: NavItem[] = useMemo(
    () => [
      { path: "/artist/dashboard", label: "Dashboard", icon: <Gauge size={19} /> },
      { path: "/artist/account", label: "Profile", icon: <User size={19} /> },
      { path: "/artist/content-history", label: "My Content", icon: <History size={19} /> },
      { path: "/artist/analytics-summary", label: "Analytics", icon: <BarChart3 size={19} /> },
      { path: "/artist/pricing", label: "Pricing", icon: <CircleDollarSign size={19} /> },
    ],
    []
  );

  const handleLogout = async () => {
    try {
      if (getArtistToken()) await http.post("/api/v1/auth/logout");
    } catch {
      // Local sign-out still completes when the server session is unavailable.
    } finally {
      clearArtistSession();
      navigate("/artist/login", { replace: true });
    }
  };

  if (sessionUnavailable) {
    return (
      <div className="min-h-screen bg-background text-white flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold">Unable to verify your artist session</h1>
          <p className="mt-2 text-sm text-white/60">Check the server connection and try again.</p>
          <button type="button" onClick={() => window.location.reload()} className="mt-5 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold">Retry</button>
        </div>
      </div>
    );
  }

  const nav = (mobile = false) =>
    navItems.map((item) => {
      const active = location.pathname === item.path;
      return (
        <Link key={item.path} to={item.path} onClick={mobile ? () => setSidebarOpen(false) : undefined} className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${active ? "bg-primary/10 text-primary border border-primary/20" : "text-[#B8A6A1] hover:text-white hover:bg-white/5"}`}>
          {item.icon}<span>{item.label}</span>
        </Link>
      );
    });

  return (
    <div className="min-h-screen bg-background text-white">
      {sidebarOpen && <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden" onClick={() => setSidebarOpen(false)} />}
      <aside className={`fixed left-0 top-0 z-50 h-full w-[280px] border-r border-white/5 bg-background transition-transform lg:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex h-20 items-center justify-between border-b border-white/5 px-6">
          <div className="flex items-center gap-3"><img src="/logo.png" alt="Brand Logo" className="h-10 w-10 rounded-full object-cover" /><span className="text-lg font-bold">Artist Studio</span></div>
          <button className="lg:hidden" onClick={() => setSidebarOpen(false)} aria-label="Close navigation"><X size={20} /></button>
        </div>
        <nav className="space-y-1 p-4">{nav(false)}</nav>
        <div className="absolute bottom-0 left-0 right-0 border-t border-white/5 p-4">
          <div className="flex items-center gap-3 rounded-xl bg-white/5 px-4 py-3">
            <div className="h-9 w-9 overflow-hidden rounded-full border border-white/10 bg-background">{profileSrc ? <img src={profileSrc} alt="Profile" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center font-semibold text-primary">{me?.name?.charAt(0).toUpperCase() || "A"}</div>}</div>
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{me?.name || "Artist"}</p><p className="text-xs text-[#8D7B77]">Artist</p></div>
            <button onClick={handleLogout} className="p-2 text-[#B8A6A1] hover:text-white" title="Logout"><LogOut size={18} /></button>
          </div>
        </div>
      </aside>
      <main className="min-h-screen lg:ml-[280px]">
        <header className="sticky top-0 z-30 flex h-20 items-center justify-between border-b border-white/5 bg-background/80 px-6 backdrop-blur-xl">
          <button className="lg:hidden" onClick={() => setSidebarOpen(true)} aria-label="Open navigation"><Menu size={22} /></button><div />
          <div className="flex items-center gap-3">
            <button className="rounded-xl border border-white/5 bg-white/5 p-2.5 text-[#B8A6A1]" title="Notifications"><Bell size={19} /></button>
            <button className="rounded-xl border border-white/5 bg-white/5 p-2.5 text-[#B8A6A1]" title="Settings" onClick={() => navigate("/artist/account")}><Settings size={19} /></button>
            <ThemeSwitcher />
          </div>
        </header>
        <div className="p-6 lg:p-8"><div className="mx-auto max-w-7xl"><Outlet /></div></div>
      </main>
    </div>
  );
}
