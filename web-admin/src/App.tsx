import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import AdminLayout from "./components/AdminLayout";
import Skeleton from "./components/Skeleton";
import { getPrivilegedRole } from "./services/adminSession";

const AdminLoginPage = lazy(() => import("./pages/AdminLoginPage"));
const AdminHomePage = lazy(() => import("./pages/AdminHomePage"));
const AdminAnalyticsPage = lazy(() => import("./pages/AdminAnalyticsPage"));
const AdminArtistsPage = lazy(() => import("./pages/AdminArtistsPage"));
const AdminArtistDetailPage = lazy(() => import("./pages/AdminArtistDetailPage"));
const AdminContentApprovalQueuePage = lazy(() => import("./pages/AdminContentApprovalQueuePage"));
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

function PrivilegedHome() {
  return getPrivilegedRole() === "FINANCE" ? (
    <Navigate to="/admin/refunds" replace />
  ) : (
    <AdminHomePage />
  );
}

export default function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/" element={<Navigate to="/admin/login" replace />} />
        <Route path="/admin/login" element={<AdminLoginPage />} />

        <Route element={<AdminLayout />}>
          <Route path="/admin/home" element={<PrivilegedHome />} />
          <Route path="/admin/refunds" element={<AdminRefundsPage />} />
          <Route path="/admin/analytics" element={<AdminAnalyticsPage />} />
          <Route path="/admin/artists" element={<AdminArtistsPage />} />
          <Route path="/admin/artist-applications" element={<AdminArtistApplicationsPage />} />
          <Route path="/admin/artists/:id" element={<AdminArtistDetailPage />} />
          <Route path="/admin/moderation" element={<AdminContentApprovalQueuePage />} />
          <Route path="/admin/featured-artists" element={<AdminFeaturedArtistsPage />} />
          <Route path="/admin/agreement-settings" element={<AdminAgreementSettingsPage />}>
            <Route path="commission-plans" element={<AdminCommissionPlansPage />} />
            <Route path="terms" element={<AdminTermsManagementPage />} />
            <Route path="signed-agreements" element={<AdminSignedAgreementsPage />} />
          </Route>
          <Route path="/admin/subscription-settings" element={<AdminSubscriptionSettingsPage />} />
          <Route path="/admin/audit" element={<AdminAuditPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/admin/login" replace />} />
      </Routes>
    </Suspense>
  );
}
