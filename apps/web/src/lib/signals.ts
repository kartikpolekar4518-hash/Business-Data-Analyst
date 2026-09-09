import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type { Prediction, SignalsStatus } from "../components/estimates";

// The data side of a Signals page, shared by all three so the polling rule lives in one
// place. Each page differs only in how it draws a result.

const RUN_POLL_MS = 2000;

export function useSignal(slug: "segments" | "churn" | "basket") {
  const qc = useQueryClient();

  // Cheap and read-only. Fetched on every page load because "is the service up" is a
  // live fact, not a session-long one.
  const status = useQuery({
    queryKey: ["signals-status"],
    queryFn: () => api.get<SignalsStatus>("/signals/status"),
  });

  const prediction = useQuery({
    queryKey: ["signal", slug],
    queryFn: () => api.get<{ prediction: Prediction | null }>(`/signals/${slug}`).then((r) => r.prediction),
    // A run finishes in the background, so the page polls while one is in flight and
    // stops the moment it settles. No socket, and no timer left running on a page that
    // has nothing to wait for.
    refetchInterval: (q) => (q.state.data?.status === "RUNNING" ? RUN_POLL_MS : false),
    enabled: status.data?.enabled === true && status.data?.entitled === true,
  });

  const run = useMutation({
    mutationFn: () => api.post<{ prediction: Prediction }>(`/signals/${slug}`, {}),
    // Seeds the RUNNING row straight away, so the page shows "working on it" without
    // waiting for the next poll to discover what the click already told us.
    onSuccess: (r) => qc.setQueryData(["signal", slug], r.prediction),
  });

  return {
    status: status.data,
    prediction: prediction.data ?? null,
    loading: status.isLoading || (prediction.isLoading && status.data?.entitled === true),
    error: status.isError || prediction.isError,
    retry: () => { void status.refetch(); void prediction.refetch(); },
    run: () => run.mutate(),
    running: run.isPending || prediction.data?.status === "RUNNING",
    runError: run.error,
  };
}
