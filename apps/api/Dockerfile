# DecisionIQ all-in-one image: API + built web UI served on one port.
FROM node:22-alpine
# Prisma's engines need OpenSSL/libc at runtime on Alpine (musl).
RUN apk add --no-cache openssl libc6-compat
WORKDIR /app

# Install deps (cached layers)
COPY apps/api/package.json api/package.json
RUN cd api && npm install
COPY apps/web/package.json web/package.json
RUN cd web && npm install

# Build API + web
COPY apps/api api
COPY apps/web web
RUN cd api && npx prisma generate && npm run build
RUN cd web && npm run build

WORKDIR /app/api
ENV WEB_DIST=/app/web/dist
EXPOSE 4000
# start.sh: migrate + seed (best-effort) + serve. Exec form avoids shell quirks.
CMD ["sh", "start.sh"]
