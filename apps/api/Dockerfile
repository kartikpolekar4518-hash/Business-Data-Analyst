# DecisionIQ all-in-one image: API + built web UI served on one port.
# Workspace-aware, reproducible install via the committed root lockfile.
FROM node:22-alpine
WORKDIR /app

# Install with the committed lockfile (reproducible). Copy the root + workspace
# manifests first so the dependency layer is cached across source changes.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

# Build API + web
COPY apps/api apps/api
COPY apps/web apps/web
RUN npm run prisma:generate --workspace apps/api \
 && npm run build --workspace apps/api \
 && npm run build --workspace apps/web

# Run as the built-in non-root user (needs write access for the seed's sample CSV).
RUN chown -R node:node /app
USER node

ENV WEB_DIST=/app/apps/web/dist
WORKDIR /app/apps/api
EXPOSE 4000
CMD ["node", "dist/index.js"]
