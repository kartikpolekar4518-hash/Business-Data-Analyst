// Deterministic generator for a realistic retail sales dataset.
// Seeded PRNG so every run produces identical data (stable demos/tests).

export interface RetailRow {
  order_id: string;
  order_date: string;
  customer_id: string;
  customer_name: string;
  product_id: string;
  product_name: string;
  category: string;
  region: string;
  state: string;
  quantity: number;
  unit_price: number;
  revenue: number;
  cost: number;
  profit: number;
  inventory: number;
}

function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const REGIONS: Record<string, string[]> = {
  West: ["California", "Oregon", "Washington", "Nevada"],
  East: ["New York", "Massachusetts", "Florida", "Georgia"],
  Central: ["Texas", "Illinois", "Ohio", "Michigan"],
  South: ["Arizona", "Tennessee", "Louisiana", "Alabama"],
};
const PRODUCTS: { name: string; category: string; price: number; margin: number }[] = [
  { name: "Aero Laptop 14", category: "Electronics", price: 1200, margin: 0.28 },
  { name: "Aero Laptop 16", category: "Electronics", price: 1600, margin: 0.26 },
  { name: "Nimbus Phone X", category: "Electronics", price: 900, margin: 0.32 },
  { name: "Pulse Earbuds", category: "Electronics", price: 150, margin: 0.45 },
  { name: "Vista Monitor 27", category: "Electronics", price: 320, margin: 0.35 },
  { name: "Ergo Office Chair", category: "Furniture", price: 280, margin: 0.4 },
  { name: "Standing Desk", category: "Furniture", price: 520, margin: 0.38 },
  { name: "Bookshelf Oak", category: "Furniture", price: 190, margin: 0.5 },
  { name: "Cotton T-Shirt", category: "Apparel", price: 25, margin: 0.6 },
  { name: "Denim Jeans", category: "Apparel", price: 60, margin: 0.55 },
  { name: "Running Shoes", category: "Apparel", price: 110, margin: 0.5 },
  { name: "Ceramic Mug Set", category: "Home", price: 35, margin: 0.58 },
  { name: "Cast Iron Pan", category: "Home", price: 70, margin: 0.52 },
  { name: "LED Desk Lamp", category: "Home", price: 45, margin: 0.48 },
];
const FIRST = ["Ava", "Liam", "Noah", "Emma", "Olivia", "Ethan", "Mia", "Lucas", "Sophia", "Mason", "Isla", "Leo", "Zoe", "Kai"];
const LAST = ["Reyes", "Kim", "Patel", "Nguyen", "Garcia", "Cohen", "Silva", "Okafor", "Brooks", "Tanaka", "Rossi", "Haddad"];

export function generateRetailData(): RetailRow[] {
  const rand = mulberry32(42);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
  const regionNames = Object.keys(REGIONS);

  // Fixed customer pool for repeat-customer analytics.
  const customers = Array.from({ length: 60 }, (_, i) => ({
    id: `C${String(1000 + i)}`,
    name: `${pick(FIRST)} ${pick(LAST)}`,
  }));

  const rows: RetailRow[] = [];
  const start = new Date("2024-01-01");
  const months = 18;
  let orderNo = 5000;

  for (let m = 0; m < months; m++) {
    // Upward trend with a seasonal wobble and a deliberate dip around month 12
    // so forecasts/alerts/insights have real signal to find.
    const trend = 1 + m * 0.03;
    const season = 1 + 0.15 * Math.sin((m / 12) * Math.PI * 2);
    const dip = m === 12 ? 0.8 : 1;
    const ordersThisMonth = Math.round((70 + rand() * 30) * trend * season * dip);

    for (let o = 0; o < ordersThisMonth; o++) {
      const day = 1 + Math.floor(rand() * 27);
      const date = new Date(start.getFullYear(), start.getMonth() + m, day);
      const product = pick(PRODUCTS);
      const region = pick(regionNames);
      const state = pick(REGIONS[region]);
      const customer = pick(customers);
      const quantity = 1 + Math.floor(rand() * 4);
      const unit_price = Math.round(product.price * (0.95 + rand() * 0.1) * 100) / 100;
      const revenue = Math.round(unit_price * quantity * 100) / 100;
      const cost = Math.round(revenue * (1 - product.margin) * 100) / 100;
      const profit = Math.round((revenue - cost) * 100) / 100;
      const inventory = Math.floor(rand() * 120);

      rows.push({
        order_id: `ORD-${orderNo++}`,
        order_date: date.toISOString().slice(0, 10),
        customer_id: customer.id,
        customer_name: customer.name,
        product_id: `P${PRODUCTS.indexOf(product) + 100}`,
        product_name: product.name,
        category: product.category,
        region, state,
        quantity, unit_price, revenue, cost, profit, inventory,
      });
    }
  }
  return rows;
}

export function toCsv(rows: RetailRow[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const r of rows) lines.push(headers.map((h) => String((r as any)[h])).join(","));
  return lines.join("\n");
}
