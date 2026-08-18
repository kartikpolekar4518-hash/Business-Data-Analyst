import { test, expect } from "vitest";
import { BarChart3, DollarSign } from "lucide-react";
import { kpiIcon, formatKpiValue, KPI_ICONS } from "./kpi";

test("kpiIcon: known pack keys map to their icon", () => {
  expect(kpiIcon("revenue")).toBe(DollarSign);
  expect(kpiIcon("revenue")).toBe(KPI_ICONS.revenue);
});

test("kpiIcon: unknown keys fall back to a generic chart icon", () => {
  expect(kpiIcon("not-a-real-kpi")).toBe(BarChart3);
});

test("formatKpiValue: money format delegates to the money helper", () => {
  expect(formatKpiValue(1_500_000, "money")).toBe("$1.50M");
});

test("formatKpiValue: percent rounds to one decimal and appends %", () => {
  expect(formatKpiValue(12.34, "percent")).toBe("12.3%");
  expect(formatKpiValue(50, "percent")).toBe("50%");
});

test("formatKpiValue: number format is locale-grouped", () => {
  expect(formatKpiValue(1234, "number")).toBe((1234).toLocaleString());
});
