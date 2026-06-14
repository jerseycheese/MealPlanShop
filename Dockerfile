FROM node:20-slim

# poppler-utils provides pdftoppm, used to rasterize PDF circulars for scanning.
RUN apt-get update \
  && apt-get install -y --no-install-recommends poppler-utils \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first for layer caching. Full install (NOT --omit=dev): tsx is the
# runtime and vite builds the client — both are devDependencies.
COPY package*.json ./
RUN npm ci

# Build the client at image-build time so container start runs tsx directly
# (CMD below) instead of `npm start`, whose prestart would rebuild every boot.
COPY . .
RUN npm run build:client

ENV NODE_ENV=production \
    MEALPLANSHOP_DATA_DIR=/data

# Preferences + the Gemini key persist here — mount a volume to keep them across
# container recreation.
VOLUME ["/data"]

EXPOSE 3101

# tsx directly. Node binds 0.0.0.0/:: by default (app.listen has no host arg),
# so the server is reachable via -p; NODE_ENV=production serves the built UI.
CMD ["npx", "tsx", "server/index.ts"]
