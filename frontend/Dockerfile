FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --silent
COPY . .
COPY src/environments/environment.prod.ts src/environments/environment.ts
RUN node node_modules/@angular/cli/bin/ng.js build --configuration production

# Pinned: nginx 1.30.6 (current stable line) by digest, so the image serving every page cannot change silently.
FROM nginx:1.30.6-alpine@sha256:583b7f2fce1cdb8da5ad5c39ebd3c33b98b87d493190e548bdee1fa8c619c311
COPY --from=build /app/dist/cloudbase-frontend/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf /etc/nginx/snippets/security-headers.conf
EXPOSE 3000
