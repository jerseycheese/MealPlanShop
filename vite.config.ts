import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API_PORT = parseInt(process.env.API_PORT || "3101", 10);

export default defineConfig({
  root: "src/app",
  plugins: [react()],
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": `http://localhost:${API_PORT}`,
    },
  },
});
