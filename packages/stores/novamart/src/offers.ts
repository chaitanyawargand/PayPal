import {
  CANONICAL_PRODUCTS,
  type StoreOffer,
} from "../../store-core/src/index.js";

const prices: Record<string, number> = {
  "JKT-001": 18900,
  "JKT-002": 8900,
  "JKT-003": 24900,
  "JKT-004": 13900,
  "JKT-005": 11900,
  "HDP-001": 5800,
  "HDP-002": 4900,
  "HDP-003": 12900,
  "HDP-004": 9900,
  "HDP-005": 3900,
  "RUN-001": 12900,
  "RUN-002": 9800,
  "RUN-003": 11500,
  "RUN-004": 10500,
  "RUN-005": 14900,
  "BPK-001": 7900,
  "BPK-002": 13900,
  "BPK-003": 6900,
  "BPK-004": 11900,
  "BPK-005": 4500,
};

export const NOVAMART_OFFERS: readonly StoreOffer[] = Object.freeze(
  CANONICAL_PRODUCTS.map((product, index) => ({
    sku: product.sku,
    merchantId: "novamart",
    unitPriceCents: prices[product.sku]!,
    rating: 4.3 + (index % 7) / 10,
    reviewCount: 18 + index * 13,
    stock: 8 + (index % 11),
    condition: "NEW" as const,
    seller: {
      id: "NOVAMART_OFFICIAL",
      name: "NovaMart Official",
      verified: true,
    },
    warrantyLabel:
      product.category === "HEADPHONES"
        ? "1-year manufacturer warranty"
        : product.category === "RUNNING_SHOES"
          ? "90-day workmanship warranty"
          : "1-year limited warranty",
    returnsDays: 30,
    finalSale: false,
    shipsFrom: "Columbus, Ohio",
    deliveryEstimateLabel: "Ships in 1–2 business days",
  })),
);

export function getOfferBySku(sku: string): StoreOffer | undefined {
  return NOVAMART_OFFERS.find(
    (offer) => offer.sku.toLowerCase() === sku.toLowerCase(),
  );
}
