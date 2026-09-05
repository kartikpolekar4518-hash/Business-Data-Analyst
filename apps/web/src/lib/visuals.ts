// The visual catalog's contract. One definition per visual feeds both the Chart library
// page and the Dashboard builder's palette, so adding a visual is one registry entry
// rather than parallel edits in two pages that drift apart.
//
// Types only — the entries themselves live in components/visuals.registry.tsx, which can
// hold JSX. Keeping the contract here leaves it importable without pulling every chart
// component along with it.
import type { ReactNode } from "react";
import type { WidgetSize } from "../components/widgets";
import type { OverviewResponse, Rank } from "./types";

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

// What the Dashboard builder has on hand when it renders a widget. Gathered once at the
// page level, because a widget body is a callback and cannot open a query of its own.
export type BuilderContext = {
  overview: OverviewResponse;
  regions?: Rank[];
  drivers?: {
    dimension: string | null;
    drivers: { label: string; contribution: number; shareOfChange: number | null }[];
  };
  insight?: string;
  // Slicer widgets read and write these; the page re-queries the overview when they
  // change. A slicer that filters nothing is worse than no slicer at all.
  filters: Record<string, string[]>;
  setFilter: (key: string, values: string[]) => void;
};

export type VisualDef = {
  // Stable id — the Dashboard builder persists it in localStorage as a widget's `type`,
  // so renaming one silently drops that widget from every saved layout.
  id: string;
  // Power BI's own wording, so the catalog can be read straight against a Power BI
  // visuals list without translation.
  name: string;
  subtitle: string;
  category: Exclude<Category, "all">;
  // Spans both columns in the library grid — for visuals unreadable at half width: maps,
  // matrices, anything with a time axis.
  wide?: boolean;
  // The library page's sample. Self-contained and called per render, so a stateful or
  // date-relative demo works and nothing is frozen at module load.
  preview: () => ReactNode;
  builder?: {
    size: WidgetSize;
    // Returning null means "this dataset has nothing for this visual", and the builder
    // shows its empty state rather than a chart drawn from nothing.
    render: (ctx: BuilderContext) => ReactNode | null;
  };
};
