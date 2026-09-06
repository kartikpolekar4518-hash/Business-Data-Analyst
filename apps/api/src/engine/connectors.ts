import { lookup } from "node:dns/promises";
import net from "node:net";
import { env } from "../env.js";
import { parseFile, type ParsedFile, type Row } from "./parse.js";

// Connector ingestion: given a connection type + config + decrypted secret, pull a
// snapshot of rows in the same { rows, columns } shape as an uploaded file, so it
// flows straight into the shared ingest pipeline. Drivers are imported lazily so a
// missing/optional native driver never breaks unrelated routes at startup.

export type ConnectorType = "POSTGRES" | "MYSQL" | "SQLSERVER" | "GOOGLE_SHEETS";

// `allowInsecureTls` opts out of certificate verification for self-signed /
// internal databases. Off by default: an SSL connection verifies the server cert.
export interface DbConfig { host: string; port?: number; database: string; user: string; table: string; ssl?: boolean; allowInsecureTls?: boolean; }
export interface SheetConfig { sheetUrl: string; }

const QUERY_TIMEOUT_MS = 15_000;

// Skipping TLS cert verification is only honored alongside the same escape hatch
// that permits private hosts — otherwise an admin could self-service disable cert
// checks on a public connector (MITM). Off by default: certs are verified.
function insecureTlsAllowed(cfg: DbConfig): boolean {
  return !!cfg.allowInsecureTls && env.allowPrivateConnectorHosts;
}
// Table/column identifiers: letters, digits, underscore, and a single dot for
// schema-qualified names. Anything else is rejected so we never interpolate
// attacker-controlled SQL. Free-form queries are intentionally unsupported.
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;

export function quoteIdent(table: string, wrap: '"' | "`" | "[" ): string {
  if (!IDENT_RE.test(table)) throw new Error(`Invalid table name "${table}". Use letters, digits, underscore, and an optional schema prefix.`);
  return table.split(".").map((p) => wrap === "[" ? `[${p}]` : `${wrap}${p}${wrap}`).join(".");
}

// --- SSRF guard: refuse to connect to loopback/link-local/private hosts unless
// explicitly allowed. The cloud metadata endpoint (169.254.169.254) is covered by
// the link-local range. Overridable via ALLOW_PRIVATE_CONNECTOR_HOSTS for local DBs.

// An IPv6 address may embed an IPv4 one (::ffff:127.0.0.1, ::127.0.0.1). Resolvers do
// return these, so the v4 rules must be applied to what is embedded — otherwise
// publishing an AAAA record of ::ffff:169.254.169.254 walks straight past the guard.
function embeddedIpv4(ip: string): string | null {
  const tail = ip.slice(ip.lastIndexOf(":") + 1);
  if (net.isIPv4(tail)) return tail;
  // The same address can be written with the last 32 bits in hex (::ffff:7f00:1).
  const m = /^(?:0*:)+(?:ffff(?::0{1,4})?:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip);
  if (!m) return null;
  const hi = parseInt(m[1]!, 16), lo = parseInt(m[2]!, 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

function isPrivateIpv4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number) as [number, number];
  if (a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;           // link-local + cloud metadata IP
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true;             // IETF protocol assignments (192.0.0.0/24)
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT (100.64.0.0/10)
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking (198.18.0.0/15)
  if (a === 0) return true;                          // "this host"
  if (a >= 224) return true;                         // multicast + reserved + broadcast
  return false;
}

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIpv4(ip);
  const low = ip.toLowerCase().replace(/%.*$/, ""); // drop any zone id (fe80::1%eth0)
  const v4 = embeddedIpv4(low);
  if (v4) return isPrivateIpv4(v4);
  if (low === "::1" || low === "::") return true;
  // Ranges are matched on the first hextet, so a zero-compressed form can't slip past
  // a startsWith() over the whole string (e.g. "fd00:0:0::1" vs "fd::1").
  const head = low.split(":")[0] ?? "";
  if (/^f[cd]/.test(head)) return true;    // unique local (fc00::/7)
  if (/^fe[89ab]/.test(head)) return true; // link-local (fe80::/10)
  if (/^ff/.test(head)) return true;       // multicast
  return false;
}

