import react from "@vitejs/plugin-react";
import legacy from "@vitejs/plugin-legacy";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react(),
    legacy({
      targets: ["Chrome >= 80", "Edge >= 80", "Firefox >= 78", "Safari >= 13"],
      modernPolyfills: true,
    }),
  ],
  base: "./",
  build: {
    outDir: "dist",
  },
});
