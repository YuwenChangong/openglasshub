import { createServer as createHttpServer } from "node:http";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const LOOPBACK_HOST = "127.0.0.1";

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

async function resolveViteCreateServer() {
  const explicitEntry = process.env.OPENGLASS_VITE_MODULE_ENTRY;
  if (explicitEntry) {
    await access(explicitEntry).catch(() => fail("LOOPBACK_VITE_HARNESS_EXTERNAL_VITE_ENTRY_INVALID"));
    return (await import(pathToFileURL(explicitEntry).href)).createServer;
  }
  const require = createRequire(import.meta.url);
  return (await import(pathToFileURL(require.resolve("vite")).href)).createServer;
}

export async function startLoopbackViteHarness({ root, configFile, cacheDir, createServer } = {}) {
  if (typeof root !== "string" || !root || typeof configFile !== "string" || !configFile) fail("LOOPBACK_VITE_HARNESS_INPUT_INVALID");
  let server;
  let httpServer;
  let closed = false;
  try {
    const create = createServer ?? await resolveViteCreateServer();
    server = await create({
      root,
      configFile,
      ...(typeof cacheDir === "string" && cacheDir ? { cacheDir } : {}),
      server: { middlewareMode: true, host: LOOPBACK_HOST },
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
