import { test } from "node:test";
import assert from "node:assert/strict";
import { isPrivateIp, quoteIdent } from "./connectors.js";

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

test("isPrivateIp allows genuine public addresses", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "192.167.0.1", "2606:4700::1111"]) {
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
