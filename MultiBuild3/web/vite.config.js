import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// API_BASE in src/api.js points at mm_api.py directly (http://localhost:8800), so no dev-server
// proxy is needed - CORS is already wide open on the API side for exactly this kind of local setup.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
});
