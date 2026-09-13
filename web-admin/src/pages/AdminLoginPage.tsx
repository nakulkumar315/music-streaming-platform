import {
  Activity,
  BarChart3,
  Eye,
  EyeOff,
  Lock,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { http, toApiFailure } from "../services/http";

function EyeIcon({ open }: { open: boolean }) {
  return open ? <Eye size={18} /> : <EyeOff size={18} />;
}

export default function AdminLoginPage() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const backgroundStyle = useMemo(() => {
    return {
      backgroundImage: "url(/image_3e012a.jpg)",
      backgroundSize: "cover",
      backgroundPosition: "center",
      backgroundRepeat: "no-repeat",
    } as const;
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);

    try {
      const res = await http.post("/api/v1/admin/login", {
        email: email.trim(),
        password,
      });

      if (!res.data?.success || typeof res.data?.token !== "string") {
        setError("Login failed");
        return;
      }

      // Token persistence is centralized in the HTTP/session foundation.
      // The protected route gate will immediately refresh the current role
      // and account state from the backend before privileged UI is rendered.
      navigate("/admin/home", { replace: true });
    } catch (err) {
      const failure = toApiFailure(err);
      setError(
        failure.status === 401
          ? "Invalid email or password"
          : failure.message || "Login failed"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-background">
      <div
        className="absolute inset-0 grayscale opacity-25"
        style={backgroundStyle}
      />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_40%_50%,rgba(232,93,44,0.15)_0%,rgba(10,10,10,0.85)_60%,var(--color-bg)_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_80%,rgba(232,93,44,0.08)_0%,transparent_50%)]" />
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgdmlld0JveD0iMCAwIDQwIDQwIj48cGF0aCBkPSJNMzkuNSAwLjVMMC41IDM5LjUiIHN0cm9rZT0icmdiYSgyNTUsMjU1LDI1NSwwLjAxNSkiIHN0cm9rZS13aWR0aD0iMSIvPjwvc3ZnPg==')] opacity-40" />

      <div className="relative min-h-screen flex items-center justify-center px-4 sm:px-8 py-8">
        <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">
          <div className="order-2 lg:order-1 space-y-8 text-center lg:text-left">
            <div className="inline-flex items-center gap-2.5 px-5 py-2 rounded-full border border-white/10 bg-white/5 backdrop-blur-sm text-primary text-sm font-medium tracking-wide mx-auto lg:mx-0 hover:bg-white/10 transition-all duration-300">
              <ShieldCheck size={16} className="text-primary" />
              <span>Secure Admin Portal</span>
              <span className="w-1.5 h-1.5 rounded-full bg-primary/50"></span>
              <span className="text-[#8D7B77] text-xs">v3.2</span>
            </div>

            <div className="space-y-3">
              <h1 className="text-5xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight leading-[1.05]">
                <span className="text-white">Control</span>
                <br />
                <span className="bg-gradient-to-r from-primary via-primary to-secondary bg-clip-text text-transparent relative">
                  Dashboard
                  <span className="absolute -inset-1 blur-2xl bg-primary/20 rounded-full -z-10"></span>
                </span>
              </h1>
              <p className="text-[#B8A6A1] text-lg lg:text-xl max-w-md mx-auto lg:mx-0 leading-relaxed font-light">
                Enterprise-grade admin interface for managing your entire
                platform with precision and speed.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 max-w-lg mx-auto lg:mx-0">
              {[
                { icon: BarChart3, label: "Analytics", desc: "Real-time metrics" },
                { icon: Users, label: "Users", desc: "Role management" },
                { icon: Settings, label: "Settings", desc: "System config" },
                { icon: Activity, label: "Activity", desc: "Audit logs" },
              ].map((item, idx) => (
                <div
                  key={idx}
                  className="group flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5 border border-white/5 backdrop-blur-sm hover:bg-white/10 hover:border-primary/20 transition-all duration-300 cursor-default">
                  <div className="p-1.5 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
                    <item.icon size={18} className="text-primary" />
                  </div>
                  <div className="text-left">
                    <span className="text-sm font-medium text-white/90 block">
                      {item.label}
                    </span>
                    <span className="text-xs text-[#8D7B77]">{item.desc}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-6 text-sm text-[#8D7B77] justify-center lg:justify-start pt-2">
              <span className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                </span>
                System online
              </span>
              <span className="flex items-center gap-2">
                <Lock size={14} />
                256-bit encryption
              </span>
              <span className="flex items-center gap-2">
                <Sparkles size={14} className="text-primary" />
                Enterprise grade
              </span>
            </div>
          </div>

          <div className="order-1 lg:order-2 w-full max-w-md mx-auto lg:mx-0 justify-self-center lg:justify-self-end">
            <div className="bg-surface/80 backdrop-blur-xl rounded-3xl p-8 shadow-[0_20px_60px_-12px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.05)] border border-white/5 hover:border-white/10 transition-all duration-500">
              <div className="flex flex-col items-center">
                <div className="mb-5 relative">
                  <div className="absolute -inset-4 bg-primary/10 blur-2xl rounded-full"></div>
                  <img
                    src="/logo.png"
                    alt="Brand Logo"
                    className="h-[90px] w-[90px] object-contain relative z-10"
                  />
                </div>

                <div className="mb-7 text-center">
                  <div className="text-[28px] sm:text-[32px] leading-[1.2] font-light tracking-[0.04em]">
                    <span className="bg-gradient-to-r from-white to-white/80 bg-clip-text text-transparent">
                      Admin
                    </span>
                    <span className="text-primary ml-2 font-medium">Login</span>
                  </div>
                  <p className="text-[#8D7B77] text-sm mt-1">
                    Sign in to access your dashboard
                  </p>
                </div>

                <form onSubmit={onSubmit} className="w-full space-y-5">
                  <div>
                    <label className="block text-[11px] uppercase tracking-[0.12em] text-[#B8A6A1] font-semibold mb-1.5">
                      Email Address
                    </label>
                    <input
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="admin@example.com"
                      type="email"
                      className="w-full h-[52px] rounded-xl bg-background/60 border border-white/10 px-4 text-[15px] text-white placeholder:text-[#8D7B77] outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 focus:bg-background/80 transition-all duration-200"
                      autoComplete="email"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-[11px] uppercase tracking-[0.12em] text-[#B8A6A1] font-semibold">
                        Password
                      </label>
                      <button
                        type="button"
                        className="text-[11px] text-[#8D7B77] hover:text-primary transition-colors">
                        Forgot?
                      </button>
                    </div>
                    <div className="relative">
                      <input
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••"
                        type={showPassword ? "text" : "password"}
                        className="w-full h-[52px] rounded-xl bg-background/60 border border-white/10 pl-4 pr-12 text-[15px] text-white placeholder:text-[#8D7B77] outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 focus:bg-background/80 transition-all duration-200"
                        autoComplete="current-password"
                      />
                      <button
                        type="button"
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        onClick={() => setShowPassword((v) => !v)}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-[#8D7B77] hover:text-primary transition-colors">
                        <EyeIcon open={showPassword} />
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full h-[54px] rounded-xl text-[16px] font-semibold text-white bg-gradient-to-r from-primary to-secondary shadow-[0_8px_24px_-6px_rgba(232,93,44,0.4)] hover:shadow-[0_12px_32px_-8px_rgba(232,93,44,0.6)] hover:scale-[1.02] active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-300 relative overflow-hidden group">
                    <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000"></span>
                    {loading ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg
                          className="animate-spin h-5 w-5 text-white"
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24">
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          />
                        </svg>
                        Logging in...
                      </span>
                    ) : (
                      "Access Dashboard"
                    )}
                  </button>

                  <div className="h-5 text-center text-[13px] font-medium text-primary">
                    {error ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>
                        {error}
                      </span>
                    ) : (
                      ""
                    )}
                  </div>

                  <div className="pt-2 text-center">
                    <span className="text-[10px] uppercase tracking-[0.15em] text-[#8D7B77]">
                      Authorized access only
                    </span>
                    <span className="mx-2 text-[#8D7B77]/30">•</span>
                    <span className="text-[10px] uppercase tracking-[0.15em] text-[#8D7B77]">
                      Protected by SSL
                    </span>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
