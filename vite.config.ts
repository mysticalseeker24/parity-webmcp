import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    // jsdom, not happy-dom: we redefine `document.modelContext` and stub
    // `window.top`, and jsdom is the stricter of the two about property
    // descriptors — closer to what the real browser will do to us.
    environment: "jsdom",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    restoreMocks: true,
  },
});
