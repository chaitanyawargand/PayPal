import type { CanonicalProduct, ProductCategory } from "./types.js";
const jacket = (sku:string,brand:string,name:string,fact:string):CanonicalProduct => product(sku,brand,name,"JACKETS",fact,["M","L","S","XL"], ["Black","Navy","Olive"]);
const headphone = (sku:string,brand:string,name:string,fact:string):CanonicalProduct => product(sku,brand,name,"HEADPHONES",fact,[],["Black","White","Blue"]);
const shoe = (sku:string,brand:string,name:string,fact:string):CanonicalProduct => product(sku,brand,name,"RUNNING_SHOES",fact,["US 10","US 7","US 8","US 9","US 11","US 12","US 13"],["Black","Blue","Grey"]);
const backpack = (sku:string,brand:string,name:string,fact:string):CanonicalProduct => product(sku,brand,name,"BACKPACKS",fact,[],["Black","Navy","Green"]);
function product(sku:string,brand:string,name:string,category:ProductCategory,fact:string,sizes:string[],colours:string[]):CanonicalProduct {
 const variantOptions = [...(sizes.length ? [{id:"size",label:"Size",values:sizes}] : []),{id:"colour",label:"Colour",values:colours}];
 const defaultVariant = Object.fromEntries(variantOptions.map(o=>[o.id,o.id==="size"?(category==="RUNNING_SHOES"?"US 10":"M"):colours[0]]));
 const anchor = `${fact}.`;
 return {sku,slug:sku.toLowerCase(),name,brand,category,shortDescription:`${name} by ${brand}, designed for dependable everyday use.`,longDescription:`${name} combines practical materials with thoughtful details for regular use. ${anchor} Choose a listed variant to match your needs.`,features:[fact,"Designed for repeated everyday use","Comfortable, practical construction","Thoughtful details for changing conditions"],specifications:{Brand:brand,Category:category,Model:sku,Use:"Everyday and outdoor use",Materials:"Product-specific technical materials"},variantOptions,defaultVariant,visual:{icon:category==="HEADPHONES"?"headphones":category==="BACKPACKS"?"backpack":category==="RUNNING_SHOES"?"shoe":"jacket",palette:["#263746","#71828b"],motif:"contour-lines"},searchTerms:[name,brand,sku,category.toLowerCase().replaceAll("_"," "),...fact.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)]};
}
export const CANONICAL_PRODUCTS: readonly CanonicalProduct[] = Object.freeze([
 jacket("JKT-001","NorthPeak","StormShell Pro Waterproof Jacket","20000mm waterproof rating, fully taped seams, and pit zips"),
 jacket("JKT-002","TrailMist","Packable Rain Jacket","10000mm rating, 280g weight, packs into its own pocket"),
 jacket("JKT-003","AlpineGuard","Expedition Insulated Parka","Rated to -20°C with six pockets"),
 jacket("JKT-004","UrbanDry","Commuter Waterproof Jacket","Reflective trim and PFC-free DWR finish"),
 jacket("JKT-005","SummitFlex","Trail Softshell Jacket","Water-resistant shell, fleece lining, and four-way stretch"),
 headphone("HDP-001","AuraSound","X200 Wireless Noise-Cancelling Headphones","Active noise cancellation, 42-hour battery, Bluetooth 5.3, and multipoint"),
 headphone("HDP-002","SonicPulse","Buds Air Wireless Earbuds","30 hours with case and call noise reduction"),
 headphone("HDP-003","BassForge","Studio Max Over-Ear Headphones","40mm drivers, 60-hour battery, and wired mode"),
 headphone("HDP-004","ClearTone","Travel Pro Noise-Cancelling Headphones","Active noise cancellation, folds flat, 38-hour battery, and travel case"),
 headphone("HDP-005","PulseFit","Sport Wireless Earbuds","IPX5 rating, ear hooks, and 28 hours with case"),
 shoe("RUN-001","StrideFlow","Trail GTX Waterproof Running Shoes","Waterproof membrane and 5mm traction lugs"),
 shoe("RUN-002","AeroGlide","Daily Trainer Running Shoes","Neutral cushioning and engineered mesh upper"),
 shoe("RUN-003","TerraGrip","Ridge Runner Trail Shoes","Protective rock plate and aggressive traction"),
 shoe("RUN-004","CloudStep","Recovery Max-Cushion Running Shoes","Maximum cushioning and a stable wide base"),
 shoe("RUN-005","SprintForm","Race Day Carbon-Plated Shoes","Carbon plate and lightweight race foam"),
 backpack("BPK-001","TrekVault","25L Everyday Laptop Backpack","Padded 16-inch laptop sleeve and luggage strap"),
 backpack("BPK-002","SummitHaul","45L Travel Backpack","Carry-on size, hip belt, and shoe compartment"),
 backpack("BPK-003","MetroGuard","18L Anti-Theft Commuter Backpack","Lockable zips and RFID pocket"),
 backpack("BPK-004","RainTrek","32L Waterproof Roll-Top Backpack","Welded seams and roll-top closure"),
 backpack("BPK-005","LiteCarry","12L Compact Commuter Backpack","14-inch laptop sleeve and recycled fabric"),
]);
export function getProductBySku(sku:string):CanonicalProduct|undefined{return CANONICAL_PRODUCTS.find(p=>p.sku===sku)}
export function getProductBySlug(slug:string):CanonicalProduct|undefined{return CANONICAL_PRODUCTS.find(p=>p.slug===slug)}
export function listProductsByCategory(category:ProductCategory):CanonicalProduct[]{return CANONICAL_PRODUCTS.filter(p=>p.category===category)}
