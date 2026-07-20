import { type ReactNode, useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Database, BarChart3, MessagesSquare, TrendingUp, FileText, Bell,
  Settings, Menu, Sun, Moon, LogOut, BrainCircuit, ChevronRight, ChevronsLeft, ChevronsRight,
  Search, UploadCloud, Sparkles,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { useTheme } from "../lib/theme";
import { cn } from "../lib/utils";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { CommandPalette, type CommandItem } from "./CommandPalette";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/data", label: "Data", icon: Database },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  // Chat persists conversations, so it's ADMIN/MANAGER only (matches the API gate).
  { to: "/ai-chat", label: "Chat with Data", icon: MessagesSquare, roles: ["ADMIN", "MANAGER"] as const },
  { to: "/forecasts", label: "Forecasts", icon: TrendingUp },
  { to: "/reports", label: "Reports", icon: FileText },
  { to: "/alerts", label: "Alerts", icon: Bell },
  { to: "/settings", label: "Settings", icon: Settings },
];

const SIDEBAR_KEY = "diq_sidebar_collapsed";

export function Shell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_KEY) === "1");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { user, organization, role, logout, can } = useAuth();
  const { theme, toggle } = useTheme();
  const [menu, setMenu] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { data: alerts } = useQuery({ queryKey: ["alerts"], queryFn: () => api.get<{ unread: number }>("/alerts"), refetchInterval: 60000 });

  useEffect(() => { localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0"); }, [collapsed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const visibleNav = NAV.filter((n) => !n.roles || can(...n.roles));
  const crumb = visibleNav.find((n) => location.pathname.startsWith(n.to))?.label ?? "";

  const commandItems: CommandItem[] = [
    ...visibleNav.map((n) => ({ id: n.to, label: n.label, icon: n.icon, group: "Navigate", onSelect: () => navigate(n.to) })),
    { id: "upload", label: "Upload data", icon: UploadCloud, group: "Actions", onSelect: () => navigate("/data") },
    { id: "ask-ai", label: "Ask AI about your data", icon: Sparkles, group: "Actions", onSelect: () => navigate("/ai-chat") },
    { id: "toggle-theme", label: `Switch to ${theme === "dark" ? "light" : "dark"} theme`, icon: theme === "dark" ? Sun : Moon, group: "Actions", onSelect: toggle },
  ];

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-40 flex shrink-0 flex-col",
        "border-r border-slate-200 bg-white",
        "dark:border-white/[0.07] dark:bg-[#0a0a0b]",
        "transition-[width,transform] duration-200 lg:static",
        collapsed ? "lg:w-16" : "lg:w-[232px]",
        "w-[232px] lg:translate-x-0",
        open ? "translate-x-0" : "-translate-x-full"
      )}>
        {/* Logo */}
        <div className={cn("flex h-14 items-center gap-2.5 border-b border-slate-100 dark:border-white/[0.07]", collapsed ? "justify-center px-2" : "px-4")}>
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white">
            <BrainCircuit className="h-4 w-4" />
          </div>
          {!collapsed && <span className="text-[15px] font-bold tracking-tight text-slate-900 dark:text-white">DecisionIQ</span>}
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2.5 pt-3">
          {visibleNav.map((n) => (
            <div key={n.to} className="group/item relative">
              <NavLink
                to={n.to}
                onClick={() => setOpen(false)}
                className={({ isActive }) => cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-[7px] text-[13.5px] font-medium transition-colors",
                  collapsed && "justify-center px-0",
                  isActive
                    ? "bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
                    : "text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/[0.05] dark:hover:text-slate-200"
                )}
              >
                <n.icon className="h-[15px] w-[15px] shrink-0" />
                {!collapsed && n.label}
                {!collapsed && n.to === "/alerts" && alerts?.unread ? (
                  <span className="ml-auto rounded-full bg-red-500 px-1.5 py-px text-[10px] font-bold text-white leading-none">
                    {alerts.unread}
                  </span>
                ) : null}
              </NavLink>
              {collapsed && (
                <div className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12.5px] font-medium text-slate-700 opacity-0 shadow-elevated transition-opacity group-hover/item:opacity-100 dark:border-white/10 dark:bg-[#18181b] dark:text-slate-200">
                  {n.label}
                  {n.to === "/alerts" && alerts?.unread ? ` (${alerts.unread})` : ""}
                </div>
              )}
            </div>
          ))}
        </nav>

        {/* Collapse toggle */}
        <div className="border-t border-slate-100 p-2.5 dark:border-white/[0.07]">
          <button
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            className={cn(
              "hidden w-full items-center gap-2.5 rounded-lg px-3 py-[7px] text-[12.5px] font-medium text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/[0.05] dark:hover:text-slate-300 lg:flex",
              collapsed && "justify-center px-0"
            )}
          >
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <><ChevronsLeft className="h-4 w-4" />Collapse</>}
          </button>
        </div>

        {/* Bottom user strip */}
        <div className="border-t border-slate-100 p-3 dark:border-white/[0.07]">
          <div className={cn("flex items-center gap-2.5 rounded-lg px-2 py-2", collapsed && "justify-center px-0")}>
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-[11px] font-bold text-white">
              {user?.name?.[0] ?? "U"}
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium leading-none text-slate-800 dark:text-slate-200">{user?.name ?? "User"}</p>
                <p className="mt-0.5 truncate text-[11px] text-slate-400">{role}</p>
              </div>
            )}
          </div>
        </div>
      </aside>

      {open && (
        <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />
      )}

      {/* Main area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200/80 bg-white/90 px-4 backdrop-blur-md dark:border-white/[0.07] dark:bg-[#0a0a0b]/90">
          <button
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 lg:hidden transition-colors"
            onClick={() => setOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* Workspace pill */}
          <div className="hidden items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[13px] font-medium text-slate-600 dark:border-white/10 dark:text-slate-300 sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {organization?.name ?? "Workspace"}
          </div>

          {crumb && (
            <div className="hidden items-center gap-1.5 md:flex">
              <ChevronRight className="h-3.5 w-3.5 text-slate-300 dark:text-slate-600" />
              <span className="text-[13px] text-slate-400">{crumb}</span>
            </div>
          )}

          {/* Search / command palette trigger */}
          <button
            onClick={() => setPaletteOpen(true)}
            className="ml-1 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[13px] text-slate-400 transition-colors hover:border-slate-300 hover:text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-white/20 sm:w-56"
            aria-label="Open search"
          >
            <Search className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden truncate sm:inline">Search…</span>
            <kbd className="ml-auto hidden shrink-0 rounded border border-slate-200 px-1 py-px text-[10px] font-medium dark:border-white/10 sm:block">⌘K</kbd>
          </button>

          <div className="ml-auto flex items-center gap-0.5">
            <button
              onClick={toggle}
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/5 dark:hover:text-slate-300 transition-colors"
              aria-label="Toggle theme"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            <NavLink
              to="/alerts"
              className="relative rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/5 dark:hover:text-slate-300 transition-colors"
              aria-label={alerts?.unread ? `Alerts (${alerts.unread} unread)` : "Alerts"}
            >
              <Bell className="h-4 w-4" />
              {alerts?.unread ? (
                <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-red-500" />
              ) : null}
            </NavLink>

            <div className="relative">
              <button
                onClick={() => setMenu((m) => !m)}
                aria-label="Account menu"
                aria-expanded={menu}
                className="ml-1 flex items-center gap-2 rounded-lg p-1.5 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-[11px] font-bold text-white">
                  {user?.name?.[0] ?? "U"}
                </div>
              </button>

              {menu && (
                <div
                  className="absolute right-0 mt-1.5 w-52 rounded-xl border border-slate-200 bg-white p-1.5 shadow-elevated animate-in dark:border-white/10 dark:bg-[#131315]"
                  onMouseLeave={() => setMenu(false)}
                >
                  <div className="px-3 py-2">
                    <p className="text-[13.5px] font-semibold text-slate-800 dark:text-slate-100">{user?.name}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">{user?.email}</p>
                    <p className="mt-1.5 inline-flex rounded-md bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">{role}</p>
                  </div>
                  <hr className="my-1 border-slate-100 dark:border-white/[0.07]" />
                  <NavLink
                    to="/profile"
                    className="block rounded-lg px-3 py-1.5 text-[13px] text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5 transition-colors"
                    onClick={() => setMenu(false)}
                  >
                    Profile
                  </NavLink>
                  <button
                    onClick={logout}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40 transition-colors"
                  >
                    <LogOut className="h-3.5 w-3.5" />Log out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-5 md:p-7">{children}</main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} items={commandItems} />
    </div>
  );
}
