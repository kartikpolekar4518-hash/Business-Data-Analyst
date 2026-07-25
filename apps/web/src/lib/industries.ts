import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export interface Industry { key: string; label: string }

// Local fallback used before the API responds (and if it's unreachable). The
// backend `GET /industries` (apps/api/src/engine/industries.ts) is the source of
// truth, so a new pack shows up here automatically without editing this file.
export const INDUSTRIES: Industry[] = [
  { key: "retail", label: "Retail / Sales" },
  { key: "pharmacy", label: "Pharmacy" },
  { key: "saas", label: "Tech / SaaS" },
  { key: "generic", label: "Other / General" },
];

export function useIndustries(): Industry[] {
  const { data } = useQuery({
    queryKey: ["industries"],
    queryFn: () => api.get<{ industries: Industry[] }>("/industries").then((r) => r.industries),
    initialData: INDUSTRIES,
    staleTime: Infinity,
  });
  return data ?? INDUSTRIES;
}

export const industryLabel = (key?: string) =>
  INDUSTRIES.find((i) => i.key === key)?.label ?? "Other / General";
