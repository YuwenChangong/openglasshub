import net from "node:net";

const DEFAULT_DATABASE_PORT = 54322;

export async function allocateTaskOwnedLoopbackPort() {
  const server = net.createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string" || !Number.isInteger(address.port) || address.port < 1024 || address.port > 65535 || address.port === DEFAULT_DATABASE_PORT) {
      throw new Error("NORMALIZED_REPLAY_TASK_PORT_ALLOCATION_INVALID");
    }
    return Object.freeze({ host: "127.0.0.1", port: address.port });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())).catch((error) => {
      if (error?.code !== "ERR_SERVER_NOT_RUNNING") throw error;
    });
  }
}

export function applyTaskOwnedDatabasePort(config, port) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === DEFAULT_DATABASE_PORT) throw new Error("NORMALIZED_REPLAY_TASK_PORT_ALLOCATION_INVALID");
  const start = config.indexOf("[db]");
  if (start < 0) throw new Error("NORMALIZED_REPLAY_TASK_DATABASE_PORT_CONFIG_MISSING");
  const nextSection = config.indexOf("\n[", start + 1);
  const sectionEnd = nextSection < 0 ? config.length : nextSection;
  const section = config.slice(start, sectionEnd);
  if (!/^port\s*=\s*\d+\s*$/m.test(section)) throw new Error("NORMALIZED_REPLAY_TASK_DATABASE_PORT_CONFIG_MISSING");
  return `${config.slice(0, start)}${section.replace(/^port\s*=\s*\d+\s*$/m, `port = ${port}`)}${config.slice(sectionEnd)}`;
}

export function taskPortMap({ host, port }) {
  if (host !== "127.0.0.1" || !Number.isInteger(port) || port === DEFAULT_DATABASE_PORT) throw new Error("NORMALIZED_REPLAY_TASK_PORT_MAP_INVALID");
  return Object.freeze({ postgres: Object.freeze({ host, hostPort: port, containerPort: 5432 }) });
}
