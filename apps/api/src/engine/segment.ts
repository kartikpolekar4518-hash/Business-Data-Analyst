// Segmentation of customers or products into value tiers. Pure, deterministic.
//
// Approach: rule-based quantile tiers on a business metric (revenue). Each member is
// placed by where its total sits in the distribution — top quartile = "High value",
// down to the bottom half = "Low value". This is fully explainable (every tier states
// its own threshold) and reproducible.
//
// Why not k-means here: over a single value axis, k-means clusters reduce to the same
// quantile cut points but with random, seed-dependent boundaries and no readable rule.
// Value tiers give an equivalent split that a business user — and an auditor — can read
// off directly, so we deliberately keep the rule-based method for this metric.

import type { Row } from "./parse.js";
import type { SchemaMap, Semantic } from "./schema.js";
import * as A from "./analytics.js";
import { quartiles } from "./quantiles.js";

export type SegmentEntity = "customer_name" | "product_name";

export interface Segment {
  key: "high" | "mid" | "low";
  label: string;
  count: number;
  members: string[];        // top members by revenue, capped
  totalRevenue: number;
  avgRevenue: number;
  shareOfRevenue: number;   // % of the entity's total revenue
  rule: string;             // human-readable membership rule with its threshold
}

export interface SegmentResult {
  entity: SegmentEntity | null;
  metric: "revenue";
  method: string;
  totalMembers: number;
  segments: Segment[];
}

const MEMBER_CAP = 12;


function pickEntity(s: SchemaMap, override?: SegmentEntity): SegmentEntity | null {
  if (override) return s[override] ? override : null;
  if (s.customer_name) return "customer_name";
  if (s.product_name) return "product_name";
  return null;
}

export function segmentEntities(rows: Row[], s: SchemaMap, entity?: SegmentEntity): SegmentResult {
  const ent = pickEntity(s, entity);
  const method = "value_tiers_quantile";
  if (!ent) return { entity: null, metric: "revenue", method, totalMembers: 0, segments: [] };

  // Revenue per member, descending.
  const ranked = A.groupBy(rows, s, ent as Semantic, "revenue", {}, 100_000).filter((x) => x.value > 0);
  if (!ranked.length) return { entity: ent, metric: "revenue", method, totalMembers: 0, segments: [] };

  const values = ranked.map((x) => x.value);
  const { median, q3 } = quartiles(values);
  const grand = values.reduce((a, b) => a + b, 0);

  const buckets: Record<Segment["key"], typeof ranked> = { high: [], mid: [], low: [] };
  for (const m of ranked) {
    const key: Segment["key"] = m.value >= q3 ? "high" : m.value >= median ? "mid" : "low";
    buckets[key].push(m);
  }

  const label: Record<Segment["key"], string> = { high: "High value", mid: "Mid value", low: "Low value" };
  const rule: Record<Segment["key"], string> = {
    high: `Top quartile by revenue (≥ ${A.fmtMoney(q3)}).`,
    mid: `Above the median, below the top quartile (${A.fmtMoney(median)}–${A.fmtMoney(q3)}).`,
    low: `Below the median revenue (< ${A.fmtMoney(median)}).`,
  };

  const segments = (["high", "mid", "low"] as Segment["key"][]).map((key) => {
    const members = buckets[key];
    const total = A.round(members.reduce((a, m) => a + m.value, 0));
    return {
      key, label: label[key], count: members.length,
      members: members.slice(0, MEMBER_CAP).map((m) => m.label),
      totalRevenue: total,
      avgRevenue: members.length ? A.round(total / members.length) : 0,
      shareOfRevenue: grand ? A.round((total / grand) * 100) : 0,
      rule: rule[key],
    };
  }).filter((seg) => seg.count > 0);

  return { entity: ent, metric: "revenue", method, totalMembers: ranked.length, segments };
}
