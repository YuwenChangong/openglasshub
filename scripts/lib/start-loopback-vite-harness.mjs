import { createServer as createViteServer } from "vite";
import { createServer as createHttpServer } from "node:http";

const LOOPBACK_HOST = "127.0.0.1";

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

export async function startLoopbackViteHarness({ root, configFile, cacheDir, createServer = createViteServer } = {}) {
  if (typeof root !== "string" || !root || typeof configFile !== "string" || !configFile) fail("LOOPBACK_VITE_HARNESS_INPUT_INVALID");
  let server;
  let httpServer;
  let closed = false;
  try {
    server = await createServer({
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
