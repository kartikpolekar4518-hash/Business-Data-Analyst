import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { Shell } from "./components/Shell";
import { Spinner } from "./components/ui";
import { Login, Signup, ForgotPassword, ResetPassword } from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import DataList from "./pages/DataList";
import DatasetDetail from "./pages/DatasetDetail";
import Analytics from "./pages/Analytics";
import AiChat from "./pages/AiChat";
import Forecasts from "./pages/Forecasts";
import Reports from "./pages/Reports";
import Alerts from "./pages/Alerts";
import SettingsPage from "./pages/Settings";
import Profile from "./pages/Profile";

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="grid h-full place-items-center"><Spinner label="Loading DecisionIQ…" /></div>;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return <Shell>{children}</Shell>;
}

function PublicOnly({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="grid h-full place-items-center"><Spinner /></div>;
  if (user) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
      <Route path="/signup" element={<PublicOnly><Signup /></PublicOnly>} />
      <Route path="/forgot-password" element={<PublicOnly><ForgotPassword /></PublicOnly>} />
      <Route path="/reset-password" element={<PublicOnly><ResetPassword /></PublicOnly>} />

      <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
      <Route path="/data" element={<Protected><DataList /></Protected>} />
      <Route path="/data/:datasetId" element={<Protected><DatasetDetail /></Protected>} />
      <Route path="/analytics" element={<Protected><Analytics /></Protected>} />
      <Route path="/ai-chat" element={<Protected><AiChat /></Protected>} />
      <Route path="/forecasts" element={<Protected><Forecasts /></Protected>} />
      <Route path="/reports" element={<Protected><Reports /></Protected>} />
      <Route path="/alerts" element={<Protected><Alerts /></Protected>} />
      <Route path="/settings" element={<Protected><SettingsPage /></Protected>} />
      <Route path="/settings/:tab" element={<Protected><SettingsPage /></Protected>} />
      <Route path="/profile" element={<Protected><Profile /></Protected>} />

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
