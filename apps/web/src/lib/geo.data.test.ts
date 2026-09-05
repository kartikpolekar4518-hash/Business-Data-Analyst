// Guards the region alias table against the boundary set it is written for. An alias
// pointing at a country name the bundled map does not use fails silently at runtime — the
// row just lands in `unmatched` and its value quietly leaves the map.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { feature } from "topojson-client";
import type { FeatureCollection, Geometry } from "geojson";
import type { Topology, GeometryCollection } from "topojson-specification";
import { REGION_ALIASES, matchRegions, normalizeRegion } from "./visuals.data";

// createRequire rather than a JSON import: Node ESM needs an import attribute for JSON,
// and the syntax is still settling across the tsx/tsc versions this repo runs.
const require = createRequire(import.meta.url);
const topo = require("world-atlas/countries-110m.json") as Topology;
const collection = feature(topo, topo.objects.countries as GeometryCollection) as FeatureCollection<Geometry, { name?: string }>;
const names: string[] = collection.features.map((f) => f.properties?.name ?? "").filter(Boolean);

test("the bundled world map loads and has every continent's countries", () => {
  assert.ok(names.length > 150, `expected ~177 countries, got ${names.length}`);
  for (const n of ["India", "Brazil", "Nigeria", "Australia", "Germany"]) {
    assert.ok(names.includes(n), `missing ${n}`);
  }
});

test("every alias points at a name the bundled map actually uses", () => {
  const known = new Set(names.map(normalizeRegion));
  const broken = Object.entries(REGION_ALIASES)
    .filter(([, target]) => !known.has(normalizeRegion(target)))
    .map(([from, to]) => `${from} -> ${to}`);
  assert.deepEqual(broken, [], `aliases pointing at names not in the map: ${broken.join(", ")}`);
});

test("common business spellings all land on the real map", () => {
  const rows = ["USA", "UK", "UAE", "South Korea", "North Korea", "Czech Republic", "Russia", "Holland", "Burma"]
    .map((label) => ({ label, value: 1 }));
  const { unmatched } = matchRegions(rows, names);
  assert.deepEqual(unmatched, []);
});
