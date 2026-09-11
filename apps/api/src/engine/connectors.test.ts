import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { isPrivateIp, quoteIdent, pgPinnedStream, mysqlPinnedStream, mssqlPinnedConnector } from "./connectors.js";

// SSRF guard: these are the addresses a saved connector must never be pointed at.
test("isPrivateIp blocks loopback, private, and link-local ranges", () => {
  for (const ip of [
    "127.0.0.1", "127.5.5.5",       // loopback
    "10.0.0.1", "10.255.1.1",       // private A
    "172.16.0.1", "172.31.255.1",   // private B
    "192.168.0.1", "192.168.1.1",   // private C
    "169.254.169.254",              // cloud metadata endpoint (link-local)
    "0.0.0.0",                      // "this host"
    "::1", "fc00::1", "fd12::1", "fe80::1", "::", // IPv6 loopback/ULA/link-local/unspecified
  ]) {
    assert.equal(isPrivateIp(ip), true, `${ip} should be treated as private`);
  }
});

// The guard runs on whatever the resolver returned, and a resolver returns IPv6 for
// any AAAA record an attacker controls. An IPv4-mapped form of the metadata IP must be
// judged by the IPv4 rules, or publishing one AAAA record walks straight past the guard.
test("isPrivateIp sees through IPv4-mapped and IPv4-compatible IPv6 forms", () => {
  for (const ip of [
    "::ffff:127.0.0.1", "::FFFF:127.0.0.1", "::ffff:169.254.169.254",
    "::ffff:10.0.0.5", "::ffff:192.168.1.1", "::127.0.0.1",
    "::ffff:7f00:1",            // the same mapped address written in hex
    "0:0:0:0:0:ffff:a9fe:a9fe", // 169.254.169.254, fully expanded
  ]) {
    assert.equal(isPrivateIp(ip), true, `${ip} should be treated as private`);
  }
});

// Ranges that are not routable on the public internet and so have no business being a
// connector target either.
test("isPrivateIp blocks CGNAT, protocol-assignment, benchmarking and multicast ranges", () => {
  for (const ip of [
    "100.64.0.1", "100.127.255.255", // carrier-grade NAT
    "192.0.0.1", "192.0.2.5",        // IETF protocol assignments / TEST-NET-1
    "198.18.0.1",                    // benchmarking
    "224.0.0.1", "239.1.1.1",        // multicast
    "255.255.255.255",               // broadcast
    "ff02::1",                       // IPv6 multicast
    "fd00:0:0::1",                   // ULA in a zero-compressed form
    "fe80::1%eth0",                  // link-local carrying a zone id
  ]) {
    assert.equal(isPrivateIp(ip), true, `${ip} should be treated as private`);
  }
});

test("isPrivateIp allows genuine public addresses", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "192.167.0.1", "192.1.0.1",
                    "100.63.255.255", "100.128.0.1", "198.17.0.1", "198.20.0.1", "223.255.255.255",
                    "2606:4700::1111", "::ffff:8.8.8.8"]) {
    assert.equal(isPrivateIp(ip), false, `${ip} should be treated as public`);
  }
});

// Identifier quoting is the only defense against SQL injection through table names,
// since the query text interpolates the identifier directly.
test("quoteIdent rejects anything but a plain (optionally schema-qualified) identifier", () => {
  for (const bad of [
    "users; DROP TABLE users",
    "users--",
    "a b",
    'a"b',
    "a`b",
    "a.b.c",   // more than one dot
    ".users",  // leading dot
    "users.",  // trailing dot
    "1users",  // leading digit
    "",
  ]) {
    assert.throws(() => quoteIdent(bad, '"'), /Invalid table name/, `"${bad}" must be rejected`);
  }
});

test("quoteIdent quotes valid identifiers per dialect and preserves schema qualification", () => {
  assert.equal(quoteIdent("orders", '"'), '"orders"');
  assert.equal(quoteIdent("public.orders", '"'), '"public"."orders"');
  assert.equal(quoteIdent("public.orders", "`"), "`public`.`orders`");
  assert.equal(quoteIdent("dbo.orders", "["), "[dbo].[orders]");
  assert.equal(quoteIdent("order_items", '"'), '"order_items"');
});

// ─── DNS-rebinding pinning ───────────────────────────────────────────────────
// The guard resolves a host, checks every address, and then the connection must go to
// the address it checked. Handing the NAME back to the driver would let it resolve a
// second time, and a zone the caller controls can answer publicly for the check and
// with an internal address for the connect. Each test below tells the factory a
// hostname that cannot resolve and asserts the socket still lands on the pinned
// address — which it can only do if no second lookup happens.

// A throwaway TCP server; returns its port and a promise for the first peer connection.
async function listener() {
  const server = net.createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as net.AddressInfo).port;
  const connected = new Promise<void>((r) => server.once("connection", () => r()));
  return { port, connected, close: () => new Promise<void>((r) => { server.close(() => r()); }) };
}

test("pgPinnedStream connects to the pinned address, not the host pg asks for", async () => {
  const { port, connected, close } = await listener();
  const socket = pgPinnedStream("127.0.0.1")!();
  // pg calls stream.connect(port, host) with the original hostname. It must be ignored.
  socket.connect(port, "host.invalid");
  await connected;
  socket.destroy();
  await close();
});

test("mysqlPinnedStream connects to the pinned address", async () => {
  const { port, connected, close } = await listener();
  const socket = mysqlPinnedStream("127.0.0.1", port)!();
  await connected;
  socket.destroy();
  await close();
});

test("mssqlPinnedConnector resolves with a socket connected to the pinned address", async () => {
  const { port, connected, close } = await listener();
  const socket = await mssqlPinnedConnector("127.0.0.1", port)!();
  await connected;
  assert.equal(socket.remoteAddress, "127.0.0.1");
  socket.destroy();
  await close();
});

// ALLOW_PRIVATE_CONNECTOR_HOSTS turns the guard off, and with nothing checked there is
// nothing to pin — the driver must be left to resolve as it always did, or a local demo
// pointed at "localhost" would stop working.
test("no pinning when the guard is disabled", () => {
  assert.equal(pgPinnedStream(null), undefined);
  assert.equal(mysqlPinnedStream(null, 3306), undefined);
  assert.equal(mssqlPinnedConnector(null, 1433), undefined);
});
