import { createNovaMartServer } from "./server.js";
import { loadNovaMartConfigFromEnv } from "./config.js";

const config = loadNovaMartConfigFromEnv();
const server = createNovaMartServer(config);
server.listen(config.port, "127.0.0.1", () => {
  const address = server.address();
  const port = address && typeof address !== "string" ? address.port : config.port;
  console.log(`NovaMart listening at http://127.0.0.1:${port}`);
});
