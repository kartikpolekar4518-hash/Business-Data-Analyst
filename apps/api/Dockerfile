# NoPS all-in-one image: API + built web UI + the optional Signals model service,
# served on one port from one CMD.
#
# bookworm-slim, not alpine. scikit-learn and SHAP publish no musl wheels, so on Alpine
# pip compiles them from source — a build that takes tens of minutes and needs a full
# toolchain in the image. On Debian the standard manylinux wheels install in seconds.
# The image grows by roughly 400 MB as a result; that is the price of this feature.
FROM node:22-bookworm-slim
WORKDIR /app

# python3 for the model service, openssl because Prisma's engines link against it.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip python3-venv openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install deps (cached layers)
COPY apps/api/package.json api/package.json
RUN cd api && npm install
COPY apps/web/package.json web/package.json
RUN cd web && npm install

# The model service's own dependencies, in a venv because Debian marks the system
# Python as externally managed. Copied before the source so a code change does not
# reinstall scikit-learn.
COPY apps/ml/requirements.txt ml/requirements.txt
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -r ml/requirements.txt

# Build API + web
COPY apps/api api
COPY apps/web web
COPY apps/ml ml
RUN cd api && npx prisma generate && npm run build
RUN cd web && npm run build

WORKDIR /app/api
ENV WEB_DIST=/app/web/dist
# Where index.ts looks for the model service, and which interpreter runs it.
ENV ML_DIR=/app/ml
ENV PYTHON_BIN=/opt/venv/bin/python3
# On by default in this image, because the image ships the service. It still needs
# ML_SHARED_SECRET to serve anything outside a dev environment.
ENV ML_ENABLED=true
EXPOSE 4000
CMD ["node", "dist/index.js"]
