-- Money and time were both implicit. Every figure in the product printed a "$" that no
-- setting chose, and a timestamp carrying an offset was bucketed in the server's UTC day
-- rather than the business's own — so a 00:30 IST transaction on 1 January was reported
-- in December.
--
-- Defaults reproduce today's behaviour exactly: USD is the symbol already hardcoded, and
-- UTC is the zone the server already bucketed in. An organization that never touches
-- these sees no number and no label change.
ALTER TABLE "Organization" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE "Organization" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'UTC';
