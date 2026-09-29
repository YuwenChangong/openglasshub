import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  envDir: fileURLToPath(new URL(".", import.meta.url)),
  publicDir: false,
  define: { "import.meta.env.PUBLIC_SUPABASE_URL": "undefined", "import.meta.env.PUBLIC_SUPABASE_ANON_KEY": "undefined" },
  esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 0, hmr: false, fs: { allow: [fileURLToPath(new URL("../../..", import.meta.url))] } },
});
