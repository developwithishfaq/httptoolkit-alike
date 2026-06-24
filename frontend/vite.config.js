import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// Dev server proxies /ws and /api to the Python backend (SPEC §6).
export default defineConfig({
    plugins: [react()],
    server: {
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
