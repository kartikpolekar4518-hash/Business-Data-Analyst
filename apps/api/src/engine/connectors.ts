import { lookup } from "node:dns/promises";
import net from "node:net";
import { env } from "../env.js";
import { parseFile, type ParsedFile, type Row } from "./parse.js";

// Connector ingestion: given a connection type + config + decrypted secret, pull a
// snapshot of rows in the same { rows, columns } shape as an uploaded file, so it
// flows straight into the shared ingest pipeline. Drivers are imported lazily so a
// missing/optional native driver never breaks unrelated routes at startup.

export type ConnectorType = "POSTGRES" | "MYSQL" | "SQLSERVER" | "GOOGLE_SHEETS";

export interface DbConfig { host: string; port?: number; database: string; user: string; table: string; ssl?: boolean; }
export interface SheetConfig { sheetUrl: string; }

const QUERY_TIMEOUT_MS = 15_000;
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
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local + metadata IP
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 0) return true;
    return false;
  }
  const low = ip.toLowerCase();
  return low === "::1" || low.startsWith("fc") || low.startsWith("fd") || low.startsWith("fe80") || low === "::";
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
    ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
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
    ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
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
    options: { encrypt: cfg.ssl !== false, trustServerCertificate: true },
    connectionTimeout: QUERY_TIMEOUT_MS, requestTimeout: QUERY_TIMEOUT_MS,
  });
  try {
    const result = await pool.request().query(`SELECT TOP ${env.maxSyncRows} * FROM ${quoteIdent(cfg.table, "[")}`);
    const r = result.recordset as Row[];
    return { rows: r, columns: columnsOf(r) };
  } finally { await pool.close(); }
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

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), QUERY_TIMEOUT_MS);
  let res: Response;
  try { res = await fetch(exportUrl, { signal: ctrl.signal, redirect: "follow" }); }
  catch { throw new Error("Could not reach Google Sheets. Check the link is shared publicly."); }
  finally { clearTimeout(timer); }
  if (!res.ok) throw new Error(`Google Sheets returned ${res.status}. Make sure the sheet is shared "anyone with the link".`);
  const csv = Buffer.from(await res.arrayBuffer());
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
