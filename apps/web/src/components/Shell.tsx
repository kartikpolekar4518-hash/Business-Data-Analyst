import { type ReactNode, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { LayoutDashboard, Database, BarChart3, MessagesSquare, TrendingUp, FileText, Bell, Settings, Menu, Sun, Moon, LogOut, BrainCircuit, ChevronRight } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useTheme } from "../lib/theme";
import { cn } from "../lib/utils";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/data", label: "Data", icon: Database },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/ai-chat", label: "Chat with Data", icon: MessagesSquare, roles: ["ADMIN", "MANAGER"] as const },
  { to: "/forecasts", label: "Forecasts", icon: TrendingUp },
  { to: "/reports", label: "Reports", icon: FileText },
  { to: "/alerts", label: "Alerts", icon: Bell },
  { to: "/settings", label: "Settings", icon: Settings },
];

const LOGO_GRADIENT = "linear-gradient(135deg, #a78bfa 0%, #7c3aed 60%, #6d28d9 100%)";
const AVATAR_GRADIENT = "linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%)";

export function Shell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { user, organization, role, logout, can } = useAuth();
  const { theme, toggle } = useTheme();
  const [menu, setMenu] = useState(false);
  const location = useLocation();
  const { data: alerts } = useQuery({
    queryKey: ["alerts"],
    queryFn: () => api.get<{ unread: number }>("/alerts"),
    refetchInterval: 60000,
  });

  const crumb = NAV.find((n) => location.pathname.startsWith(n.to))?.label ?? "";

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-40 flex w-[232px] shrink-0 flex-col",
        "border-r border-slate-200 bg-white",
        "dark:border-white/[0.06] dark:bg-[#0d0d16]",
        "transition-transform duration-200 lg:static lg:translate-x-0",
        open ? "translate-x-0" : "-translate-x-full"
      )}>
        {/* Logo */}
        <div className="flex h-14 items-center gap-2.5 border-b border-slate-100 dark:border-white/[0.06] px-4">
          <div
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white"
            style={{ background: LOGO_GRADIENT }}
          >
            <BrainCircuit className="h-4 w-4" />
          </div>
          <span className="text-[15px] font-bold tracking-tight text-slate-900 dark:text-white">
            DecisionIQ
          </span>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2.5 pt-3">
          {NAV.filter((n) => !n.roles || can(...n.roles)).map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              onClick={() => setOpen(false)}
              className={({ isActive }) => cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-[7px] text-[13.5px] font-medium transition-colors",
                isActive
                  ? "bg-brand-600/10 text-brand-700 dark:bg-brand-400/[0.12] dark:text-brand-300"
                  : "text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/[0.05] dark:hover:text-slate-200"
              )}
            >
              <n.icon className="h-[15px] w-[15px] shrink-0" />
              {n.label}
              {n.to === "/alerts" && alerts?.unread ? (
                <span className="ml-auto rounded-full bg-red-500 px-1.5 py-px text-[10px] font-bold text-white leading-none">
                  {alerts.unread}
                </span>
              ) : null}
            </NavLink>
          ))}
        </nav>

        {/* Bottom user strip */}
        <div className="border-t border-slate-100 dark:border-white/[0.06] p-3">
          <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
              style={{ background: AVATAR_GRADIENT }}
            >
              {user?.name?.[0] ?? "U"}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium leading-none text-slate-800 dark:text-slate-200">{user?.name ?? "User"}</p>
              <p className="mt-0.5 truncate text-[11px] text-slate-400">{role}</p>
            </div>
          </div>
        </div>
      </aside>

      {open && (
        <div className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm lg:hidden" onClick={() => setOpen(false)} />
      )}

      {/* Main area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200/80 bg-white/90 px-4 backdrop-blur-md dark:border-white/[0.06] dark:bg-[#0d0d16]/90">
          <button
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 lg:hidden transition-colors"
            onClick={() => setOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* Workspace pill */}
          <div className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 text-[13px] font-medium text-slate-600 dark:bg-white/[0.06] dark:text-slate-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {organization?.name ?? "Workspace"}
          </div>

          {crumb && (
            <div className="hidden items-center gap-1.5 md:flex">
              <ChevronRight className="h-3.5 w-3.5 text-slate-300 dark:text-slate-600" />
              <span className="text-[13px] text-slate-400">{crumb}</span>
            </div>
          )}

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
                <div
                  className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold text-white"
                  style={{ background: AVATAR_GRADIENT }}
                >
                  {user?.name?.[0] ?? "U"}
                </div>
              </button>

              {menu && (
                <div
                  className="absolute right-0 mt-1.5 w-52 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl shadow-black/[0.08] animate-in dark:border-white/10 dark:bg-[#141420] dark:shadow-black/40"
                  onMouseLeave={() => setMenu(false)}
                >
                  <div className="px-3 py-2">
                    <p className="text-[13.5px] font-semibold text-slate-800 dark:text-slate-100">{user?.name}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">{user?.email}</p>
                    <p className="mt-1.5 inline-flex rounded-md bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700 dark:bg-brand-900/50 dark:text-brand-300">{role}</p>
                  </div>
                  <hr className="my-1 border-slate-100 dark:border-white/[0.06]" />
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
    </div>
  );
}
