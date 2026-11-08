import {
  CANONICAL_PRODUCTS,
  type StoreOffer,
} from "../../store-core/src/index.js";

export type AdvertisedAddOnTerms = { subscription: boolean; giftCard: boolean };
type NovaMartListing = { price: number; advertisedAddOns: AdvertisedAddOnTerms };
const listings: Record<string, NovaMartListing> = {
  "JKT-001": { price: 18900, advertisedAddOns: { subscription: false, giftCard: false } },
  "JKT-002": { price: 8900, advertisedAddOns: { subscription: false, giftCard: false } },
  "JKT-003": { price: 24900, advertisedAddOns: { subscription: false, giftCard: false } },
  "JKT-004": { price: 13900, advertisedAddOns: { subscription: false, giftCard: false } },
  "JKT-005": { price: 11900, advertisedAddOns: { subscription: false, giftCard: false } },
  "HDP-001": { price: 5800, advertisedAddOns: { subscription: false, giftCard: false } },
  "HDP-002": { price: 4900, advertisedAddOns: { subscription: false, giftCard: false } },
  "HDP-003": { price: 12900, advertisedAddOns: { subscription: false, giftCard: false } },
  "HDP-004": { price: 9900, advertisedAddOns: { subscription: false, giftCard: false } },
  "HDP-005": { price: 3900, advertisedAddOns: { subscription: false, giftCard: false } },
  "RUN-001": { price: 12900, advertisedAddOns: { subscription: false, giftCard: false } },
  "RUN-002": { price: 9800, advertisedAddOns: { subscription: false, giftCard: false } },
  "RUN-003": { price: 11500, advertisedAddOns: { subscription: false, giftCard: false } },
  "RUN-004": { price: 10500, advertisedAddOns: { subscription: false, giftCard: false } },
  "RUN-005": { price: 14900, advertisedAddOns: { subscription: false, giftCard: false } },
  "BPK-001": { price: 7900, advertisedAddOns: { subscription: false, giftCard: false } },
  "BPK-002": { price: 13900, advertisedAddOns: { subscription: false, giftCard: false } },
  "BPK-003": { price: 6900, advertisedAddOns: { subscription: false, giftCard: false } },
  "BPK-004": { price: 11900, advertisedAddOns: { subscription: false, giftCard: false } },
  "BPK-005": { price: 4500, advertisedAddOns: { subscription: false, giftCard: false } },
};

export type NovaMartOffer = StoreOffer & AdvertisedAddOnTerms;
export const NOVAMART_OFFERS: readonly NovaMartOffer[] = Object.freeze(
  CANONICAL_PRODUCTS.map((product, index) => ({
    sku: product.sku,
    merchantId: "novamart",
    unitPriceCents: listings[product.sku]!.price,
    ...listings[product.sku]!.advertisedAddOns,
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

export function getOfferBySku(sku: string): NovaMartOffer | undefined {
  return NOVAMART_OFFERS.find(
    (offer) => offer.sku.toLowerCase() === sku.toLowerCase(),
  );
}
