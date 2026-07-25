// Industry list for signup + settings. Keys must match the backend packs in
// apps/api/src/engine/industries.ts.
export const INDUSTRIES: { key: string; label: string }[] = [
  { key: "retail", label: "Retail / Sales" },
  { key: "pharmacy", label: "Pharmacy" },
  { key: "saas", label: "Tech / SaaS" },
  { key: "generic", label: "Other / General" },
];

export const industryLabel = (key?: string) =>
  INDUSTRIES.find((i) => i.key === key)?.label ?? "Other / General";
