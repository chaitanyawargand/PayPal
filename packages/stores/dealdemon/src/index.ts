import { createDealDemonServer } from "./server.js";
import { loadDealDemonConfigFromEnv } from "./config.js";

const config = loadDealDemonConfigFromEnv();
const server = createDealDemonServer(config);
server.listen(config.port, "127.0.0.1", () => {
  const address = server.address();
  const port = address && typeof address !== "string" ? address.port : config.port;
  console.log(`DealDemon listening at http://127.0.0.1:${port}`);
});
