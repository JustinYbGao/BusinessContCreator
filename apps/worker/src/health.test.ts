import { afterEach, describe, expect, it } from "vitest";
import { createReadinessState, startHealthServer, type ReadinessState } from "./health.js";

const servers: Array<{ close(callback?: (error?: Error) => void): void }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function request(port: number) {
  return fetch(`http://127.0.0.1:${port}/health/ready`);
}

describe("worker readiness endpoint", () => {
  it("reports 503 until configuration, Supabase, and polling are ready", async () => {
    const state: ReadinessState = createReadinessState();
    const server = await startHealthServer({ port: 0, state });
    servers.push(server);
    const port = (server.address() as { port: number }).port;

    const notReady = await request(port);
    expect(notReady.status).toBe(503);
    expect(await notReady.json()).toEqual({ ready: false });

    state.configParsed = true;
    state.supabaseReachable = true;
    state.pollingStarted = true;
    const ready = await request(port);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ ready: true });
  });

  it("does not expose arbitrary routes, secrets, or job payloads", async () => {
    const server = await startHealthServer({
      port: 0,
      state: { configParsed: true, supabaseReachable: true, pollingStarted: true },
    });
    servers.push(server);
    const port = (server.address() as { port: number }).port;

    const response = await fetch(`http://127.0.0.1:${port}/health/other`);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });
});
