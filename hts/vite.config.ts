import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import packageJson from "./package.json" with { type: "json" };

const APP_NAME = "Humidity & Temperature Sensor";
const APP_SHORT_NAME = "HTS";
const APP_DESCRIPTION = "Humidity and temperature readings from the sensor pi";
const THEME_COLOR = "rgb(24, 64, 96)";
const BACKGROUND_COLOR = "rgb(250, 250, 250)";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // "prompt" lets the user choose when a new version takes over, instead
      // of the page reloading under them.
      registerType: "prompt",
      injectRegister: false,
      pwaAssets: { disabled: false, config: true },
      manifest: {
        name: APP_NAME,
        short_name: APP_SHORT_NAME,
        description: APP_DESCRIPTION,
        theme_color: THEME_COLOR,
        background_color: BACKGROUND_COLOR,
        display: "standalone",
        start_url: "/",
        scope: "/",
      },
      workbox: {
        // The plugin precaches the manifest itself. Matching it here too adds a
        // second entry with a different revision, which makes Workbox reject
        // the whole precache.
        globPatterns: ["**/*.{js,css,html,svg,png,ico}"],
        cleanupOutdatedCaches: true,
        // Without this, a tab opened before the first service worker installed
        // is never controlled by one, so accepting an update in that tab
        // activates the new worker but never hands it the page. The new worker
        // still waits for the user before activating.
        clientsClaim: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
    css: false,
  },
});
