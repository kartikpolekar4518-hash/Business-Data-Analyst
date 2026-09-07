// The geo engine. One renderer covers three Power BI visuals: Filled map (choropleth),
// Map (bubbles), and Shape map — which is this same component fed a different boundary
// set, because that is all Shape map is.
//
// Boundaries ship in the bundle rather than coming from a tile service: no API key, no
// runtime network call, no bill that grows with usage.
import { useMemo } from "react";
import { geoEqualEarth, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { Topology, GeometryCollection } from "topojson-specification";
import worldTopo from "world-atlas/countries-110m.json";
import { CHART, useAxis, fmtK } from "./charts";
import { formatKpiValue, type KpiFormat } from "../lib/kpi";
import { matchRegions, quantize } from "../lib/visuals.data";

type RegionFeature = Feature<Geometry, { name?: string }>;

// Equal Earth, not Mercator: on a choropleth the reader compares filled areas, and
// Mercator inflates high latitudes enough to make Greenland outrank India by eye.
const VB_W = 900;
const VB_H = 460;

// Parsed once at module load — the topology is static, and re-deriving it per render
// would re-walk 177 countries' arcs on every theme toggle.
export const WORLD: FeatureCollection<Geometry, { name?: string }> = feature(
  worldTopo as unknown as Topology,
  (worldTopo as unknown as Topology).objects.countries as GeometryCollection,
) as FeatureCollection<Geometry, { name?: string }>;

export function GeoMap({
  data,
  mode = "filled",
  geo,
  height = 380,
  format = "number",
  buckets = 5,
}: {
  data: { label: string; value: number }[];
  mode?: "filled" | "bubble";
  // Any GeoJSON works — Indian states, US states, hand-drawn sales territories. Omitted,
  // it is world countries.
  geo?: FeatureCollection<Geometry, { name?: string }>;
  height?: number;
  format?: KpiFormat;
  buckets?: number;
}) {
  const { dark, tick } = useAxis();
  const collection = geo ?? WORLD;

  const { paths, centroids, matched, unmatched, scale, max } = useMemo(() => {
    const projection = geoEqualEarth().fitSize([VB_W, VB_H], collection);
    const path = geoPath(projection);
    const names = collection.features.map((f) => f.properties?.name ?? "").filter(Boolean);
    const m = matchRegions(data, names);
    const values = [...m.matched.values()];
    return {
      paths: collection.features.map((f) => ({ f: f as RegionFeature, d: path(f) ?? "" })),
      centroids: new Map(collection.features.map((f) => [f.properties?.name ?? "", path.centroid(f)])),
      matched: m.matched,
      unmatched: m.unmatched,
      scale: quantize(values, buckets),
      max: Math.max(...values.map(Math.abs), 1),
    };
  }, [collection, data, buckets]);

  // Sequential intensity over the brand blue, the same construction Heatmap uses. Built
  // from opacity rather than fixed hex stops so the low end stays legible against both the
  // light and the dark page ground.
  const steps = scale.breaks.length + 1;
  const fillFor = (v: number) => `rgba(91,140,255,${0.18 + (steps > 1 ? scale.bucketOf(v) / (steps - 1) : 1) * 0.72})`;
  // Visibly distinct from the palest data bucket: "no data" and "very little" are
  // different answers, and the same token the gauge uses for its empty track.
  const noData = dark ? "rgba(148,163,184,0.14)" : "#eef2f7";
  const stroke = dark ? "rgba(15,23,42,0.85)" : "#ffffff";

  return (
    <div>
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        width="100%"
        height={height}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={mode === "filled" ? "Filled map shaded by value" : "Map with bubbles sized by value"}
      >
        {paths.map(({ f, d }, i) => {
          const name = f.properties?.name ?? "";
          const value = matched.get(name);
          const has = value != null;
          return (
            <path
              key={name || i}
              d={d}
              // In bubble mode the shapes are only a backdrop, so they stay neutral and
              // let the circles carry the measure.
              fill={mode === "filled" && has ? fillFor(value) : noData}
              stroke={stroke}
              strokeWidth={0.5}
            >
              <title>{`${name}: ${has ? formatKpiValue(value, format) : "no data"}`}</title>
            </path>
          );
        })}

        {mode === "bubble" &&
          [...matched].map(([name, value]) => {
            const c = centroids.get(name);
            if (!c || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) return null;
            // Area, not radius, carries the value — scaling the radius linearly would
            // overstate a large value by its square.
            const r = Math.sqrt(Math.abs(value) / max) * 26;
            return (
              <circle key={name} cx={c[0]} cy={c[1]} r={Math.max(2.5, r)} fill={CHART.blue} fillOpacity={0.55} stroke={CHART.blue} strokeWidth={1}>
                <title>{`${name}: ${formatKpiValue(value, format)}`}</title>
              </circle>
            );
          })}
      </svg>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-body-sm" style={{ color: tick.fill }}>
        {mode === "filled" ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {Array.from({ length: steps }, (_, i) => {
              const lo = i === 0 ? null : scale.breaks[i - 1];
              const hi = i < scale.breaks.length ? scale.breaks[i] : null;
              return (
                <span key={i} className="flex items-center gap-1">
                  <span className="h-3 w-5 rounded-sm" style={{ background: `rgba(91,140,255,${0.18 + (steps > 1 ? i / (steps - 1) : 1) * 0.72})` }} />
                  <span className="tabular-nums">
                    {lo == null ? `< ${fmtK(hi ?? 0)}` : hi == null ? `${fmtK(lo)}+` : `${fmtK(lo)}–${fmtK(hi)}`}
                  </span>
                </span>
              );
            })}
          </div>
        ) : (
          <span>Bubble area is proportional to value.</span>
        )}
        <span className="flex items-center gap-1">
          <span className="h-3 w-5 rounded-sm" style={{ background: noData }} />
          No data
        </span>
      </div>

      {mode === "bubble" && (
        // Stated on the visual, not buried in a doc: without latitude and longitude
        // columns these sit at the centre of each region, which is an approximation and
        // not a claim about where anything actually happened.
        <p className="mt-2 text-body-sm text-ink-faint">
          Positioned at region centres — add latitude and longitude columns for exact points.
        </p>
      )}

      {unmatched.length > 0 && (
        // Never silently dropped: an unplaced region is unplaced revenue, and the reader
        // has to know the map is short of the total.
        <p
          className="mt-2 text-body-sm text-warn"
          title={unmatched.join(", ")}
        >
          {unmatched.length} region{unmatched.length === 1 ? "" : "s"} not on the map: {unmatched.slice(0, 3).join(", ")}
          {unmatched.length > 3 ? `, +${unmatched.length - 3} more` : ""}
        </p>
      )}
    </div>
  );
}
