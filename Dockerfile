# Dual-stage build for Livslinjen / GeoGuesser Quiz (ARM64 / Raspberry Pi 5 & x86_64 compatible)

# Stage 1: Build the Vite React application
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies first for layer caching
COPY package.json package-lock.json ./
RUN npm ci

# Copy application source and pre-built dataset (public/data/people.json & wiki_summaries.json)
COPY index.html tsconfig.json vite.config.ts ./
COPY public ./public
COPY src ./src

# Build production bundle into /app/dist
RUN npm run build

# Stage 2: Serve static assets with lightweight Nginx (with Gzip for the JSON datasets)
FROM nginx:alpine

# Copy custom nginx config with gzip and SPA fallback
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
