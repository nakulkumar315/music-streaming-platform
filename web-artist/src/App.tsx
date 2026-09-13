import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import ArtistShell from "./components/ArtistShell";
import Skeleton from "./components/Skeleton";

const ArtistLandingPage = lazy(() => import("./pages/ArtistLandingPage"));
const ArtistLoginPage = lazy(() => import("./pages/ArtistLoginPage"));
const ArtistDashboardPage = lazy(() => import("./pages/ArtistDashboardPage"));
const PendingApprovalPage = lazy(() => import("./pages/PendingApprovalPage"));
const ArtistSignupPage = lazy(() => import("./pages/ArtistSignupPage"));
const ArtistUnderReviewPage = lazy(() => import("./pages/ArtistUnderReviewPage"));
const ArtistRejectedPage = lazy(() => import("./pages/ArtistRejectedPage"));
const ArtistAccountInactivePage = lazy(() => import("./pages/ArtistAccountInactivePage"));
const ArtistAccountPage = lazy(() => import("./pages/ArtistAccountPage"));
const ArtistPricingPage = lazy(() => import("./pages/ArtistPricingPage"));
const ArtistAnalyticsSummaryPage = lazy(() => import("./pages/ArtistAnalyticsSummaryPage"));
const ArtistContentHistoryPage = lazy(() => import("./pages/ArtistContentHistoryPage"));

const PageFallback = () => (
  <div className="p-8 grow">
    <Skeleton className="h-8 w-64 mb-4" />
    <Skeleton className="h-64 w-full" />
  </div>
);

export default function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/" element={<Navigate to="/artist/landing" replace />} />
        <Route path="/artist/landing" element={<ArtistLandingPage />} />
        <Route path="/artist/login" element={<ArtistLoginPage />} />
        <Route path="/artist/signup" element={<ArtistSignupPage />} />
        <Route path="/artist/account-inactive" element={<ArtistAccountInactivePage />} />
        <Route path="/artist/under-review" element={<ArtistUnderReviewPage />} />
        <Route path="/artist/rejected" element={<ArtistRejectedPage />} />
        <Route path="/artist/pending-approval" element={<PendingApprovalPage />} />
        <Route element={<ArtistShell />}>
          <Route path="/artist/dashboard" element={<ArtistDashboardPage />} />
          <Route path="/artist/account" element={<ArtistAccountPage />} />
          <Route path="/artist/pricing" element={<ArtistPricingPage />} />
          <Route path="/artist/analytics-summary" element={<ArtistAnalyticsSummaryPage />} />
          <Route path="/artist/content-history" element={<ArtistContentHistoryPage />} />
          <Route path="/artist/content-upload" element={<Navigate to="/artist/content-history" replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/artist/login" replace />} />
      </Routes>
    </Suspense>
  );
}