async function assertHostAllowed(host: string): Promise<void> {
  if (env.allowPrivateConnectorHosts) return;
  const lower = host.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost")) {
    throw new Error("Connecting to localhost is disabled. Set ALLOW_PRIVATE_CONNECTOR_HOSTS=true for local databases.");
  }
  let addrs: { address: string }[];
  try { addrs = await lookup(host, { all: true }); }
  catch { throw new Error(`Could not resolve host "${host}".`); }
  for (const { address } of addrs) {
    if (isPrivateIp(address)) {
      throw new Error(`Host "${host}" resolves to a private/loopback address, which is blocked. Set ALLOW_PRIVATE_CONNECTOR_HOSTS=true to allow it.`);
    }
  }
}

function cap(rows: Row[]): Row[] {
  return rows.length > env.maxSyncRows ? rows.slice(0, env.maxSyncRows) : rows;
}

function columnsOf(rows: Row[]): string[] {
  return rows.length ? Object.keys(rows[0]) : [];
}

async function fetchPostgres(cfg: DbConfig, password: string): Promise<ParsedFile> {
  await assertHostAllowed(cfg.host);
  const { default: pg } = await import("pg");
  const client = new pg.Client({
    host: cfg.host, port: cfg.port ?? 5432, database: cfg.database, user: cfg.user, password,
    ssl: cfg.ssl ? { rejectUnauthorized: !insecureTlsAllowed(cfg) } : undefined,
    connectionTimeoutMillis: QUERY_TIMEOUT_MS, statement_timeout: QUERY_TIMEOUT_MS,
  });
  await client.connect();
  try {
    const { rows } = await client.query(`SELECT * FROM ${quoteIdent(cfg.table, '"')} LIMIT ${env.maxSyncRows}`);
    return { rows: rows as Row[], columns: columnsOf(rows as Row[]) };
  } finally { await client.end(); }
}

async function fetchMysql(cfg: DbConfig, password: string): Promise<ParsedFile> {
  await assertHostAllowed(cfg.host);
  const mysql = await import("mysql2/promise");
  const conn = await mysql.createConnection({
    host: cfg.host, port: cfg.port ?? 3306, database: cfg.database, user: cfg.user, password,
    ssl: cfg.ssl ? { rejectUnauthorized: !insecureTlsAllowed(cfg) } : undefined,
    connectTimeout: QUERY_TIMEOUT_MS,
  });
  try {
    const [rows] = await conn.query(`SELECT * FROM ${quoteIdent(cfg.table, "`")} LIMIT ${env.maxSyncRows}`);
    const r = rows as Row[];
    return { rows: r, columns: columnsOf(r) };
  } finally { await conn.end(); }
}

async function fetchSqlServer(cfg: DbConfig, password: string): Promise<ParsedFile> {
  await assertHostAllowed(cfg.host);
  const { default: sql } = await import("mssql");
  const pool = await sql.connect({
    server: cfg.host, port: cfg.port ?? 1433, database: cfg.database, user: cfg.user, password,
    options: { encrypt: cfg.ssl !== false, trustServerCertificate: insecureTlsAllowed(cfg) },
    connectionTimeout: QUERY_TIMEOUT_MS, requestTimeout: QUERY_TIMEOUT_MS,
  });
  try {
    const result = await pool.request().query(`SELECT TOP ${env.maxSyncRows} * FROM ${quoteIdent(cfg.table, "[")}`);
    const r = result.recordset as Row[];
    return { rows: r, columns: columnsOf(r) };
  } finally { await pool.close(); }
}

// The CSV export legitimately 307s from docs.google.com to a googleusercontent.com
// host, so we can't forbid redirects — but we follow them by hand and refuse any
// hop that leaves Google, so a tampered/hijacked redirect can't turn this into SSRF.
function isGoogleHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "docs.google.com" || h === "googleusercontent.com" || h.endsWith(".googleusercontent.com");
}

