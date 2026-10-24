import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    environment: "node",
    clearMocks: true,
    // Transform the pinned SDK so next/headers uses the per-request test mock.
    // Native Node ESM cannot resolve its extensionless Next framework import.
    server: { deps: { inline: [/@neondatabase\/auth/] } },
  },
});
