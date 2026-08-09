import assert from "node:assert/strict";
import { allocateTaskOwnedLoopbackPort, applyTaskOwnedDatabasePort, taskPortMap } from "./lib/task-scoped-normalized-replay-port-isolation.mjs";

const source = `[api]\nport = 54321\n\n[db]\nport = 54322\nshadow_port = 54320\n\n[studio]\nport = 54323\n`;
const allocation = await allocateTaskOwnedLoopbackPort();
const updated = applyTaskOwnedDatabasePort(source, allocation.port);
assert.match(updated, new RegExp(`\\[db\\]\\nport = ${allocation.port}\\nshadow_port = 54320`));
assert.match(updated, /\[api\]\nport = 54321/);
assert.match(updated, /\[studio\]\nport = 54323/);
assert.throws(() => applyTaskOwnedDatabasePort(source, 54322), /NORMALIZED_REPLAY_TASK_PORT_ALLOCATION_INVALID/);
assert.deepEqual(taskPortMap(allocation), { postgres: { host: "127.0.0.1", hostPort: allocation.port, containerPort: 5432 } });
process.stdout.write("R6_NORMALIZED_REPLAY_TASK_PORT_ISOLATION_UNIT_READY\n");
