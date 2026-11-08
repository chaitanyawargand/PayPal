import { loadPeerMarketConfigFromEnv } from "./config.js";
import { createPeerMarketServer } from "./server.js";
const config=loadPeerMarketConfigFromEnv();const server=createPeerMarketServer(config);
server.listen(config.port,"127.0.0.1",()=>{const address=server.address();const port=address&&typeof address!=="string"?address.port:config.port;console.log(`PeerMarket listening at http://127.0.0.1:${port}`);});
