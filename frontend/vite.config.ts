import { defineConfig } from "vite";

export default defineConfig({
  // The relayer SDK's WASM build needs modern output and top-level await.
  build: {
    target: "esnext",
    // The FHE chunk (SDK + 5.4MB of WASM) is deliberately split behind the lazy
    // import in the reveal handler; initial load stays ~270kB. The default 500kB
    // warning would just be noise here.
    chunkSizeWarningLimit: 600,
  },
  esbuild: { target: "esnext" },
  optimizeDeps: {
    // Pre-bundling mangles the SDK's wasm URL resolution; serve it as authored.
    exclude: ["@zama-fhe/relayer-sdk"],
    esbuildOptions: { target: "esnext" },
  },
  define: { global: "globalThis" },
  server: { port: 5173 },
});
