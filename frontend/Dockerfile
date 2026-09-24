# Stage 1 — build da aplicação Angular
FROM node:20-alpine AS build
WORKDIR /app
# Copia package.json, o lock E o .npmrc ANTES do install.
# O .npmrc tem "legacy-peer-deps=true", que o Tailwind v4 precisa no Angular 18.
# Sem ele aqui dentro, o "npm install" quebra com ERESOLVE no build do Docker.
COPY package*.json .npmrc ./
RUN npm install --legacy-peer-deps
COPY . .
RUN npm run build

# Stage 2 — serve com Nginx
FROM nginx:alpine
COPY --from=build /app/dist/frontend/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
