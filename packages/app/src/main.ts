import "dotenv/config";
import { pathToFileURL } from "node:url";
import { createAppServer } from "./server.js";

async function main(): Promise<void> {
  if (process.env.RUN_PAYPAL_LIVE === "1") {
    throw new Error("Refusing to start: RUN_PAYPAL_LIVE=1 is not allowed for the Phase 7 app");
  }

  const port = Number(process.env.APP_PORT ?? (process.env.PORT && process.env.PORT !== "5000" ? process.env.PORT : "8787"));
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${process.env.PORT}`);
  }

  const app = await createAppServer({ port });

  console.log(`\n======================================================`);
  console.log(` Recourse Control Center listening on http://127.0.0.1:${app.port}`);
  console.log(` Pre-Payment Firewall for Autonomous AI Shopping Agents`);
  console.log(` Mode: Mock PSP | Real Engine + Tightening Judge active`);
  console.log(` Open http://127.0.0.1:${app.port}/ in your browser.`);
  console.log(`======================================================\n`);

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("Shutting down Recourse Control Center...");
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
    console.error("Failed to start Recourse app server:", error);
    process.exitCode = 1;
  });
}
