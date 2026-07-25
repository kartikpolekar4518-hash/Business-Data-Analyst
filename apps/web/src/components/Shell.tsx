import { type ReactNode, useState, useRef, useEffect, useCallback } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Database,
  BarChart3,
  MessagesSquare,
  TrendingUp,
  FileText,
  Bell,
  Settings,
  Menu,
  Sun,
  Moon,
  LogOut,
  BrainCircuit,
  Search,
  ChevronRight,
  User,
  Shield,
  HelpCircle,
  Keyboard,
  ChevronDown,
  Calendar,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { useTheme } from "../lib/theme";
import { cn } from "../lib/utils";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

/* ─────────────────────────────────────────────
   Navigation configuration — grouped sections
   ───────────────────────────────────────────── */
const NAV_SECTIONS = [
  {
    label: "Main",
    items: [
      { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { to: "/data", label: "Data", icon: Database },
      { to: "/analytics", label: "Analytics", icon: BarChart3 },
      {
        to: "/ai-chat",
        label: "Chat with Data",
        icon: MessagesSquare,
        roles: ["ADMIN", "MANAGER"] as const,
      },
    ],
  },
  {
    label: "Analytics",
    items: [
      { to: "/forecasts", label: "Forecasts", icon: TrendingUp },
      { to: "/reports", label: "Reports", icon: FileText },
      { to: "/alerts", label: "Alerts", icon: Bell },
    ],
  },
  {
    label: "Settings",
    items: [
      { to: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

/* ─────────────────────────────────────────────
   Shared hook — unread alert count (fetched once)
   ───────────────────────────────────────────── */
function useUnreadAlerts() {
  return useQuery({
    queryKey: ["alerts", "unread"],
    queryFn: () => api.get<{ unread: number }>("/alerts"),
    refetchInterval: 60000,
  });
}

/* ─────────────────────────────────────────────
   Alert badge — unread count pill
   ───────────────────────────────────────────── */
function AlertBadge() {
  const { data: alerts } = useUnreadAlerts();

  if (!alerts?.unread) return null;

  return (
    <span className="ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-white/20 px-1.5 text-[11px] font-semibold leading-none text-white backdrop-blur-sm">
      {alerts.unread > 99 ? "99+" : alerts.unread}
    </span>
  );
}

/* ─────────────────────────────────────────────
   Focus trap hook
   ───────────────────────────────────────────── */
function useFocusTrap(active: boolean, containerRef: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!active || !containerRef.current) return;

    const container = containerRef.current;
    const focusable = container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    // Focus the first element when activated
    first?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };

    container.addEventListener("keydown", onKeyDown);
    return () => container.removeEventListener("keydown", onKeyDown);
  }, [active, containerRef]);
}

/* ─────────────────────────────────────────────
   Sidebar — dark, refined, grouped navigation
   ───────────────────────────────────────────── */
function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, can } = useAuth();

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[240px] shrink-0 flex-col",
          "border-r border-white/[0.06] bg-[#0a0f1a]/95 text-slate-100 backdrop-blur-xl",
          "transition-all duration-300 ease-out",
          open ? "translate-x-0" : "-translate-x-full",
          "lg:static lg:translate-x-0 lg:z-auto",
        )}
      >
        {/* Brand */}
        <div className="flex h-14 items-center gap-3 border-b border-white/[0.06] px-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 shadow-lg shadow-brand-500/40">
            <BrainCircuit className="h-[18px] w-[18px] text-white" />
          </div>
          <span className="text-[16px] font-bold tracking-tight text-white">
            {import.meta.env.VITE_APP_NAME || "DecisionIQ"}
          </span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-5">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label}>
              <div className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">
                {section.label}
              </div>
              <div className="space-y-0.5">
                {section.items
                  .filter((n) => !n.roles || can(...n.roles))
                  .map((n) => (
                    <NavLink
                      key={n.to}
                      to={n.to}
                      onClick={onClose}
                      className={({ isActive }) =>
                        cn(
                          "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[14px] font-medium transition-all duration-150",
                          isActive
                            ? "bg-brand-500/[0.12] text-white"
                            : "text-slate-400 hover:bg-white/5 hover:text-slate-200",
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {isActive && (
                            <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-brand-400 shadow-[0_0_10px_1px] shadow-brand-400/70" />
                          )}
                          <n.icon className="h-[18px] w-[18px] shrink-0" />
                          <span className="truncate">{n.label}</span>
                          {n.to === "/alerts" && <AlertBadge />}
                        </>
                      )}
                    </NavLink>
                  ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Bottom — user summary */}
        <div className="border-t border-white/5 px-3 py-3">
          <div className="flex items-center gap-3 rounded-lg px-3 py-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 text-xs font-semibold text-white shadow-sm shadow-brand-500/30">
              {user?.name?.[0] ?? "U"}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-slate-200">
                {user?.name ?? "User"}
              </div>
              <div className="truncate text-xs text-slate-500">
                {user?.email ?? ""}
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

/* ─────────────────────────────────────────────
   Header — glass-effect bar with breadcrumb, search, actions
   ───────────────────────────────────────────── */
function Header({ onMenuClick }: { onMenuClick: () => void }) {
  const location = useLocation();
  const { theme, toggle } = useTheme();
  const { user, role, logout } = useAuth();
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const { data: alerts } = useUnreadAlerts();

  useFocusTrap(menu, menuRef);

  // Close menu on Escape
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenu(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  // Restore focus when menu closes
  const triggerRef = useRef<HTMLButtonElement>(null);
  const handleMenuToggle = useCallback(() => {
    setMenu((m) => !m);
  }, []);

  useEffect(() => {
    if (!menu && triggerRef.current) {
      triggerRef.current.focus();
    }
  }, [menu]);

  // Breadcrumb resolution
  const flatItems = NAV_SECTIONS.flatMap((s) => s.items);
  const current = flatItems.find((n) => location.pathname.startsWith(n.to));
  const section = NAV_SECTIONS.find((s) =>
    s.items.some((n) => n.to === current?.to),
  );

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b border-border bg-white/80 px-4 backdrop-blur-xl dark:border-white/[0.06] dark:bg-[#080c15]/80 lg:px-6">
      {/* Mobile hamburger */}
      <button
        className="lg:hidden"
        onClick={onMenuClick}
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5 text-slate-500 dark:text-slate-400" />
      </button>

      {/* Breadcrumb */}
      <nav className="hidden items-center gap-1.5 text-sm md:flex" aria-label="Breadcrumb">
        {section && (
          <>
            <span className="text-slate-400 dark:text-slate-500">
              {section.label}
            </span>
            <ChevronRight className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
          </>
        )}
        <span className="font-medium text-slate-800 dark:text-slate-100">
          {current?.label ?? "Dashboard"}
        </span>
      </nav>

      <div className="flex-1" />

      {/* Global search */}
      <button className="group hidden items-center gap-2 rounded-lg border border-border bg-surface-secondary px-3 py-1.5 text-sm text-slate-400 transition-all hover:border-slate-300 hover:text-slate-500 dark:border-white/10 dark:bg-white/5 dark:hover:border-white/20 sm:flex">
        <Search className="h-4 w-4" />
        <span className="text-slate-400">Search</span>
        <kbd className="ml-6 rounded border border-border bg-white px-1.5 py-[1px] text-[11px] font-medium text-slate-400 dark:border-white/10 dark:bg-white/5">
          ⌘K
        </kbd>
      </button>

      {/* Date range chip */}
      <button className="hidden items-center gap-2 rounded-lg border border-border bg-surface-secondary px-3 py-1.5 text-sm font-medium text-slate-600 transition-all hover:border-slate-300 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:border-white/20 md:flex">
        <Calendar className="h-4 w-4 text-slate-400" />
        Last 30 days
        <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
      </button>

      {/* Theme toggle */}
      <button
        onClick={toggle}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      >
        {theme === "dark" ? (
          <Sun className="h-[17px] w-[17px]" />
        ) : (
          <Moon className="h-[17px] w-[17px]" />
        )}
      </button>

      {/* Notifications */}
      <NavLink
        to="/alerts"
        className="relative flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        aria-label={
          alerts?.unread
            ? `Notifications (${alerts.unread} unread)`
            : "Notifications"
        }
      >
        <Bell className="h-[17px] w-[17px]" />
        {alerts?.unread ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white ring-[2px] ring-white dark:ring-slate-950">
            {alerts.unread > 9 ? "9+" : alerts.unread}
          </span>
        ) : null}
      </NavLink>

      {/* User avatar + dropdown */}
      <div className="relative" ref={menuRef}>
        <button
          ref={triggerRef}
          onClick={handleMenuToggle}
          aria-label="Account menu"
          aria-expanded={menu}
          aria-haspopup="true"
          className="flex items-center gap-2 rounded-lg p-0.5 pr-2 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-brand-400 to-brand-600 text-xs font-semibold text-white shadow-sm shadow-brand-500/30">
            {user?.name?.[0] ?? "U"}
          </div>
          <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
        </button>

        {menu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenu(false)} aria-hidden="true" />
            <div
              role="menu"
              className="absolute right-0 top-full mt-2 w-56 animate-fade-in rounded-xl border border-border bg-white p-1.5 shadow-dropdown dark:border-slate-700 dark:bg-slate-800"
              onMouseLeave={() => setMenu(false)}
            >
              <div className="px-3 py-2.5">
                <div className="text-sm font-semibold text-slate-900 dark:text-white">
                  {user?.name}
                </div>
                <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {user?.email}
                </div>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <Shield className="h-3 w-3 text-brand-500" />
                  <span className="text-xs font-medium text-brand-600 dark:text-brand-400">
                    {role}
                  </span>
                </div>
              </div>

              <hr className="mx-2 border-border dark:border-slate-700" />

              <div className="mt-1 space-y-0.5">
                <NavLink
                  to="/profile"
                  role="menuitem"
                  className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
                  onClick={() => setMenu(false)}
                >
                  <User className="h-4 w-4 text-slate-400" />
                  Profile
                </NavLink>
                <button
                  role="menuitem"
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  <Keyboard className="h-4 w-4 text-slate-400" />
                  Keyboard shortcuts
                </button>
                <button
                  role="menuitem"
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  <HelpCircle className="h-4 w-4 text-slate-400" />
                  Help & support
                </button>
              </div>

              <hr className="mx-2 mt-1 border-border dark:border-slate-700" />

              <button
                role="menuitem"
                onClick={logout}
                className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
              >
                <LogOut className="h-4 w-4" />
                Log out
              </button>
            </div>
          </>
        )}
      </div>
    </header>
  );
}

/* ─────────────────────────────────────────────
   Shell — application layout wrapper
   ───────────────────────────────────────────── */
export function Shell({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-full bg-surface-tertiary dark:bg-transparent">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-y-auto p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}