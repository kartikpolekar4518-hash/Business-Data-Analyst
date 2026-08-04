// Shared rendering helpers for the pack-driven KPI descriptor.
import {
  DollarSign, TrendingUp, ShoppingCart, Users, Percent,
  Pill, RefreshCw, Layers, FileText, Database, BarChart3, type LucideIcon,
} from "lucide-react";
import { money, num } from "./utils";
import type { KpiResult } from "./types";

// KPI icon keys come from the industry pack (backend engine/industries.ts).
export const KPI_ICONS: Record<string, LucideIcon> = {
  revenue: DollarSign, profit: TrendingUp, orders: ShoppingCart, customers: Users, margin: Percent,
  prescriptions: FileText, patients: Users, medicines: Pill,
  subscriptions: RefreshCw, plan: Layers, records: Database,
};
export const kpiIcon = (k: string): LucideIcon => KPI_ICONS[k] ?? BarChart3;

export type KpiFormat = KpiResult["format"];

export const formatKpiValue = (value: number, format: KpiFormat): string =>
  format === "money" ? money(value) : format === "percent" ? `${Math.round(value * 10) / 10}%` : num(value);
