# 多階段建置：Vite 產出靜態資源 → Nginx（適用 Google Cloud Run，監聽 8080）
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# 建置時可覆寫，例如：docker build --build-arg VITE_STORAGE_MODE=localStorage .
ARG VITE_STORAGE_MODE=localStorage
ARG VITE_API_URL=
ARG VITE_ASYNC_STORAGE_DELAY_MS=0
ENV VITE_STORAGE_MODE=$VITE_STORAGE_MODE
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_ASYNC_STORAGE_DELAY_MS=$VITE_ASYNC_STORAGE_DELAY_MS

RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
