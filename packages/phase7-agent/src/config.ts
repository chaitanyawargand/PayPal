export const MERCHANTS = Object.freeze({
  novamart: { baseUrl: "http://127.0.0.1:8801", displayName: "NovaMart Official" },
  dealdemon: { baseUrl: "http://127.0.0.1:8802", displayName: "DealDemon" },
  peermarket: { baseUrl: "http://127.0.0.1:8803", displayName: "PeerMarket" },
});
export type MerchantId = keyof typeof MERCHANTS;
export const MERCHANT_IDS = Object.freeze(Object.keys(MERCHANTS) as MerchantId[]);
