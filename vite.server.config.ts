import { defineConfig } from "vite";

/**
 * Bundles the iPad endpoint into one self-contained file, api/coach.js.
 * Vercel serves anything in /api as a function; shipping a single plain-JS file
 * avoids Node's ES-module import rules for the TypeScript sources.
 */
export default defineConfig({
  publicDir: false,
  build: {
    ssr: "src/server/coachApi.ts",
    outDir: "api",
    emptyOutDir: false,
    target: "node20",
    minify: false,
    rollupOptions: { output: { entryFileNames: "coach.js", format: "es", inlineDynamicImports: true } },
  },
  ssr: { noExternal: true },
});
