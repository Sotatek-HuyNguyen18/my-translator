# Sử dụng Node.js bản 18 alpine để nhẹ nhất
FROM node:18-alpine AS base

# Bước 1: Cài đặt dependencies
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install

# Bước 2: Build mã nguồn
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Bước 3: Chạy ứng dụng (Production)
FROM base AS runner
WORKDIR /app

ENV NODE_ENV production
# Hugging Face Spaces chạy trên cổng 7860 mặc định
ENV PORT 7860

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

EXPOSE 7860
CMD ["npm", "start"]
