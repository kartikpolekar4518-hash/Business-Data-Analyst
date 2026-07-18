# DecisionIQ API image
FROM node:22-alpine
WORKDIR /app

# Install deps (cached layer)
COPY apps/api/package.json ./
RUN npm install

# App source + prisma
COPY apps/api/ ./
RUN npx prisma generate && npm run build

EXPOSE 4000
CMD ["node", "dist/index.js"]
