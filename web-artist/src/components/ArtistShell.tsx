// src/components/ArtistShell.tsx
import { useEffect, useMemo, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { http } from "../services/http";
import { Bell, Settings as SettingsIcon } from "lucide-react";
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

// Icons
const DashboardIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);

const UploadIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

const HistoryIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const AnalyticsIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round">
    <path d="M21 12v-2a5 5 0 0 0-5-5H8a5 5 0 0 0-5 5v2" />
    <circle cx="12" cy="16" r="5" />
    <line x1="12" y1="11" x2="12" y2="16" />
    <line x1="9" y1="13" x2="12" y2="16" />
    <line x1="15" y1="13" x2="12" y2="16" />
  </svg>
);

const PricingIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="6" x2="12" y2="18" />
    <line x1="8" y1="10" x2="16" y2="10" />
    <line x1="8" y1="14" x2="16" y2="14" />
  </svg>
);

const ProfileIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const LogoutIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

const MenuIcon = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round">
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </svg>
);

function NavItem({
  to,
  icon,
  label,
  isActive,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
}) {
  return (
    <Link
      to={to}
      className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
        isActive
          ? "bg-primary/10 text-primary border border-primary/20 shadow-[0_0_20px_rgba(232,93,44,0.05)]"
          : "text-[#B8A6A1] hover:text-white hover:bg-white/5"
      }`}>
      <span className={isActive ? "text-primary" : "text-[#B8A6A1]"}>
        {icon}
      </span>
      <span>{label}</span>
      {isActive && (
        <span className="ml-auto w-1 h-6 rounded-full bg-primary" />
      )}
    </Link>
  );
}

export default function ArtistShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [me, setMe] = useState<MeResponse["artist"] | null>(null);

  const apiBaseUrl = useMemo(() => {
    return (import.meta.env.VITE_API_BASE_URL || "http://localhost:8000")
      .toString()
      .replace(/\/$/, "");
  }, []);

  const resolvePublicUrl = (url: string | null) => {
    const raw = (url || "").toString().trim();
    if (!raw) return null;
    if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
    if (raw.startsWith("/")) return `${apiBaseUrl}${raw}`;
    return raw;
  };

  const profileSrc = useMemo(() => {
    return resolvePublicUrl(me?.profileImageUrl ?? null);
  }, [apiBaseUrl, me?.profileImageUrl]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const token = localStorage.getItem("artistToken");
      if (!token) return;

      try {
        const res = await http.get<MeResponse>("/api/v1/artist/me");
        if (!mounted) return;

        const artist = res.data?.artist ?? null;
        setMe(artist);

        const status = (artist?.status || "").toUpperCase();
        const artistStatus = (artist as any)?.artistStatus
          ? String((artist as any).artistStatus).toUpperCase()
          : "";
        if (status && status !== "ACTIVE") {
          localStorage.removeItem("artistToken");
          if (location.pathname !== "/artist/account-inactive") {
            navigate("/artist/account-inactive", { replace: true });
          }
          return;
        }

        if (artistStatus === "PENDING") {
          if (location.pathname !== "/artist/under-review") {
            navigate("/artist/under-review", { replace: true });
          }
          return;
        }

        if (artistStatus === "REJECTED") {
          if (location.pathname !== "/artist/rejected") {
            navigate("/artist/rejected", { replace: true });
          }
          return;
        }

        if (!artistStatus && artist && !artist.isVerified) {
          if (location.pathname !== "/artist/pending-approval") {
            navigate("/artist/pending-approval", { replace: true });
          }
          return;
        }
      } catch (e: any) {
        const status = e?.response?.status;
        if (status === 403) {
          const msg = (e?.response?.data?.message ?? "")
            .toString()
            .toLowerCase();
          if (msg.includes("inactive") || msg.includes("suspended")) {
            localStorage.removeItem("artistToken");
            if (location.pathname !== "/artist/account-inactive") {
              navigate("/artist/account-inactive", { replace: true });
            }
            return;
          }
        }

        if (status === 401 || status === 403) {
          localStorage.removeItem("artistToken");
          if (location.pathname !== "/artist/login") {
            navigate("/artist/login", { replace: true });
          }
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [navigate, location.pathname]);

  const handleLogout = async () => {
    try {
      if (localStorage.getItem("artistToken")) {
        await http.post("/api/v1/auth/logout");
      }
    } catch {
      // Local sign-out must still complete when the server session is already
      // revoked or the network is unavailable.
    } finally {
      localStorage.removeItem("artistToken");
      navigate("/artist/login", { replace: true });
    }
  };

  const activePath = location.pathname;

  const navItems = useMemo(() => {
    const status = (me as any)?.artistStatus
      ? String((me as any).artistStatus).toUpperCase()
      : "";
    const locked = status === "PENDING" || status === "REJECTED";

    const items = [
      {
        path: "/artist/dashboard",
        icon: <DashboardIcon />,
        label: "Dashboard",
      },
      { path: "/artist/account", icon: <ProfileIcon />, label: "Profile" },
    ];

    if (!locked) {
      items.push(
        {
          path: "/artist/content-upload",
          icon: <UploadIcon />,
          label: "Upload",
        },
        {
          path: "/artist/content-history",
          icon: <HistoryIcon />,
          label: "History",
        },
        {
          path: "/artist/analytics-summary",
          icon: <AnalyticsIcon />,
          label: "Analytics",
        },
        { path: "/artist/pricing", icon: <PricingIcon />, label: "Pricing" }
      );
    } else {
      items.push(
        {
          path: "/artist/content-history",
          icon: <HistoryIcon />,
          label: "History",
        },
        {
          path: "/artist/analytics-summary",
          icon: <AnalyticsIcon />,
          label: "Analytics",
        }
      );
    }

    return items;
  }, [me]);

  const isActive = (path: string) => activePath === path;

  return (
    <div className="min-h-screen bg-background text-white font-sans antialiased">
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`
        fixed top-0 left-0 h-full w-[280px] bg-background border-r border-white/5 z-50
        transition-transform duration-300 ease-in-out
        ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
        lg:translate-x-0
      `}>
        <div className="flex items-center gap-3 px-6 h-20 border-b border-white/5">
          <img
            src="/logo.png"
            alt="Brand Logo"
            className="h-10 w-10 rounded-full object-cover"
          />
          <span className="text-lg font-bold tracking-tight">
            Artist Studio
          </span>
        </div>

        <nav className="p-4 space-y-1">
          {navItems.map((item) => (
            <NavItem
              key={item.path}
              to={item.path}
              icon={item.icon}
              label={item.label}
              isActive={isActive(item.path)}
            />
          ))}
        </nav>

        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-white/5">
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5">
            <div className="h-9 w-9 rounded-full overflow-hidden border border-white/10 bg-background">
              {profileSrc ? (
                <img
                  src={profileSrc}
                  alt="Profile"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="h-full w-full bg-gradient-to-br from-primary/30 to-secondary/30 flex items-center justify-center text-sm font-bold text-primary">
                  {me?.name?.charAt(0).toUpperCase() || "A"}
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">
                {me?.name || "Artist"}
              </p>
              <p className="text-xs text-[#8D7B77]">Artist</p>
            </div>
            <button
              onClick={handleLogout}
              className="p-2 rounded-lg hover:bg-white/10 transition-colors text-[#B8A6A1] hover:text-white">
              <LogoutIcon />
            </button>
          </div>
        </div>
      </aside>

      <main className="lg:ml-[280px] min-h-screen">
        <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-xl border-b border-white/5 px-6 h-20 flex items-center justify-between">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-2 rounded-lg hover:bg-white/5 transition-colors text-[#B8A6A1]">
            <MenuIcon />
          </button>

          <div className="flex-1 lg:flex-none" />

          <div className="flex items-center gap-4">
            <a
              href="exp://localhost:8081"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 hover:border-primary/50 transition-all">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2">
                <rect x="5" y="2" width="14" height="20" rx="2" />
                <circle cx="12" cy="18" r="1" fill="currentColor" />
              </svg>
              Fan App
            </a>

            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/10 bg-white/5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs text-[#B8A6A1]">Active</span>
            </div>

            <button 
              type="button" 
              className="p-2.5 rounded-xl border border-white/5 bg-white/5 text-[#B8A6A1] hover:text-white hover:bg-white/10 hover:border-white/10 transition-all duration-300 flex items-center justify-center"
              title="Notifications"
            >
              <Bell size={20} />
            </button>

            <button 
              type="button"
              onClick={() => navigate("/artist/account")}
              className="p-2.5 rounded-xl border border-white/5 bg-white/5 text-[#B8A6A1] hover:text-white hover:bg-white/10 hover:border-white/10 transition-all duration-300 flex items-center justify-center" 
              title="Settings"
            >
              <SettingsIcon size={20} />
            </button>

            <ThemeSwitcher />

            <button
              onClick={handleLogout}
              className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-[#B8A6A1] hover:text-white hover:bg-white/5 transition-all">
              <LogoutIcon />
              Logout
            </button>
          </div>
        </header>

        <div className="p-6 lg:p-8">
          <div className="max-w-7xl mx-auto">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}
