import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { http, toApiFailure } from "../services/http";
import {
  clearAdminSession,
  getAdminToken,
  setPrivilegedRole,
} from "../services/adminSession";

type SessionState = "checking" | "ready" | "denied" | "unavailable";

export default function AdminSessionGate() {
  const [state, setState] = useState<SessionState>("checking");

  useEffect(() => {
    let active = true;
    if (!getAdminToken()) {
      setState("denied");
      return () => {
        active = false;
      };
    }

    void http
      .get("/api/v1/admin/session")
      .then((response) => {
        if (!active) return;
        const role = setPrivilegedRole(response.data?.user?.role);
        if (!role) {
          clearAdminSession();
          setState("denied");
          return;
        }
        setState("ready");
      })
      .catch((error) => {
        if (!active) return;
        const failure = toApiFailure(error);
        if (failure.status === 401 || failure.status === 403) {
          clearAdminSession();
          setState("denied");
          return;
        }
        setState("unavailable");
      });

    return () => {
      active = false;
    };
  }, []);

  if (state === "denied") return <Navigate to="/admin/login" replace />;
  if (state === "unavailable") {
    return (
      <div className="min-h-screen bg-background text-white flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold">Unable to verify your admin session</h1>
          <p className="mt-2 text-sm text-white/60">Check the server connection and try again.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }
  if (state !== "ready") {
    return <div className="min-h-screen bg-background" aria-label="Verifying admin session" />;
  }
  return <Outlet />;
}
