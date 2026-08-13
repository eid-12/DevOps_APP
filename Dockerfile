# CloudBase default Node/SPA Dockerfile (override if needed)
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
# Prefer lockfile when present; fall back so repos without package-lock.json still build
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
