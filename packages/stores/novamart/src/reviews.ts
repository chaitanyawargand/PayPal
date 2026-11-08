import {
  CANONICAL_PRODUCTS,
  type ProductReview,
} from "../../store-core/src/index.js";

const snippets = [
  [
    "A reliable pick",
    "The details match the description and it has been comfortable for regular use.",
  ],
  [
    "Thoughtful design",
    "The materials feel considered, and the practical features have been useful so far.",
  ],
  [
    "Good for daily use",
    "It does what I need. I would have liked a little more room, but the build feels solid.",
  ],
  [
    "Nicely made",
    "The fit took a day to get used to, and the construction has held up well.",
  ],
];

export function getReviewsForSku(sku: string): ProductReview[] {
  const product = CANONICAL_PRODUCTS.find(
    (item) => item.sku.toLowerCase() === sku.toLowerCase(),
  );
  if (!product) return [];
  return snippets
    .slice(0, product.sku.endsWith("1") ? 4 : 3)
    .map(([title, body], index) => ({
      id: `NOVAMART-${product.sku}-R${index + 1}`,
      author: ["Morgan R.", "Jamie L.", "Taylor K.", "Casey D."][index]!,
      rating: [5, 4, 5, 4][index]!,
      date: `2025-0${(index % 8) + 1}-15`,
      title: `${title}: ${product.name}`,
      body: `${body} On the ${product.name}, I especially noticed ${product.features[index % product.features.length]}; ${product.features[(index + 1) % product.features.length]}.`,
      verifiedPurchase: true,
      helpfulCount: index * 3 + 1,
      ...(product.variantOptions.length
        ? { variantLabel: Object.values(product.defaultVariant).join(" / ") }
        : {}),
    }));
}
