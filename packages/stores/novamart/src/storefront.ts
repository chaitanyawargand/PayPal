import {
  CANONICAL_PRODUCTS,
  InMemoryCartStore,
  StoreCoreError,
  buildQuote,
  calculatePricing,
  searchCatalog,
  type DeliveryMethod,
  type SignedStoreQuote,
  type StoreCoreErrorCode,
  type VariantSelection,
  type PlantedListingAttack,
  applyPlantedListingAttack,
} from "../../store-core/src/index.js";
import { getOfferBySku, NOVAMART_OFFERS } from "./offers.js";
import { NOVAMART_PRICING_POLICY } from "./pricing-policy.js";
import { getReviewsForSku } from "./reviews.js";
import { getContentBlocks } from "./content-blocks.js";

export const MERCHANT_ID = "novamart";
export const MERCHANT_NAME = "NovaMart Official";
function findProduct(sku: string) {
  return CANONICAL_PRODUCTS.find(
    (item) => item.sku.toLowerCase() === sku.toLowerCase(),
  );
}
export type QuoteSigning = "configured" | "ephemeral-dev";
export class NovaMartServiceError extends Error {
  constructor(
    readonly code: StoreCoreErrorCode | "EMPTY_CART",
    message: string,
  ) {
    super(message);
    this.name = "NovaMartServiceError";
  }
}
export type Handoff = {
  status: "READY_FOR_RECOURSE";
  merchantId: "novamart";
  quote: SignedStoreQuote;
  payment: {
    provider: "PAYPAL";
    environment: "sandbox";
    merchantProfileId: "novamart";
    merchantDisplayName: "Recourse NovaMart Merchant";
    flow: "RECOURSE_GATEWAY_THEN_PAYPAL_HOSTED_APPROVAL";
    orderCreated: false;
    approvalCreated: false;
    captureCreated: false;
  };
};
export class NovaMartStorefront {
  private readonly carts = new InMemoryCartStore();
  private readonly issuedQuotes = new Map<string, SignedStoreQuote>();
  private plantedAttack: PlantedListingAttack | null = null;
  constructor(
    private readonly quoteSecret: string,
    readonly quoteSigning: QuoteSigning = "configured",
  ) {}

