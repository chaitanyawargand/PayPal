import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as nodePath from "node:path";
import type { AddressInfo } from "node:net";

import { createApp, type RecourseApp } from "../src/index.js";

const apps: RecourseApp[] = [];
const tempDirs: string[] = [];

async function makeApp() {
  const dir = await mkdtemp(nodePath.join(tmpdir(), "recourse-ui-"));
  tempDirs.push(dir);
  const app = createApp({ dbPath: nodePath.join(dir, "app.test.db") });
  apps.push(app);
  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const { port } = app.server.address() as AddressInfo;
  return { app, baseUrl: `http://127.0.0.1:${port}` };
}

afterEach(async () => {
  while (apps.length) await apps.pop()!.close().catch(() => undefined);
  while (tempDirs.length) {
    await rm(tempDirs.pop()!, { recursive: true, force: true }).catch(() => undefined);
  }
});

describe("Recourse UI", () => {
  it("serves the Mock-labelled UI shell at GET /", async () => {
    const { baseUrl } = await makeApp();

    const res = await fetch(`${baseUrl}/`);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(body).toContain("Recourse");
    expect(body).toContain("MOCK/SANDBOX - NO REAL MONEY");
    expect(body).toContain('id="refresh-status"');
    expect(body).toContain('id="status-mode"');
    expect(body).toContain('id="status-psp"');
    expect(body).toContain('id="status-judge"');
    expect(body).toContain('id="status-receipt-count"');
    expect(body).toContain('id="status-chain-verified"');
    expect(body).toContain('id="signing-public-key"');
    expect(body).toContain("/v1/app/status");
    expect(body).not.toContain("BEGIN PRIVATE KEY");
  });

  it("keeps API routes working alongside the UI", async () => {
    const { baseUrl } = await makeApp();

    const health = await fetch(`${baseUrl}/health`);
    expect(health.status).toBe(200);

    const status = await fetch(`${baseUrl}/v1/app/status`);
    expect(status.status).toBe(200);
  });
});
