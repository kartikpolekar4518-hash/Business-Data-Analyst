// The visual catalog's contract. One definition per visual feeds both the Chart library
// page and the Dashboard builder's palette, so adding a visual is one registry entry
// rather than parallel edits in two pages that drift apart.
//
// Types only — the entries themselves live in components/visuals.registry.tsx, which can
// hold JSX. Keeping the contract here leaves it importable from anywhere without pulling
// every chart component into the bundle.
import type { ReactNode } from "react";
import type { WidgetSize } from "../components/widgets";
import type { OverviewResponse } from "./types";

export const CATEGORIES = [
  "all", "trend", "comparison", "composition", "distribution",
  "relationship", "progress", "map", "table", "filter",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABEL: Record<Category, string> = {
  all: "All",
  trend: "Trend",
  comparison: "Comparison",
  composition: "Composition",
  distribution: "Distribution",
  relationship: "Relationship",
  progress: "Progress",
  map: "Map",
  table: "Table",
  filter: "Filter",
};

export type VisualDef = {
  // Stable id — the Dashboard builder persists it in localStorage, so renaming one
  // silently drops that widget from every saved layout.
  id: string;
  // Power BI's own wording, so the catalog can be read against a Power BI visuals list
  // without translation.
  name: string;
  subtitle: string;
  category: Exclude<Category, "all">;
  // Spans both columns in the library grid — for visuals that are unreadable at half
  // width (maps, matrices, anything with a time axis).
  wide?: boolean;
  // Sample data for the library page. A function, not a value, so a random or
  // date-relative sample is generated per render rather than frozen at module load.
  sample: () => unknown;
  render: (data: unknown) => ReactNode;
  // Absent = library-only, not offered in the builder. Present = the builder can render
  // it from live data.
  builder?: {
    size: WidgetSize;
    // Returning null means "this dataset has nothing for this visual" — the builder shows
    // its empty state instead of a chart drawn from nothing.
    fromOverview: (d: OverviewResponse) => unknown | null;
  };
};