  search(input: {
    query?: string;
    category?: string;
    brand?: string;
    feature?: string;
    maxUnitPriceCents?: number;
    sort?: "relevance" | "price_asc" | "price_desc" | "rating";
  }) {
    return searchCatalog({
      offers: NOVAMART_OFFERS,
      query: input.query,
      category: input.category as never,
      brand: input.brand,
      feature: input.feature,
      maxUnitPriceCents: input.maxUnitPriceCents,
      sort: input.sort,
    }).map((result) => ({
      ...result,
      estimatedTotalForOneCents: calculatePricing({
        lines: [{ product: result.product, offer: result.offer, quantity: 1 }],
        deliveryMethod: "STANDARD",
        policy: NOVAMART_PRICING_POLICY,
      }).computedTotalCents,
    }));
  }
  productDetail(sku: string) {
    const product = findProduct(sku);
    if (!product) return null;
    const offer = getOfferBySku(product.sku)!;
    const { subscription, giftCard, ...publicOffer } = offer;
    return applyPlantedListingAttack({
      ...product,
      offer: publicOffer,
      advertisedTerms: {
        condition: offer.condition,
        returnsDays: offer.returnsDays,
        finalSale: offer.finalSale,
        subscription,
        giftCard,
        warrantyLabel: offer.warrantyLabel,
      },
      variants: product.variantOptions,
      seller: offer.seller,
      shipping: {
        shipsFrom: offer.shipsFrom,
        deliveryEstimateLabel: offer.deliveryEstimateLabel,
      },
      returnsDays: offer.returnsDays,
      warrantyLabel: offer.warrantyLabel,
      reviews: getReviewsForSku(product.sku),
      contentBlocks: getContentBlocks(product),
      hiddenContent: [] as [],
    }, MERCHANT_ID, this.plantedAttack);
  }
  plantAttack(attack: PlantedListingAttack) { this.plantedAttack = structuredClone(attack); }
  clearAttack() { this.plantedAttack = null; }
  getCart(cartId?: string) {
    return this.carts.getOrCreateCart(cartId);
  }
  addCartItem(
    cartId: string,
    sku: string,
    quantity: number,
    variant?: VariantSelection,
  ) {
    const product = findProduct(sku);
    const offer = product && getOfferBySku(product.sku);
    if (!product || !offer)
      throw new NovaMartServiceError(
        "PRODUCT_NOT_FOUND",
        `Product not found: ${sku}`,
      );
    return this.carts.addItem(cartId, product, offer, quantity, variant);
  }
  setCartQuantity(cartId: string, lineId: string, quantity: number) {
    return this.carts.setLineQuantity(cartId, lineId, quantity);
  }
  removeCartLine(cartId: string, lineId: string) {
    return this.carts.removeLine(cartId, lineId);
  }
  clearCart(cartId: string) {
    return this.carts.clearCart(cartId);
  }
  cartView(cartId: string, deliveryMethod: DeliveryMethod = "STANDARD") {
    const cart = this.carts.requireCart(cartId);
    const lines = cart.lines.map((line) => {
      const product = findProduct(line.sku)!;
      const offer = getOfferBySku(line.sku)!;
      return { ...line, name: product.name, slug: product.slug, offer };
    });
    const pricing = cart.lines.length
      ? calculatePricing({
          lines: cart.lines.map((line) => ({
            product: findProduct(line.sku)!,
            offer: getOfferBySku(line.sku)!,
            quantity: line.quantity,
            variant: line.variant,
          })),
          deliveryMethod,
          policy: NOVAMART_PRICING_POLICY,
        })
      : {
          merchandiseSubtotalCents: 0,
          extraChargesCents: 0,
          shippingCents: 0,
          taxCents: 0,
          computedTotalCents: 0,
          lineItems: [],
        };
    return {
      merchantId: MERCHANT_ID,
      cart: { ...cart, lines },
      pricing,
      deliveryMethod,
    };
  }
  createQuote(
    cartId: string,
    deliveryMethod: DeliveryMethod = "STANDARD",
  ): SignedStoreQuote {
    const cart = this.carts.requireCart(cartId);
    if (!cart.lines.length)
      throw new NovaMartServiceError(
        "EMPTY_CART",
        "Add an item before requesting a quote",
      );
    const products = cart.lines.map((line) => ({
      line,
      product: findProduct(line.sku)!,
      offer: getOfferBySku(line.sku)!,
    }));
    const pricing = calculatePricing({
      lines: products.map(({ line, product, offer }) => ({
        product,
        offer,
        quantity: line.quantity,
        variant: line.variant,
      })),
      deliveryMethod,
      policy: NOVAMART_PRICING_POLICY,
    });
    const firstOffer = products[0]!.offer;
    const quote = buildQuote(
      {
        merchantId: MERCHANT_ID,
        merchantName: MERCHANT_NAME,
        cartId,
        items: products.map(({ line, product, offer }) => ({
          sku: product.sku,
          name: product.name,
          quantity: line.quantity,
          unitAmountCents: offer.unitPriceCents,
          amountCents: line.amountCents,
          variant: line.variant,
        })),
        pricing,
        seller: firstOffer.seller,
        terms: {
          condition: "NEW",
          returnsDays: 30,
          finalSale: false,
          subscription: products.some(({ offer }) => offer.subscription),
          giftCard: products.some(({ offer }) => offer.giftCard),
          warrantyLabel: firstOffer.warrantyLabel,
        },
      },
      this.quoteSecret,
    );
    this.issuedQuotes.set(quote.quoteId, structuredClone(quote));
    return structuredClone(quote);
  }
  createHandoff(
    cartId: string,
    deliveryMethod: DeliveryMethod = "STANDARD",
  ): Handoff {
    return {
      status: "READY_FOR_RECOURSE",
      merchantId: MERCHANT_ID,
      quote: this.createQuote(cartId, deliveryMethod),
      payment: {
        provider: "PAYPAL",
        environment: "sandbox",
        merchantProfileId: "novamart",
        merchantDisplayName: "Recourse NovaMart Merchant",
        flow: "RECOURSE_GATEWAY_THEN_PAYPAL_HOSTED_APPROVAL",
        orderCreated: false,
        approvalCreated: false,
        captureCreated: false,
      },
    };
  }
  getIssuedQuote(quoteId: string): SignedStoreQuote | null {
    const quote = this.issuedQuotes.get(quoteId);
    return quote ? structuredClone(quote) : null;
  }
}

export function isStoreCoreError(error: unknown): error is StoreCoreError {
  return error instanceof StoreCoreError;
}
