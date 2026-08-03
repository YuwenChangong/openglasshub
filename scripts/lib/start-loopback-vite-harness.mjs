import { createServer as createHttpServer } from "node:http";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const LOOPBACK_HOST = "127.0.0.1";

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

async function resolveViteTooling() {
  const explicitEntry = process.env.OPENGLASS_VITE_MODULE_ENTRY;
  if (explicitEntry) {
    await access(explicitEntry).catch(() => fail("LOOPBACK_VITE_HARNESS_EXTERNAL_VITE_ENTRY_INVALID"));
    const externalRequire = createRequire(pathToFileURL(explicitEntry));
    return {
      createServer: (await import(pathToFileURL(explicitEntry).href)).createServer,
      react: (await import(pathToFileURL(externalRequire.resolve("@vitejs/plugin-react")).href)).default,
      aliases: [
        { find: "react/jsx-runtime", replacement: externalRequire.resolve("react/jsx-runtime") },
        { find: "react/jsx-dev-runtime", replacement: externalRequire.resolve("react/jsx-dev-runtime") },
        { find: "react-dom/client", replacement: externalRequire.resolve("react-dom/client") },
        { find: "react", replacement: externalRequire.resolve("react") },
      ],
      isolatedDependencies: true,
    };
  }
  const require = createRequire(import.meta.url);
  return { createServer: (await import(pathToFileURL(require.resolve("vite")).href)).createServer, isolatedDependencies: false };
}

export async function startLoopbackViteHarness({ root, configFile, cacheDir, createServer } = {}) {
  if (typeof root !== "string" || !root || typeof configFile !== "string" || !configFile) fail("LOOPBACK_VITE_HARNESS_INPUT_INVALID");
  let server;
  let httpServer;
  let closed = false;
  try {
    const tooling = createServer ? { createServer, isolatedDependencies: false } : await resolveViteTooling();
    const create = tooling.createServer;
    server = await create({
      root,
      ...(tooling.isolatedDependencies ? { configFile: false, plugins: [tooling.react()], resolve: { alias: tooling.aliases }, esbuild: { tsconfigRaw: { compilerOptions: { jsx: "react-jsx" } } }, optimizeDeps: { noDiscovery: true } } : { configFile }),
      ...(typeof cacheDir === "string" && cacheDir ? { cacheDir } : {}),
      server: { ...(tooling.isolatedDependencies ? { fs: { allow: [path.resolve(root, "../../..")] } } : {}), middlewareMode: true, host: LOOPBACK_HOST },
      logLevel: "error",
    });
    httpServer = createHttpServer(server.middlewares);
    await new Promise((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(0, LOOPBACK_HOST, resolve);
    });
    const address = httpServer.address();
    if (!address || typeof address === "string" || address.address !== LOOPBACK_HOST || !Number.isInteger(address.port) || address.port < 1) {
      fail("LOOPBACK_VITE_HARNESS_ADDRESS_INVALID");
    }
    return {
      server,
      httpServer,
      host: LOOPBACK_HOST,
      port: address.port,
      origin: `http://${LOOPBACK_HOST}:${address.port}`,
      async close() {
        if (closed) return;
        closed = true;
        httpServer.closeAllConnections?.();
        await new Promise((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()));
        await server.close();
      },
    };
  } catch (error) {
    if (httpServer && httpServer.listening) {
      httpServer.closeAllConnections?.();
      await new Promise((resolve) => httpServer.close(resolve));
    }
    if (server && !closed) {
      closed = true;
      await server.close().catch(() => {});
    }
    throw error;
  }
}
