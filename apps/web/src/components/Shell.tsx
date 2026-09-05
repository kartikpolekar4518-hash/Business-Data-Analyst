import { type ReactNode, useState, useRef, useEffect, useCallback, useMemo } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  LayoutGrid,
  Database,
  BarChart3,
  PieChart,
  MessagesSquare,
  TrendingUp,
  FileText,
  Bell,
  History,
  Settings,
  Menu,
  Sun,
  Moon,
  LogOut,
  BrainCircuit,
  ChevronRight,
  User,
  Shield,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Upload,
  Keyboard,
  SunMoon,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useAuth } from "../lib/auth";
import { useTheme } from "../lib/theme";
import { cn } from "../lib/utils";
import { DUR, EASE, SPRING } from "../lib/motion";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { CommandPalette, type Command, Modal } from "./ui";
import type { DatasetSummary } from "../lib/types";

const IS_MAC =
  typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform);
const MOD_KEY = IS_MAC ? "⌘" : "Ctrl";

/* ─────────────────────────────────────────────
   Navigation configuration — grouped sections
   ───────────────────────────────────────────── */
const NAV_SECTIONS = [
  {
    label: "Main",
    items: [
      { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { to: "/builder", label: "Builder", icon: LayoutGrid },
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
      { to: "/charts", label: "Chart library", icon: PieChart },
      { to: "/reports", label: "Reports", icon: FileText },
      { to: "/alerts", label: "Alerts", icon: Bell },
    ],
  },
  {
    label: "Settings",
    items: [
      { to: "/activity", label: "Activity", icon: History },
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
    <span className="relative ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-white/20 px-1.5 text-[11px] font-semibold leading-none text-white backdrop-blur-sm">
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
   Viewport hook — the sidebar animates width on desktop but slides on mobile,
   so the breakpoint has to be readable from JS, not just from `lg:` classes.
   ───────────────────────────────────────────── */
const DESKTOP_QUERY = "(min-width: 1024px)";
const SIDEBAR_WIDTH = 240;

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(
    () => window.matchMedia(DESKTOP_QUERY).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => setIsDesktop(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return isDesktop;
}

/* ─────────────────────────────────────────────
   Sidebar — dark, refined, grouped navigation
   ───────────────────────────────────────────── */
function Sidebar({
  open,
  collapsed,
  onClose,
}: {
  open: boolean;
  collapsed: boolean;
  onClose: () => void;
}) {
  const { user, can } = useAuth();
  const isDesktop = useIsDesktop();

  return (
    <>
      {/* Mobile overlay */}
      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DUR.fast, ease: EASE }}
          />
        )}
      </AnimatePresence>

      <motion.aside
        initial={false}
        animate={
          isDesktop
            ? { x: 0, width: collapsed ? 0 : SIDEBAR_WIDTH }
            : { x: open ? 0 : -SIDEBAR_WIDTH, width: SIDEBAR_WIDTH }
        }
        transition={{ duration: DUR.base, ease: EASE }}
        className="fixed inset-y-0 left-0 z-50 flex shrink-0 flex-col overflow-hidden text-slate-100 lg:static lg:z-auto"
      >
        {/* Inner track holds its full width so a collapse slides rather than reflows */}
        <div className="flex h-full w-[240px] flex-col border-r border-white/[0.06] bg-[#0a0f1a]/95 backdrop-blur-xl">
        {/* Brand */}
        <div className="flex h-14 items-center gap-3 border-b border-white/[0.06] px-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 shadow-lg shadow-brand-500/40">
            <BrainCircuit className="h-[18px] w-[18px] text-white" />
          </div>
          <span className="text-[16px] font-bold tracking-tight text-white">
            {import.meta.env.VITE_APP_NAME || "NoPS"}
          </span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-5">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label}>
              <div className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400">
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
                      className={({ isActive }: { isActive: boolean }) =>
                        cn(
                          "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[14px] font-medium transition-colors duration-150",
                          isActive
                            ? "text-white"
                            : "text-slate-400 hover:bg-white/5 hover:text-slate-200",
                        )
                      }
                    >
                      {({ isActive }: { isActive: boolean }) => (
                        <>
                          {/* Shared layoutId — the pill and glow bar travel
                              between routes instead of popping. */}
                          {isActive && (
                            <>
                              <motion.span
                                layoutId="nav-active-pill"
                                className="absolute inset-0 rounded-lg bg-brand-500/[0.12]"
                                transition={SPRING}
                              />
                              <motion.span
                                layoutId="nav-active"
                                // margin, not -translate-y-1/2: framer owns transform here
                                className="absolute left-0 top-1/2 -mt-2.5 h-5 w-[3px] rounded-r-full bg-brand-400 shadow-[0_0_10px_1px] shadow-brand-400/70"
                                transition={SPRING}
                              />
                            </>
                          )}
                          <n.icon className="relative h-[18px] w-[18px] shrink-0" />
                          <span className="relative truncate">{n.label}</span>
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
              <div className="truncate text-xs text-slate-400">
                {user?.email ?? ""}
              </div>
            </div>
          </div>
        </div>
        </div>
      </motion.aside>
    </>
  );
}

/* ─────────────────────────────────────────────
   Header — glass-effect bar with breadcrumb, search, actions
   ───────────────────────────────────────────── */
function Header({
  onMenuClick,
  collapsed,
  onToggleCollapse,
  onOpenPalette,
}: {
  onMenuClick: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpenPalette: () => void;
}) {
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

      {/* Desktop sidebar toggle */}
      <button
        onClick={onToggleCollapse}
        className="hidden h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 lg:flex"
        aria-label={collapsed ? "Show navigation" : "Hide navigation"}
      >
        {collapsed ? (
          <PanelLeftOpen className="h-[17px] w-[17px]" />
        ) : (
          <PanelLeftClose className="h-[17px] w-[17px]" />
        )}
      </button>

      {/* Breadcrumb */}
      <nav className="hidden items-center gap-1.5 text-sm md:flex" aria-label="Breadcrumb">
        {section && (
          <>
            <span className="text-slate-500 dark:text-slate-400">
              {section.label}
            </span>
            <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
          </>
        )}
        <span className="font-medium text-slate-800 dark:text-slate-100">
          {current?.label ?? "Dashboard"}
        </span>
      </nav>

      <div className="flex-1" />

      {/* Command palette trigger */}
      <button
        onClick={onOpenPalette}
        aria-label="Open command palette"
        className="hidden items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-sm text-slate-500 transition-colors hover:bg-slate-100 dark:border-white/10 dark:text-slate-400 dark:hover:bg-slate-800 sm:flex"
      >
        <Search className="h-4 w-4" />
        <span className="hidden md:inline">Search…</span>
        <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-slate-400 dark:border-white/10">
          {MOD_KEY} K
        </kbd>
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

        <AnimatePresence>
        {menu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenu(false)} aria-hidden="true" />
            <motion.div
              role="menu"
              className="absolute right-0 top-full z-50 mt-2 w-56 origin-top-right rounded-xl border border-border bg-white p-1.5 shadow-dropdown dark:border-slate-700 dark:bg-slate-800"
              onMouseLeave={() => setMenu(false)}
              initial={{ opacity: 0, scale: 0.95, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -4 }}
              transition={{ duration: DUR.fast, ease: EASE }}
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
                <NavLink
                  to="/settings"
                  role="menuitem"
                  className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
                  onClick={() => setMenu(false)}
                >
                  <Settings className="h-4 w-4 text-slate-400" />
                  Settings
                </NavLink>
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
            </motion.div>
          </>
        )}
        </AnimatePresence>
      </div>
    </header>
  );
}

