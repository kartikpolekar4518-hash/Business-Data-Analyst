import { type ReactNode, useState, useRef, useEffect, useCallback, useMemo } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Database,
  MessagesSquare,
  SlidersHorizontal,
  Gauge,
  FileText,
  Bell,
  Settings,
  Menu,
  Sun,
  Moon,
  LogOut,
  ClipboardCheck,
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
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useAuth, type Role } from "../lib/auth";
import { useTheme } from "../lib/theme";
import { cn } from "../lib/utils";
import { DUR, EASE, SPRING } from "../lib/motion";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { CommandPalette, type Command, Modal, Tabs } from "./ui";
import type { DatasetSummary } from "../lib/types";

const IS_MAC =
  typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform);
const MOD_KEY = IS_MAC ? "⌘" : "Ctrl";

/* ─────────────────────────────────────────────
   Navigation configuration — five jobs, not fifteen features

   Each entry is something a person is trying to get done. The pages that used to
   be their own sidebar rows are still here, at unchanged URLs, as tabs under the
   job they serve — nothing is deleted and no bookmark breaks.

   `keywords` matters: the command palette matches on label + keywords, so naming
   a destination after a job would otherwise make it unfindable by its old feature
   name. Everything searchable before stays searchable.
   ───────────────────────────────────────────── */
type NavTab = { to: string; label: string; keywords?: string; badge?: "alerts" };
type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  keywords: string;
  roles?: readonly Role[];
  badge?: "alerts";
  tabs?: NavTab[];
};

const NAV: NavItem[] = [
  {
    to: "/dashboard",
    label: "Where we stand",
    icon: Gauge,
    keywords: "dashboard overview home summary kpi headline performance today",
  },
  {
    to: "/ai-chat",
    label: "Ask a question",
    icon: MessagesSquare,
    keywords: "chat ask question natural language ai conversation query",
    roles: ["ADMIN", "MANAGER"] as const,
  },
  {
    to: "/analytics",
    label: "Dig into the numbers",
    icon: SlidersHorizontal,
    keywords: "analytics explore filter slice drill segment driver correlation breakdown",
    tabs: [
      { to: "/analytics", label: "Explore" },
      { to: "/forecasts", label: "Forecasts", keywords: "forecast projection predict what-if scenario goal horizon" },
      { to: "/charts", label: "Chart library", keywords: "chart graph library visual catalog plot map" },
      { to: "/builder", label: "Builder", keywords: "builder widget canvas custom dashboard layout" },
    ],
  },
  {
    to: "/reports",
    label: "Put it on record",
    icon: FileText,
    keywords: "report export pdf share schedule template executive summary",
    badge: "alerts",
    tabs: [
      { to: "/reports", label: "Reports" },
      { to: "/alerts", label: "Alerts", keywords: "alert rule anomaly notification threshold warning", badge: "alerts" },
      { to: "/activity", label: "Activity", keywords: "activity audit trail log history who changed" },
    ],
  },
  {
    to: "/data",
    label: "The data behind it",
    icon: Database,
    keywords: "data upload csv excel dataset file source connect quality schema clean recipe",
  },
];

/** Every destination, longest path first — `startsWith` must not let a short
 *  path shadow a longer one (`/data` swallowing `/data/:id`). */
const DESTINATIONS: { to: string; label: string; group: NavItem }[] = NAV.flatMap((item) =>
  (item.tabs ?? [{ to: item.to, label: item.label }]).map((t) => ({ to: t.to, label: t.label, group: item })),
).sort((a, b) => b.to.length - a.to.length);

