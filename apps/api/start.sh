#!/bin/sh
# Production startup: apply DB migrations, load demo data (best-effort), serve.
set -e

echo "==> Applying database migrations..."
npx prisma migrate deploy

echo "==> Seeding demo data (best-effort)..."
npx tsx prisma/seed.ts || echo "==> seed skipped"

echo "==> Starting server..."
exec node dist/index.js
