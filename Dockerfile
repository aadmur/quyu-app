# syntax=docker/dockerfile:1
# 趣渔全栈动态部署 Dockerfile（对齐 Kimi 平台官方全栈模板约定）
# 关键：内网 npm 源 + 代理；生产阶段携带 .env；单次安装复用 node_modules；端口 3000

# ---------- 依赖阶段（内网源安装全部依赖，供构建与运行复用） ----------
FROM node:20-alpine AS deps
WORKDIR /app

# 平台构建环境无法直连公网 npm，必须使用内网镜像源 + 代理
RUN npm config set registry https://npm.mirrors.msh.team \
 && npm config set proxy http://172.23.0.4:2003 \
 && npm config set https-proxy http://172.23.0.4:2003 \
 && npm config set strict-ssl false

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---------- 构建阶段 ----------
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---------- 运行阶段 ----------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# 复用依赖（不再联网安装）
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
# 生产环境必需的密钥/数据库连接（平台构建上下文提供 .env，env.ts 生产模式缺失会 throw）
COPY .env ./
# 拷贝构建产物（dist/boot.js + dist/public）
COPY --from=builder /app/dist ./dist

EXPOSE 3000
# 与 package.json 的 start 脚本一致：NODE_ENV=production node dist/boot.js
CMD ["npm", "start"]
