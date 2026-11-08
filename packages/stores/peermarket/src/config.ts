import { randomBytes } from "node:crypto";

export type PeerMarketConfig = { port: number; quoteSecret: string; quoteSigning: "configured" | "ephemeral-dev" };
export function loadPeerMarketConfigFromEnv(): PeerMarketConfig {
  const rawPort = process.env.PEERMARKET_PORT;
  const port = rawPort ? Number(rawPort) : 8803;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("PEERMARKET_PORT must be an integer between 0 and 65535");
  const quoteSecret = process.env.PEERMARKET_QUOTE_SECRET;
  if (quoteSecret) return { port, quoteSecret, quoteSigning: "configured" };
  if (process.env.NODE_ENV === "production") throw new Error("PEERMARKET_QUOTE_SECRET is required in production");
  console.warn("PEERMARKET_QUOTE_SECRET is unset; using an ephemeral development quote key.");
  return { port, quoteSecret: randomBytes(32).toString("base64url"), quoteSigning: "ephemeral-dev" };
}
