import { Suspense, lazy, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import AdminLayout from "./components/AdminLayout";
import AdminSessionGate from "./components/AdminSessionGate";
import Skeleton from "./components/Skeleton";
import { getPrivilegedRole, type PrivilegedRole } from "./services/adminSession";

const AdminLoginPage = lazy(() => import("./pages/AdminLoginPage"));
const AdminHomePage = lazy(() => import("./pages/AdminHomePage"));
const AdminAnalyticsPage = lazy(() => import("./pages/AdminAnalyticsPage"));
const AdminArtistsPage = lazy(() => import("./pages/AdminArtistsPage"));
const AdminArtistDetailPage = lazy(() => import("./pages/AdminArtistDetailPage"));
const AdminContentApprovalQueuePage = lazy(() => import("./pages/AdminContentApprovalQueuePage"));
const AdminMediaUploadPage = lazy(() => import("./pages/AdminMediaUploadPage"));
const AdminArtistApplicationsPage = lazy(() => import("./pages/AdminArtistApplicationsPage"));
const AdminFeaturedArtistsPage = lazy(() => import("./pages/AdminFeaturedArtistsPage"));
const AdminSubscriptionSettingsPage = lazy(() => import("./pages/AdminSubscriptionSettingsPage"));
const AdminRefundsPage = lazy(() => import("./pages/AdminRefundsPage"));
const AdminAuditPage = lazy(() => import("./pages/AdminAuditPage"));
const AdminAgreementSettingsPage = lazy(() => import("./pages/AdminAgreementSettingsPage"));
const AdminCommissionPlansPage = lazy(() => import("./pages/AdminCommissionPlansPage"));
const AdminTermsManagementPage = lazy(() => import("./pages/AdminTermsManagementPage"));
const AdminSignedAgreementsPage = lazy(() => import("./pages/AdminSignedAgreementsPage"));

const PageFallback = () => (
  <div className="p-8">
    <Skeleton className="h-8 w-64 mb-4" />
    <Skeleton className="h-64 w-full" />
  </div>
);

function homeForRole(role: PrivilegedRole | null) {
  if (role === "FINANCE") return "/admin/refunds";
  if (role === "MODERATOR") return "/admin/moderation";
  return "/admin/home";
}

function RequirePortalRole({
  allowed,
  children,
}: {
  allowed: PrivilegedRole[];
  children: ReactNode;
}) {
  const role = getPrivilegedRole();
  if (!role) return <Navigate to="/admin/login" replace />;
  if (!allowed.includes(role)) return <Navigate to={homeForRole(role)} replace />;
  return <>{children}</>;
}

function PrivilegedHome() {
  const role = getPrivilegedRole();
  if (role === "FINANCE" || role === "MODERATOR") {
    return <Navigate to={homeForRole(role)} replace />;
  }
  return <AdminHomePage />;
}

const adminOnly = (node: ReactNode) => (
  <RequirePortalRole allowed={["ADMIN"]}>{node}</RequirePortalRole>
);

export default function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/" element={<Navigate to="/admin/login" replace />} />
        <Route path="/admin/login" element={<AdminLoginPage />} />

        <Route element={<AdminSessionGate />}>
          <Route element={<AdminLayout />}>
            <Route path="/admin/home" element={<PrivilegedHome />} />
            <Route
              path="/admin/refunds"
              element={
                <RequirePortalRole allowed={["ADMIN", "FINANCE"]}>
                  <AdminRefundsPage />
                </RequirePortalRole>
              }
            />
            <Route path="/admin/analytics" element={adminOnly(<AdminAnalyticsPage />)} />
            <Route path="/admin/artists" element={adminOnly(<AdminArtistsPage />)} />
            <Route path="/admin/artist-applications" element={adminOnly(<AdminArtistApplicationsPage />)} />
            <Route path="/admin/artists/:id" element={adminOnly(<AdminArtistDetailPage />)} />
            <Route path="/admin/media-upload" element={adminOnly(<AdminMediaUploadPage />)} />
            <Route
              path="/admin/moderation"
              element={
                <RequirePortalRole allowed={["ADMIN", "MODERATOR"]}>
                  <AdminContentApprovalQueuePage />
                </RequirePortalRole>
              }
            />
            <Route path="/admin/featured-artists" element={adminOnly(<AdminFeaturedArtistsPage />)} />
            <Route path="/admin/agreement-settings" element={adminOnly(<AdminAgreementSettingsPage />)}>
              <Route path="commission-plans" element={<AdminCommissionPlansPage />} />
              <Route path="terms" element={<AdminTermsManagementPage />} />
              <Route path="signed-agreements" element={<AdminSignedAgreementsPage />} />
            </Route>
            <Route path="/admin/subscription-settings" element={adminOnly(<AdminSubscriptionSettingsPage />)} />
            <Route path="/admin/audit" element={adminOnly(<AdminAuditPage />)} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/admin/login" replace />} />
      </Routes>
    </Suspense>
  );
}
