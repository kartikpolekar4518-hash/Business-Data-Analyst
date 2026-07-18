import { type ReactNode, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { LayoutDashboard, Database, BarChart3, MessagesSquare, TrendingUp, FileText, Bell, Settings, Menu, X, Sun, Moon, LogOut, ChevronDown, BrainCircuit } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useTheme } from "../lib/theme";
import { cn } from "../lib/utils";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/data", label: "Data", icon: Database },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/ai-chat", label: "Chat with Data", icon: MessagesSquare },
  { to: "/forecasts", label: "Forecasts", icon: TrendingUp },
  { to: "/reports", label: "Reports", icon: FileText },
  { to: "/alerts", label: "Alerts", icon: Bell },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function Shell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { user, organization, role, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const [menu, setMenu] = useState(false);
  const location = useLocation();
  const { data: alerts } = useQuery({ queryKey: ["alerts"], queryFn: () => api.get<{ unread: number }>("/alerts"), refetchInterval: 60000 });

  const crumb = NAV.find((n) => location.pathname.startsWith(n.to))?.label ?? "";

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className={cn("fixed inset-y-0 left-0 z-40 w-64 shrink-0 border-r border-slate-200 bg-white transition-transform dark:border-slate-800 dark:bg-slate-900 lg:static lg:translate-x-0", open ? "translate-x-0" : "-translate-x-full")}>
        <div className="flex h-16 items-center gap-2 border-b border-slate-100 px-5 dark:border-slate-800">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white"><BrainCircuit className="h-5 w-5" /></div>
          <span className="text-lg font-bold tracking-tight">DecisionIQ</span>
        </div>
        <nav className="space-y-1 p-3">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} onClick={() => setOpen(false)}
              className={({ isActive }) => cn("flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition", isActive ? "bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300" : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800")}>
              <n.icon className="h-4 w-4" />{n.label}
              {n.to === "/alerts" && alerts?.unread ? <span className="ml-auto rounded-full bg-red-500 px-1.5 text-xs text-white">{alerts.unread}</span> : null}
            </NavLink>
          ))}
        </nav>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/80 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
          <button className="lg:hidden" onClick={() => setOpen(true)}><Menu className="h-5 w-5" /></button>
          {/* Workspace selector (single org in MVP) */}
          <button className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium dark:border-slate-700">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />{organization?.name ?? "Workspace"}<ChevronDown className="h-3.5 w-3.5 text-slate-400" />
          </button>
          <span className="hidden text-sm text-slate-400 md:inline">/ {crumb}</span>
          <div className="ml-auto flex items-center gap-1">
            <button onClick={toggle} className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800" title="Toggle theme">
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <NavLink to="/alerts" className="relative rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800">
              <Bell className="h-4 w-4" />{alerts?.unread ? <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-500" /> : null}
            </NavLink>
            <div className="relative">
              <button onClick={() => setMenu((m) => !m)} className="flex items-center gap-2 rounded-lg p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">{user?.name?.[0] ?? "U"}</div>
              </button>
              {menu && (
                <div className="absolute right-0 mt-1 w-52 rounded-lg border border-slate-200 bg-white p-1 shadow-lg animate-in dark:border-slate-800 dark:bg-slate-900" onMouseLeave={() => setMenu(false)}>
                  <div className="px-3 py-2"><div className="text-sm font-medium">{user?.name}</div><div className="text-xs text-slate-500">{user?.email}</div><div className="mt-1 text-xs text-brand-600">{role}</div></div>
                  <hr className="my-1 border-slate-100 dark:border-slate-800" />
                  <NavLink to="/profile" className="block rounded-md px-3 py-1.5 text-sm hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => setMenu(false)}>Profile</NavLink>
                  <button onClick={logout} className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"><LogOut className="h-4 w-4" />Log out</button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
