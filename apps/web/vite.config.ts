import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Absolute asset URLs. The built SPA is served from a domain root (Vercel, or the API
  // in single-container mode); a relative base would resolve /assets/* against the current
  // path and break deep links such as /dashboard/<id> on refresh.
  base: "/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:4000" },
  },
});
