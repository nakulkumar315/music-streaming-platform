import { useMemo, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  UserPlus,
  Star,
  Shield,
  CreditCard,
  BarChart3,
  FileText,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
  FileSignature,
  RotateCcw,
  UploadCloud,
} from "lucide-react";
import { useSidebar } from "./AdminLayout";
import { http } from "../services/http";
import { getPrivilegedRole } from "../services/adminSession";

type NavItem = {
  label: string;
  to: string;
  matchPrefix?: string;
  icon: React.ReactNode;
};

function BrandLogo() {
  return (
    <img
      src="/logo.png"
      alt="Brand Logo"
      className="h-10 w-10 rounded-full object-cover"
    />
  );
}

function isActivePath(pathname: string, item: NavItem) {
  if (item.matchPrefix) return pathname.startsWith(item.matchPrefix);
  return pathname === item.to;
}

export default function AdminNavbar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { isCollapsed, toggleSidebar } = useSidebar();
  const [mobileOpen, setMobileOpen] = useState(false);
  const role = getPrivilegedRole();

  const navItems: NavItem[] = useMemo(() => {
    const moderationItem: NavItem = {
      label: "Content Moderation",
      to: "/admin/moderation",
      icon: <Shield size={20} />,
    };
    const refundItem: NavItem = {
      label: "Refund Management",
      to: "/admin/refunds",
      icon: <RotateCcw size={20} />,
    };

    if (role === "FINANCE") return [refundItem];
    if (role === "MODERATOR") return [moderationItem];

    return [
      {
        label: "Dashboard",
        to: "/admin/home",
        icon: <LayoutDashboard size={20} />,
      },
      {
        label: "Artist Applications",
        to: "/admin/artist-applications",
        matchPrefix: "/admin/artist-applications",
        icon: <UserPlus size={20} />,
      },
      {
        label: "Artists",
        to: "/admin/artists",
        matchPrefix: "/admin/artists",
        icon: <Users size={20} />,
      },
      {
        label: "Featured Artists",
        to: "/admin/featured-artists",
        icon: <Star size={20} />,
      },
      {
        label: "Upload Content",
        to: "/admin/media-upload",
        icon: <UploadCloud size={20} />,
      },
      moderationItem,
      {
        label: "Agreement Settings",
        to: "/admin/agreement-settings",
        matchPrefix: "/admin/agreement-settings",
        icon: <FileSignature size={20} />,
      },
      {
        label: "Platform Plan",
        to: "/admin/subscription-settings",
        icon: <CreditCard size={20} />,
      },
      refundItem,
      {
        label: "Analytics",
        to: "/admin/analytics",
        icon: <BarChart3 size={20} />,
      },
      {
        label: "Audit Logs",
        to: "/admin/audit",
        icon: <FileText size={20} />,
      },
    ];
  }, [role]);

  const portalLabel =
    role === "FINANCE" ? "Finance Portal" : role === "MODERATOR" ? "Moderation Portal" : "Admin Panel";

  const onLogout = async () => {
    try {
      if (localStorage.getItem("adminToken")) {
        await http.post("/api/v1/admin/logout");
      }
    } catch {
      // Local sign-out must still complete if the session was already revoked
      // or the network is unavailable.
    } finally {
      localStorage.removeItem("adminToken");
      navigate("/admin/login", { replace: true });
    }
  };

  const navigation = (closeMobile = false) =>
    navItems.map((item) => {
      const active = isActivePath(pathname, item);
      return (
        <NavLink
          key={item.to}
          to={item.to}
          onClick={closeMobile ? () => setMobileOpen(false) : undefined}
          className={`flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-all ${
            active
              ? "bg-primary/10 text-primary border border-primary/20"
              : "text-white/60 hover:text-white hover:bg-white/5"
          } ${!closeMobile && isCollapsed ? "justify-center" : ""}`}
          title={!closeMobile && isCollapsed ? item.label : ""}
        >
          {item.icon}
          {(closeMobile || !isCollapsed) && <span>{item.label}</span>}
        </NavLink>
      );
    });

  return (
    <>
      <div className="md:hidden sticky top-0 z-50 w-full border-b border-white/10 bg-background backdrop-blur-xl">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <BrandLogo />
            <span className="text-sm font-medium text-white/80">{portalLabel}</span>
          </div>
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="p-2 rounded-lg border border-white/10 bg-white/5 text-white/70 hover:text-white hover:bg-white/10 transition-all"
          >
            <Menu size={22} />
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm md:hidden"
          onClick={() => setMobileOpen(false)}
        >
          <div
            className="fixed top-0 left-0 h-full w-72 bg-background border-r border-white/10 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <BrandLogo />
                <span className="text-sm font-semibold text-white">{portalLabel}</span>
              </div>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="p-2 rounded-lg hover:bg-white/10 transition-colors"
              >
                <X size={20} className="text-white/70" />
              </button>
            </div>

            <div className="p-4 space-y-1 overflow-y-auto max-h-[calc(100vh-200px)]">
              {navigation(true)}
            </div>

            <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-white/10 bg-background">
              <button
                type="button"
                onClick={onLogout}
                className="flex items-center gap-3 px-4 py-3 w-full rounded-xl text-sm font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-all"
              >
                <LogOut size={20} />
                <span>Logout</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        className={`hidden md:flex fixed left-0 top-0 h-full bg-background border-r border-white/10 shadow-2xl transition-all duration-300 z-50 ${
          isCollapsed ? "w-20" : "w-64"
        }`}
      >
        <div className="flex flex-col h-full w-full">
          <div
            className={`flex items-center gap-3 p-4 border-b border-white/10 ${
              isCollapsed ? "justify-center" : ""
            }`}
          >
            <BrandLogo />
            {!isCollapsed && <span className="text-sm font-semibold text-white">{portalLabel}</span>}
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-1">{navigation(false)}</div>

          <div className="border-t border-white/10 p-3 space-y-2">
            <button
              type="button"
              onClick={toggleSidebar}
              className={`flex items-center gap-3 px-3 py-3 w-full rounded-xl text-sm font-medium text-white/40 hover:text-white hover:bg-white/5 transition-all ${
                isCollapsed ? "justify-center" : ""
              }`}
            >
              {isCollapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
              {!isCollapsed && <span>Collapse</span>}
            </button>

            <button
              type="button"
              onClick={onLogout}
              className={`flex items-center gap-3 px-3 py-3 w-full rounded-xl text-sm font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-all ${
                isCollapsed ? "justify-center" : ""
              }`}
            >
              <LogOut size={20} />
              {!isCollapsed && <span>Logout</span>}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
