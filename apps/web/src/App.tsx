import { lazy, Suspense } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { DUR, EASE } from "./lib/motion";
import { useAuth } from "./lib/auth";
import { Shell } from "./components/Shell";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Spinner } from "./components/ui";
import { Login, Signup, ForgotPassword, ResetPassword } from "./pages/Auth";

const Landing = lazy(() => import("./pages/Landing"));

// Route-level code splitting: chart-heavy pages (and recharts itself) load on
// demand instead of shipping in the login bundle.
const Dashboard = lazy(() => import("./pages/Dashboard"));
const DataList = lazy(() => import("./pages/DataList"));
const DatasetDetail = lazy(() => import("./pages/DatasetDetail"));
const Analytics = lazy(() => import("./pages/Analytics"));
const ChartLibrary = lazy(() => import("./pages/ChartLibrary"));
const AiChat = lazy(() => import("./pages/AiChat"));
const Forecasts = lazy(() => import("./pages/Forecasts"));
const Reports = lazy(() => import("./pages/Reports"));
const Alerts = lazy(() => import("./pages/Alerts"));
const SettingsPage = lazy(() => import("./pages/Settings"));
const Profile = lazy(() => import("./pages/Profile"));

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="grid h-full place-items-center"><Spinner label="Loading DecisionIQ…" /></div>;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return <Shell><Suspense fallback={<Spinner />}>{children}</Suspense></Shell>;
}

function PublicOnly({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="grid h-full place-items-center"><Spinner /></div>;
  if (user) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

// Marketing landing at "/" — sent straight to the app once signed in.
function LandingRoute() {
  const { user, loading } = useAuth();
  if (loading) return <div className="grid h-full place-items-center"><Spinner /></div>;
  if (user) return <Navigate to="/dashboard" replace />;
  return <Suspense fallback={<Spinner />}><Landing /></Suspense>;
}

export default function App() {
  const location = useLocation();
  // Transition per top-level section, not per pathname: /settings/:tab and
  // /data/:datasetId are the same page reparameterised, and remounting them
  // would fade the page on every tab click and kill the Tabs layoutId glide.
  const sectionKey = location.pathname.split("/")[1] || "root";
  return (
    <ErrorBoundary>
      {/* No `initial={false}` here — on AnimatePresence it propagates down and
          suppresses the mount animation of every descendant motion component. */}
      <AnimatePresence mode="wait">
        <motion.div
          key={sectionKey}
          className="h-full"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0, transition: { duration: DUR.base, ease: EASE } }}
          exit={{ opacity: 0, y: -6, transition: { duration: DUR.fast, ease: EASE } }}
        >
          <Routes location={location}>
            <Route path="/" element={<LandingRoute />} />
            <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
            <Route path="/signup" element={<PublicOnly><Signup /></PublicOnly>} />
            <Route path="/forgot-password" element={<PublicOnly><ForgotPassword /></PublicOnly>} />
            <Route path="/reset-password" element={<PublicOnly><ResetPassword /></PublicOnly>} />

            <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
            <Route path="/data" element={<Protected><DataList /></Protected>} />
            <Route path="/data/:datasetId" element={<Protected><DatasetDetail /></Protected>} />
            <Route path="/analytics" element={<Protected><Analytics /></Protected>} />
            <Route path="/charts" element={<Protected><ChartLibrary /></Protected>} />
            <Route path="/ai-chat" element={<Protected><AiChat /></Protected>} />
            <Route path="/forecasts" element={<Protected><Forecasts /></Protected>} />
            <Route path="/reports" element={<Protected><Reports /></Protected>} />
            <Route path="/alerts" element={<Protected><Alerts /></Protected>} />
            <Route path="/settings" element={<Protected><SettingsPage /></Protected>} />
            <Route path="/settings/:tab" element={<Protected><SettingsPage /></Protected>} />
            <Route path="/profile" element={<Protected><Profile /></Protected>} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </motion.div>
      </AnimatePresence>
    </ErrorBoundary>
  );
}