const destinationFor = (pathname: string) => DESTINATIONS.find((d) => pathname.startsWith(d.to));

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
function AlertBadge({ className }: { className?: string }) {
  const { data: alerts } = useUnreadAlerts();

  if (!alerts?.unread) return null;

  return (
    <span className={cn("relative flex h-5 min-w-[20px] items-center justify-center rounded-full bg-neg px-1.5 font-mono text-label leading-none text-accent-fg", className)}>
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
  const current = destinationFor(useLocation().pathname);

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
        className="fixed inset-y-0 left-0 z-50 flex shrink-0 flex-col overflow-hidden text-ink lg:static lg:z-auto"
      >
        {/* Inner track holds its full width so a collapse slides rather than reflows */}
        <div className="flex h-full w-[240px] flex-col border-r border-rule bg-surface">
        {/* Brand */}
        <div className="flex h-14 items-center gap-3 border-b border-rule px-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-accent-fg">
            <ClipboardCheck className="h-[18px] w-[18px]" />
          </div>
          <span className="text-heading-3 font-bold tracking-tight text-ink">
            {import.meta.env.VITE_APP_NAME || "NoPS"}
          </span>
        </div>

        {/* Navigation — one flat list of jobs. A job is current whenever any of
            the pages it owns is, so /forecasts lights "Dig into the numbers". */}
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-5">
          {NAV.filter((n) => !n.roles || can(...n.roles)).map((n) => {
            const isActive = current?.group.to === n.to;
            return (
              <NavLink
                key={n.to}
                to={n.to}
                onClick={onClose}
                className={cn(
                  "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-body font-medium transition-colors duration-150",
                  isActive ? "text-ink" : "text-ink-faint hover:bg-sunken hover:text-ink",
                )}
              >
                {/* Shared layoutId — the pill and the marker travel between
                    routes instead of popping. */}
                {isActive && (
                  <>
                    <motion.span
                      layoutId="nav-active-pill"
                      className="absolute inset-0 rounded-lg bg-accent/[0.12]"
                      transition={SPRING}
                    />
                    <motion.span
                      layoutId="nav-active"
                      // margin, not -translate-y-1/2: framer owns transform here
                      className="absolute left-0 top-1/2 -mt-2.5 h-5 w-[3px] rounded-r-sm bg-accent"
                      transition={SPRING}
                    />
                  </>
                )}
                <n.icon className="relative h-[18px] w-[18px] shrink-0" />
                <span className="relative truncate">{n.label}</span>
                {n.badge === "alerts" && <AlertBadge className="ml-auto" />}
              </NavLink>
            );
          })}
        </nav>

        {/* Bottom — user summary */}
        <div className="border-t border-rule px-3 py-3">
          <div className="flex items-center gap-3 rounded-lg px-3 py-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-fg text-body-sm font-semibold text-ink shadow-sm shadow-brand-500/30">
              {user?.name?.[0] ?? "U"}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-body font-medium text-ink">
                {user?.name ?? "User"}
              </div>
              <div className="truncate text-body-sm text-ink-faint">
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

  // Breadcrumb: "<the job> › <the page>". A group with no tabs is one crumb,
  // since repeating its own label as the second crumb says nothing.
  const current = destinationFor(location.pathname);
  const group = current?.group;

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b border-rule bg-surface px-4 lg:px-6">
      {/* Mobile hamburger */}
      <button
        className="lg:hidden"
        onClick={onMenuClick}
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5 text-ink-faint" />
      </button>

      {/* Desktop sidebar toggle */}
      <button
        onClick={onToggleCollapse}
        className="hidden h-8 w-8 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-sunken lg:flex"
        aria-label={collapsed ? "Show navigation" : "Hide navigation"}
      >
        {collapsed ? (
          <PanelLeftOpen className="h-[17px] w-[17px]" />
        ) : (
          <PanelLeftClose className="h-[17px] w-[17px]" />
        )}
      </button>

      {/* Breadcrumb */}
      <nav className="hidden items-center gap-1.5 text-body md:flex" aria-label="Breadcrumb">
        {group && group.tabs && (
          <>
            <span className="text-ink-faint">{group.label}</span>
            <ChevronRight className="h-3.5 w-3.5 text-ink-faint" />
          </>
        )}
        <span className="font-medium text-ink-soft">
          {current?.label ?? "Where we stand"}
        </span>
      </nav>

      <div className="flex-1" />

      {/* Command palette trigger */}
      <button
        onClick={onOpenPalette}
        aria-label="Open command palette"
        className="hidden items-center gap-2 rounded-lg border border-rule px-2.5 py-1.5 text-body text-ink-faint transition-colors hover:bg-sunken sm:flex"
      >
        <Search className="h-4 w-4" />
        <span className="hidden md:inline">Search…</span>
        <kbd className="rounded border border-rule px-1.5 py-0.5 text-[10px] font-medium text-ink-faint">
          {MOD_KEY} K
        </kbd>
      </button>

      {/* Theme toggle */}
      <button
        onClick={toggle}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-sunken"
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
        className="relative flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-sunken"
        aria-label={
          alerts?.unread
            ? `Notifications (${alerts.unread} unread)`
            : "Notifications"
        }
      >
        <Bell className="h-[17px] w-[17px]" />
        {alerts?.unread ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-neg px-1 font-mono text-label leading-none text-ink ring-2 ring-surface">
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
          className="flex items-center gap-2 rounded-lg p-0.5 pr-2 transition-colors hover:bg-sunken"
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-accent-fg text-body-sm font-semibold text-ink shadow-sm shadow-brand-500/30">
            {user?.name?.[0] ?? "U"}
          </div>
          <ChevronDown className="h-3.5 w-3.5 text-ink-faint" />
        </button>

        <AnimatePresence>
        {menu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenu(false)} aria-hidden="true" />
            <motion.div
              role="menu"
              className="absolute right-0 top-full z-50 mt-2 w-56 origin-top-right rounded-xl border border-rule bg-surface p-1.5 shadow-dropdown"
              onMouseLeave={() => setMenu(false)}
              initial={{ opacity: 0, scale: 0.95, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -4 }}
              transition={{ duration: DUR.fast, ease: EASE }}
            >
              <div className="px-3 py-2.5">
                <div className="text-body font-semibold text-ink">
                  {user?.name}
                </div>
                <div className="mt-0.5 text-body-sm text-ink-faint">
                  {user?.email}
                </div>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <Shield className="h-3 w-3 text-accent" />
                  <span className="text-body-sm font-medium text-accent">
                    {role}
                  </span>
                </div>
              </div>

              <hr className="mx-2 border-rule" />

              <div className="mt-1 space-y-0.5">
                <NavLink
                  to="/profile"
                  role="menuitem"
                  className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-body text-ink-soft transition-colors hover:bg-sunken"
                  onClick={() => setMenu(false)}
                >
                  <User className="h-4 w-4 text-ink-faint" />
                  Profile
                </NavLink>
                <NavLink
                  to="/settings"
                  role="menuitem"
                  className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-body text-ink-soft transition-colors hover:bg-sunken"
                  onClick={() => setMenu(false)}
                >
                  <Settings className="h-4 w-4 text-ink-faint" />
                  Settings
                </NavLink>
              </div>

              <hr className="mx-2 mt-1 border-rule" />

              <button
                role="menuitem"
                onClick={logout}
                className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-body text-red-600 transition-colors hover:bg-red-50"
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
   Group tabs — the pages a job owns

   Rendered once here rather than per page, so every demoted destination keeps
   its own route and its own query string while gaining a way back to its
   siblings. Its own layoutId, or it would fight a page's internal tab bar.
   ───────────────────────────────────────────── */
function GroupTabs() {
  const navigate = useNavigate();
  const location = useLocation();
  const current = destinationFor(location.pathname);
  const tabs = current?.group.tabs;
  if (!tabs) return null;

  return (
    <Tabs
      className="shrink-0 bg-surface px-4 lg:px-8"
      layoutId="group-tab-underline"
      active={current.to}
      onChange={(to) => navigate(to)}
      tabs={tabs.map((t) => ({
        id: t.to,
        label: t.label,
        trailing: t.badge === "alerts" ? <AlertBadge /> : undefined,
      }))}
    />
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
          <li key={s.label} className="flex items-center justify-between gap-4 text-body">
            <span className="text-ink-soft">{s.label}</span>
            <kbd className="shrink-0 rounded border border-rule px-1.5 py-0.5 text-[11px] font-medium text-ink-faint">
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
    // Job names hide the feature words people actually type, so each entry
    // carries its group's keywords and every tab is listed in its own right.
    const nav: Command[] = NAV.filter((n) => !n.roles || can(...n.roles)).flatMap((n) =>
      (n.tabs ?? [{ to: n.to, label: n.label }]).map((t) => ({
        id: t.to,
        label: n.tabs ? `${n.label} · ${t.label}` : n.label,
        section: "Go to",
        icon: n.icon,
        hint: t.to,
        keywords: t.keywords ? `${t.keywords} ${t.label}` : `${n.keywords} ${t.label}`,
        run: () => navigate(t.to),
      })),
    );

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
    <div className="flex h-full bg-surface-tertiary">
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
        <GroupTabs />
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