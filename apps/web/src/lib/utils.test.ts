import { test, expect } from "vitest";
import { money, num, pct, bytes, timeAgo } from "./utils";

test("money: null/undefined render as an em dash", () => {
  expect(money(null)).toBe("—");
  expect(money(undefined)).toBe("—");
});

test("money: scales into K and M at the thresholds", () => {
  expect(money(999)).toBe("$999");        // below 1K stays whole dollars
  expect(money(1_000)).toBe("$1.0K");     // K threshold
  expect(money(1_500)).toBe("$1.5K");
  expect(money(999_999)).toBe("$1000.0K"); // still K just under 1M
  expect(money(1_000_000)).toBe("$1.00M"); // M threshold
  expect(money(0)).toBe("$0");
});

test("money: keeps the sign for negatives while thresholding on magnitude", () => {
  expect(money(-2_000_000)).toBe("$-2.00M");
  expect(money(-500)).toBe("$-500");
});

test("num: null renders as em dash, otherwise locale-formatted", () => {
  expect(num(null)).toBe("—");
  expect(num(1234567)).toBe((1234567).toLocaleString());
});

test("pct: signs positive values and passes through zero/negative", () => {
  expect(pct(5)).toBe("+5%");
  expect(pct(0)).toBe("0%");
  expect(pct(-3)).toBe("-3%");
  expect(pct(null)).toBe("—");
});

test("bytes: switches units at the 1024 boundaries", () => {
  expect(bytes(512)).toBe("512 B");
  expect(bytes(1024)).toBe("1.0 KB");
  expect(bytes(1536)).toBe("1.5 KB");
  expect(bytes(1024 * 1024)).toBe("1.0 MB");
});

test("timeAgo: buckets by recency", () => {
  const now = Date.now();
  const ago = (secs: number) => new Date(now - secs * 1000).toISOString();
  expect(timeAgo(ago(10))).toBe("just now");   // < 60s
  expect(timeAgo(ago(120))).toBe("2m ago");     // minutes
  expect(timeAgo(ago(7200))).toBe("2h ago");    // hours
  // Older than a day falls back to a locale date string (not "Xd ago").
  expect(timeAgo(ago(90000))).toMatch(/\d/);
});
