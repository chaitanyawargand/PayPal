import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import * as nodePath from "node:path";
import { pathToFileURL } from "node:url";

import { createApp } from "./index.js";
import type { SigningKeyPair } from "../../ledger/src/sign.js";

function signingKeyPairFromEnv(): SigningKeyPair | undefined {
  const publicKeyPem = process.env.RECOURSE_SIGNING_PUBLIC_KEY_PEM?.replace(/\\n/g, "\n");
  const privateKeyPem = process.env.RECOURSE_SIGNING_PRIVATE_KEY_PEM?.replace(/\\n/g, "\n");

  if (!publicKeyPem && !privateKeyPem) return undefined;
  if (!publicKeyPem || !privateKeyPem) {
    throw new Error(
      "RECOURSE_SIGNING_PUBLIC_KEY_PEM and RECOURSE_SIGNING_PRIVATE_KEY_PEM must be set together",
    );
  }
  return { publicKeyPem, privateKeyPem };
}

async function main(): Promise<void> {
  if (process.env.RUN_PAYPAL_LIVE === "1") {
    throw new Error("Refusing to start: RUN_PAYPAL_LIVE=1 is not allowed for the Phase 6 app");
  }

  const pspMode = (process.env.RECOURSE_PSP ?? "mock").toLowerCase();
  if (!["mock", "mockpsp", "mock_psp"].includes(pspMode)) {
    throw new Error(`Refusing to start: unsupported RECOURSE_PSP "${pspMode}" (Phase 6 app is MockPsp-only)`);
  }

  const port = Number(process.env.PORT ?? "8787");
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${process.env.PORT}`);
  }

  const host = process.env.HOST ?? "127.0.0.1";
  const dbPath = nodePath.resolve(process.env.RECOURSE_DB_PATH ?? "recourse-demo.db");

  mkdirSync(nodePath.dirname(dbPath), { recursive: true });

  const app = createApp({
    dbPath,
    signingKeyPair: signingKeyPairFromEnv(),
  });

  await new Promise<void>((resolve, reject) => {
    app.server.once("error", reject);
    app.server.listen(port, host, () => {
      app.server.off("error", reject);
      resolve();
    });
  });

  const fingerprint = createHash("sha256")
    .update(app.publicKeyPem, "utf8")
    .digest("hex");

  console.log(`Recourse app listening on http://${host}:${port}`);
  console.log("MOCK/SANDBOX - NO REAL MONEY");
  console.log("PSP: MockPsp (tier C)");
  console.log("Judge: DISCONNECTED");
  console.log(`DB: ${dbPath}`);
  console.log(`Signing public key SHA-256: ${fingerprint}`);

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await app.close().catch(() => undefined);
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