/* ─────────────────────────────────────────────
   Shell — application layout wrapper
   ───────────────────────────────────────────── */
/* ─────────────────────────────────────────────
   Keyboard shortcuts help — quick reference (?)
   ───────────────────────────────────────────── */
const SHORTCUTS: { keys: string; label: string }[] = [
  { keys: `${MOD_KEY} K`, label: "Open command palette" },
  { keys: "/", label: "Search pages, datasets and actions" },
  { keys: "?", label: "Show this shortcuts reference" },
  { keys: "↑ ↓", label: "Move between results" },
  { keys: "Enter", label: "Run the highlighted command" },
  { keys: "Esc", label: "Close palette or dialog" },
];

function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts">
      <ul className="space-y-2">
        {SHORTCUTS.map((s) => (
          <li key={s.label} className="flex items-center justify-between gap-4 text-sm">
            <span className="text-slate-600 dark:text-slate-300">{s.label}</span>
            <kbd className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[11px] font-medium text-slate-500 dark:border-white/10 dark:text-slate-400">
              {s.keys}
            </kbd>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("diq_sidebar_collapsed") === "1",
  );
  useEffect(() => {
    localStorage.setItem("diq_sidebar_collapsed", collapsed ? "1" : "0");
  }, [collapsed]);

  const navigate = useNavigate();
  const { can, logout } = useAuth();
  const { toggle } = useTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  // Datasets feed the palette's search — only fetched once it's first opened.
  const { data: dsData } = useQuery({
    queryKey: ["datasets"],
    queryFn: () => api.get<{ datasets: DatasetSummary[] }>("/uploads"),
    enabled: paletteOpen,
    staleTime: 60_000,
  });

  // Global keyboard entry points. Cmd/Ctrl+K works while typing; single-key
  // shortcuts only fire when focus is outside a form field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      const typing =
        el instanceof HTMLElement &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.isContentEditable);
      if (typing) return;
      if (e.key === "/") {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (e.key === "?") {
        e.preventDefault();
        setHelpOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const commands = useMemo<Command[]>(() => {
    const nav = NAV_SECTIONS.flatMap((s) => s.items)
      .filter((n) => !n.roles || can(...n.roles))
      .map((n) => ({
        id: n.to,
        label: n.label,
        section: "Navigate",
        icon: n.icon,
        hint: n.to,
        run: () => navigate(n.to),
      }));

    const actions: Command[] = [
      { id: "act-upload", label: "Upload dataset", section: "Actions", icon: Upload, keywords: "new csv excel import add data", run: () => navigate("/data") },
      { id: "act-theme", label: "Toggle light / dark theme", section: "Actions", icon: SunMoon, keywords: "dark mode appearance", run: toggle },
      { id: "act-help", label: "Keyboard shortcuts", section: "Actions", icon: Keyboard, keywords: "help hotkeys reference", run: () => setHelpOpen(true) },
      { id: "act-logout", label: "Log out", section: "Actions", icon: LogOut, keywords: "sign out exit", run: logout },
    ];

    const datasets: Command[] = (dsData?.datasets ?? []).map((d) => ({
      id: `ds-${d.id}`,
      label: d.name,
      section: "Datasets",
      icon: Database,
      hint: `${d.rowCount.toLocaleString()} rows`,
      keywords: d.fileName ?? "",
      run: () => navigate(`/data/${d.id}`),
    }));

    return [...nav, ...actions, ...datasets];
  }, [can, navigate, toggle, dsData]);

  return (
    <div className="flex h-full bg-surface-tertiary dark:bg-transparent">
      <Sidebar
        open={sidebarOpen}
        collapsed={collapsed}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          onMenuClick={() => setSidebarOpen(true)}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((c) => !c)}
          onOpenPalette={() => setPaletteOpen(true)}
        />
        <main className="flex-1 overflow-y-auto p-6 lg:p-8">
          {children}
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={commands}
      />
      <ShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}