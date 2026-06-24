import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server proxies /ws and /api to the Python backend (SPEC §6).
export default defineConfig({
  plugins: [react()],
  server: {
    // Uncommon port (not Vite's default 5173) to avoid colliding with other
    // Vite/dev projects the developer may already be running. Keep in sync with
    // desktop/main.js DEV_URL and the dev scripts.
    port: 51173,
    proxy: {
      "/api": "http://127.0.0.1:8770",
      "/ws": {
        target: "http://127.0.0.1:8770",
        ws: true,
      },
    },
  },
});
