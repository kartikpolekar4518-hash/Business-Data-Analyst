// Deterministic generators for multi-industry sample datasets.
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

// Products a real shop sees bought together. Without this, every additional line item
// would be drawn uniformly and every product pair would sit at lift ~1 — no association
// at all, which is not what a retail dataset looks like and demonstrates nothing.
const AFFINITY: Record<string, string[]> = {
  "Aero Laptop 14": ["Vista Monitor 27", "Ergo Office Chair"],
  "Aero Laptop 16": ["Vista Monitor 27", "Ergo Office Chair"],
  "Nimbus Phone X": ["Pulse Earbuds"],
  "Standing Desk": ["Ergo Office Chair", "LED Desk Lamp"],
  "Cotton T-Shirt": ["Denim Jeans"],
  "Cast Iron Pan": ["Ceramic Mug Set"],
};
const AFFINITY_RATE = 0.7; // how often an extra line takes an affinity partner

export function generateRetailData(): RetailRow[] {
  const rand = mulberry32(42);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
  const regionNames = Object.keys(REGIONS);

  const customers = Array.from({ length: 60 }, (_, i) => ({
    id: `C${String(1000 + i)}`,
    name: `${pick(FIRST)} ${pick(LAST)}`,
  }));

  const rows: RetailRow[] = [];
  const start = new Date("2024-01-01");
  const months = 18;
  let orderNo = 5000;

  for (let m = 0; m < months; m++) {
    const trend = 1 + m * 0.03;
    const season = 1 + 0.15 * Math.sin((m / 12) * Math.PI * 2);
    const dip = m === 12 ? 0.8 : 1;
    const ordersThisMonth = Math.round((70 + rand() * 30) * trend * season * dip);

    for (let o = 0; o < ordersThisMonth; o++) {
      // Order-level: chosen once and repeated on every line of the order. One basket is
      // one customer, one day, one place — re-drawing these per line would make an order
      // that nothing could reason about.
      const day = 1 + Math.floor(rand() * 27);
      const date = new Date(start.getFullYear(), start.getMonth() + m, day);
      const region = pick(regionNames);
      const state = pick(REGIONS[region]);
      const customer = pick(customers);
      const order_id = `ORD-${orderNo++}`;
      const order_date = date.toISOString().slice(0, 10);

      // 1–4 distinct products per order. Distinct because the same product twice in one
      // basket says nothing about what is bought with what.
      const basket = [pick(PRODUCTS)];
      const lines = 1 + Math.floor(rand() * 4);
      for (let l = 1; l < lines; l++) {
        const partners = (AFFINITY[basket[0].name] ?? []).filter((n) => !basket.some((p) => p.name === n));
        // Draw the partner name once — calling pick() inside find()'s predicate would
        // redraw it on every element and consume the seeded sequence unpredictably.
        const partnerName = partners.length > 0 && rand() < AFFINITY_RATE ? pick(partners) : null;
        const next = partnerName ? PRODUCTS.find((p) => p.name === partnerName) : pick(PRODUCTS);
        if (next && !basket.some((p) => p.name === next.name)) basket.push(next);
      }

      for (const product of basket) {
        const quantity = 1 + Math.floor(rand() * 4);
        const unit_price = Math.round(product.price * (0.95 + rand() * 0.1) * 100) / 100;
        const revenue = Math.round(unit_price * quantity * 100) / 100;
        const cost = Math.round(revenue * (1 - product.margin) * 100) / 100;
        const profit = Math.round((revenue - cost) * 100) / 100;
        const inventory = Math.floor(rand() * 120);

        rows.push({
          order_id, order_date,
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
  }
  return rows;
}

// ---------- SaaS sample data ----------
export interface SaasRow {
  subscription_id: string;
  signup_date: string;
  customer_id: string;
  customer_name: string;
  plan: string;
  region: string;
  mrr: number;
  seats: number;
  churned: number;
}

export function generateSaasData(): SaasRow[] {
  const rand = mulberry32(7);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
  const PLANS = ["Starter", "Pro", "Enterprise"];
  const REGIONS = ["North America", "Europe", "APAC", "LATAM"];
  const FIRST = ["Ava", "Liam", "Noah", "Emma", "Olivia", "Ethan", "Mia", "Lucas", "Sophia", "Mason"];
  const LAST = ["Reyes", "Kim", "Patel", "Nguyen", "Garcia", "Cohen", "Silva", "Okafor", "Brooks", "Tanaka"];

  const customers = Array.from({ length: 40 }, (_, i) => ({
    id: `S${String(1000 + i)}`,
    name: `${pick(FIRST)} ${pick(LAST)}`,
  }));

  const rows: SaasRow[] = [];
  const start = new Date("2024-01-01");
  const months = 18;
  let subNo = 9000;

  for (let m = 0; m < months; m++) {
    const trend = 1 + m * 0.04;
    const season = 1 + 0.1 * Math.sin((m / 12) * Math.PI * 2);
    const newSubs = Math.round((12 + rand() * 8) * trend * season);
    for (let s = 0; s < newSubs; s++) {
      const day = 1 + Math.floor(rand() * 27);
      const date = new Date(start.getFullYear(), start.getMonth() + m, day);
      const plan = pick(PLANS);
      const mrr = plan === "Enterprise" ? 2000 + rand() * 3000 : plan === "Pro" ? 500 + rand() * 700 : 50 + rand() * 150;
      rows.push({
        subscription_id: `SUB-${subNo++}`,
        signup_date: date.toISOString().slice(0, 10),
        customer_id: pick(customers).id,
        customer_name: pick(customers).name,
        plan,
        region: pick(REGIONS),
        mrr: Math.round(mrr * 100) / 100,
        seats: 1 + Math.floor(rand() * 20),
        churned: rand() < 0.08 ? 1 : 0,
      });
    }
  }
  return rows;
}

// ---------- Pharmacy sample data ----------
export interface PharmacyRow {
  rx_id: string;
  dispense_date: string;
  patient_id: string;
  drug_name: string;
  category: string;
  region: string;
  quantity: number;
  unit_price: number;
  revenue: number;
  expiry_date: string;
}

export function generatePharmacyData(): PharmacyRow[] {
  const rand = mulberry32(11);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
  const DRUGS = [
    { name: "Atorvastatin 20mg", category: "Cardiovascular", price: 45 },
    { name: "Metformin 500mg", category: "Diabetes", price: 30 },
    { name: "Lisinopril 10mg", category: "Cardiovascular", price: 25 },
    { name: "Amoxicillin 500mg", category: "Antibiotic", price: 18 },
    { name: "Omeprazole 20mg", category: "GI", price: 22 },
    { name: "Levothyroxine 50mcg", category: "Thyroid", price: 28 },
  ];
  const REGIONS = ["North", "South", "East", "West"];

  const rows: PharmacyRow[] = [];
  const start = new Date("2024-01-01");
  const months = 18;
  let rxNo = 2000;

  for (let m = 0; m < months; m++) {
    const trend = 1 + m * 0.02;
    const season = 1 + 0.12 * Math.sin((m / 12) * Math.PI * 2);
    const rxs = Math.round((30 + rand() * 15) * trend * season);
    for (let r = 0; r < rxs; r++) {
      const day = 1 + Math.floor(rand() * 27);
      const date = new Date(start.getFullYear(), start.getMonth() + m, day);
      const drug = pick(DRUGS);
      const qty = 1 + Math.floor(rand() * 3);
      const expiry = new Date(date.getFullYear() + 1, date.getMonth() + Math.floor(rand() * 12), 1);
      rows.push({
        rx_id: `RX-${rxNo++}`,
        dispense_date: date.toISOString().slice(0, 10),
        patient_id: `P${1000 + Math.floor(rand() * 200)}`,
        drug_name: drug.name,
        category: drug.category,
        region: pick(REGIONS),
        quantity: qty,
        unit_price: drug.price,
        revenue: Math.round(drug.price * qty * 100) / 100,
        expiry_date: expiry.toISOString().slice(0, 10),
      });
    }
  }
  return rows;
}

// ---------- Services sample data ----------
export interface ServiceRow {
  engagement_id: string;
  work_date: string;
  client_name: string;
  service_line: string;
  region: string;
  billable_hours: number;
  total_hours: number;
  revenue: number;
}

export function generateServicesData(): ServiceRow[] {
  const rand = mulberry32(19);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
  const CLIENTS = ["Acme Corp", "Globex", "Initech", "Umbrella", "Stark Industries", "Wayne Enterprises"];
  const LINES = ["Strategy", "Implementation", "Support", "Audit"];
  const REGIONS = ["North America", "Europe", "APAC"];

  const rows: ServiceRow[] = [];
  const start = new Date("2024-01-01");
  const months = 18;
  let engNo = 3000;

  for (let m = 0; m < months; m++) {
    const trend = 1 + m * 0.03;
    const season = 1 + 0.1 * Math.sin((m / 12) * Math.PI * 2);
    const engagements = Math.round((15 + rand() * 8) * trend * season);
    for (let e = 0; e < engagements; e++) {
      const day = 1 + Math.floor(rand() * 27);
      const date = new Date(start.getFullYear(), start.getMonth() + m, day);
      const total = 8 + Math.floor(rand() * 8);
      const billable = Math.round(total * (0.6 + rand() * 0.35));
      rows.push({
        engagement_id: `ENG-${engNo++}`,
        work_date: date.toISOString().slice(0, 10),
        client_name: pick(CLIENTS),
        service_line: pick(LINES),
        region: pick(REGIONS),
        billable_hours: billable,
        total_hours: total,
        revenue: Math.round(billable * (120 + rand() * 80) * 100) / 100,
      });
    }
  }
  return rows;
}

export function toCsv(rows: RetailRow[] | SaasRow[] | PharmacyRow[] | ServiceRow[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const r of rows) lines.push(headers.map((h) => String((r as any)[h])).join(","));
  return lines.join("\n");
}