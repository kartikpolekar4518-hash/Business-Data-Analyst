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

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const r of rows) lines.push(headers.map((h) => String(r[h] ?? "")).join(","));
  return lines.join("\n");
}

// ── Pharmacy demo: prescriptions, medicines, patients, stock. ──
const MEDICINES: { name: string; category: string; price: number; margin: number }[] = [
  { name: "Amoxicillin 500mg", category: "Antibiotic", price: 12, margin: 0.45 },
  { name: "Azithromycin 250mg", category: "Antibiotic", price: 18, margin: 0.42 },
  { name: "Paracetamol 650mg", category: "Analgesic", price: 4, margin: 0.6 },
  { name: "Ibuprofen 400mg", category: "Analgesic", price: 6, margin: 0.55 },
  { name: "Metformin 500mg", category: "Diabetes", price: 9, margin: 0.5 },
  { name: "Atorvastatin 10mg", category: "Cardiac", price: 15, margin: 0.48 },
  { name: "Amlodipine 5mg", category: "Cardiac", price: 11, margin: 0.5 },
  { name: "Cetirizine 10mg", category: "Antihistamine", price: 5, margin: 0.62 },
  { name: "Omeprazole 20mg", category: "Gastro", price: 8, margin: 0.58 },
  { name: "Vitamin D3 60k", category: "Supplement", price: 7, margin: 0.65 },
];

export function generatePharmacyData(): Record<string, unknown>[] {
  const rand = mulberry32(7);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
  const patients = Array.from({ length: 80 }, (_, i) => ({ id: `PAT-${1000 + i}`, name: `${pick(FIRST)} ${pick(LAST)}` }));
  const rows: Record<string, unknown>[] = [];
  const start = new Date("2024-01-01");
  let rx = 9000;
  for (let m = 0; m < 18; m++) {
    const trend = 1 + m * 0.025;
    const season = 1 + 0.2 * Math.sin((m / 12) * Math.PI * 2); // flu-season wobble
    const count = Math.round((80 + rand() * 30) * trend * season);
    for (let o = 0; o < count; o++) {
      const day = 1 + Math.floor(rand() * 27);
      const date = new Date(start.getFullYear(), start.getMonth() + m, day);
      const med = pick(MEDICINES);
      const patient = pick(patients);
      const quantity = 1 + Math.floor(rand() * 3);
      const unit_price = Math.round(med.price * (0.95 + rand() * 0.1) * 100) / 100;
      const amount = Math.round(unit_price * quantity * 100) / 100;
      const cost = Math.round(amount * (1 - med.margin) * 100) / 100;
      rows.push({
        prescription_id: `RX-${rx++}`,
        date: date.toISOString().slice(0, 10),
        patient_id: patient.id,
        patient_name: patient.name,
        medicine_name: med.name,
        category: med.category,
        quantity,
        unit_price,
        amount,
        cost,
        stock: Math.floor(rand() * 200),
      });
    }
  }
  return rows;
}

// ── SaaS demo: subscriptions, plans, accounts, MRR. ──
const PLANS: { name: string; price: number }[] = [
  { name: "Starter", price: 29 },
  { name: "Pro", price: 99 },
  { name: "Business", price: 249 },
  { name: "Enterprise", price: 799 },
];

export function generateSaasData(): Record<string, unknown>[] {
  const rand = mulberry32(19);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
  const accounts = Array.from({ length: 120 }, (_, i) => ({ id: `ACC-${2000 + i}`, name: `${pick(LAST)} ${pick(["Labs", "Group", "Inc", "Systems", "Digital", "Co"])}` }));
  const rows: Record<string, unknown>[] = [];
  const start = new Date("2024-01-01");
  let sub = 40000;
  for (let m = 0; m < 18; m++) {
    const trend = 1 + m * 0.05; // steady MRR growth
    const count = Math.round((60 + rand() * 20) * trend);
    for (let o = 0; o < count; o++) {
      const day = 1 + Math.floor(rand() * 27);
      const date = new Date(start.getFullYear(), start.getMonth() + m, day);
      const plan = pick(PLANS);
      const account = pick(accounts);
      const seats = 1 + Math.floor(rand() * 20);
      const mrr = Math.round(plan.price * seats * 100) / 100;
      const cost = Math.round(mrr * 0.35 * 100) / 100; // hosting/support
      rows.push({
        subscription_id: `SUB-${sub++}`,
        date: date.toISOString().slice(0, 10),
        account_id: account.id,
        account_name: account.name,
        plan: plan.name,
        seats,
        mrr,
        cost,
        region: pick(["North America", "Europe", "APAC", "LATAM"]),
      });
    }
  }
  return rows;
}
