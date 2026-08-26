FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY vendor-pkgs ./vendor-pkgs
RUN npm ci --silent
COPY . .
COPY src/environments/environment.prod.ts src/environments/environment.ts
RUN node node_modules/@angular/cli/bin/ng.js build --configuration production

FROM nginx:1.27-alpine
COPY --from=build /app/dist/cloudbase-frontend/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