async function fetchGoogleFollowingRedirects(startUrl: string, maxHops = 3): Promise<Response> {
  let url = startUrl;
  for (let hop = 0; ; hop++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), QUERY_TIMEOUT_MS);
    let res: Response;
    try { res = await fetch(url, { signal: ctrl.signal, redirect: "manual" }); }
    finally { clearTimeout(timer); }
    if (res.status < 300 || res.status >= 400) return res;
    const location = res.headers.get("location");
    if (!location) return res;
    if (hop >= maxHops) throw new Error("Redirect limit reached fetching the sheet.");
    const next = new URL(location, url);
    if (next.protocol !== "https:" || !isGoogleHost(next.hostname)) {
      throw new Error("Redirect to a non-Google host was blocked.");
    }
    url = next.toString();
  }
}

// The row cap only applies AFTER parsing, so the download itself must be bounded too:
// buffering a whole response into memory on the word of a remote server is how one
// oversized (or endless) sheet takes the API process down. Matches parseFile's ceiling.
const MAX_SHEET_BYTES = 50 * 1024 * 1024;

async function readCapped(res: Response): Promise<Buffer> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_SHEET_BYTES) throw new Error("That sheet is too large to import (over 50MB).");
  if (!res.body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    // Content-Length can lie, or be absent on a chunked response, so the real
    // defence is counting the bytes as they arrive and cancelling the stream.
    if (total > MAX_SHEET_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error("That sheet is too large to import (over 50MB).");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

// Google Sheets: no OAuth. Turn a shared-link URL into its CSV export endpoint and
// parse it like an uploaded CSV. The sheet must be shared "anyone with the link".
async function fetchGoogleSheet(cfg: SheetConfig): Promise<ParsedFile> {
  let url: URL;
  try { url = new URL(cfg.sheetUrl); } catch { throw new Error("That doesn't look like a valid Google Sheets URL."); }
  if (url.hostname !== "docs.google.com") throw new Error("Only docs.google.com sheet links are supported.");
  const m = url.pathname.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  if (!m) throw new Error("Could not find a spreadsheet ID in that URL.");
  const gid = url.hash.match(/gid=(\d+)/)?.[1] ?? url.searchParams.get("gid") ?? "0";
  const exportUrl = `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`;

  let res: Response;
  try { res = await fetchGoogleFollowingRedirects(exportUrl); }
  catch (e) { throw new Error(e instanceof Error && e.message.startsWith("Redirect") ? e.message : "Could not reach Google Sheets. Check the link is shared publicly."); }
  if (!res.ok) throw new Error(`Google Sheets returned ${res.status}. Make sure the sheet is shared "anyone with the link".`);
  const csv = await readCapped(res);
  if (csv.subarray(0, 15).toString("utf8").includes("<!DOCTYPE html")) {
    throw new Error('The sheet isn\'t public — set sharing to "anyone with the link".');
  }
  return parseFile({ buffer: csv, fileName: "sheet.csv" });
}

export async function fetchFromConnection(type: ConnectorType, config: unknown, secret: string): Promise<ParsedFile> {
  let parsed: ParsedFile;
  switch (type) {
    case "POSTGRES": parsed = await fetchPostgres(config as DbConfig, secret); break;
    case "MYSQL": parsed = await fetchMysql(config as DbConfig, secret); break;
    case "SQLSERVER": parsed = await fetchSqlServer(config as DbConfig, secret); break;
    case "GOOGLE_SHEETS": parsed = await fetchGoogleSheet(config as SheetConfig); break;
    default: throw new Error(`Unsupported connector type "${type}"`);
  }
  parsed.rows = cap(parsed.rows);
  return parsed;
}
