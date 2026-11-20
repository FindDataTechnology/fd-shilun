# fd-zhesi-web 前端镜像 — 多阶段：node 构建 → nginx 服静态面（/ /workbench /admin SPA）。
# 发布通道：GitHub Actions -> TCR（.github/workflows/image.yml，配方 docs/IMAGE-RELEASE.md）。
# 硬性要求（IMAGE-RELEASE）：上游源为默认（美国 runner 绕道国内镜像会把构建拖成小时级），
# 国内 npm 镜像源一律 ARG 且默认空。
FROM node:22-slim AS build

ARG NPM_REGISTRY=""
# 缓存失效锚（2026-11-20）：buildkit 的 GHA cache 在本仓曾把 `COPY . .` 与
# `RUN npm run build` 判成 CACHED（源码明明变了），产出与上一版逐字节相同的
# 镜像，而「内容变了才铸 tag」因此永远判「未变」、不可变 tag 一直不产出。
# 改这个值 = 让后续所有层重新执行一次；平时不必动它。
ARG BUILD_CACHE_BUST="2026-11-20-site-furniture"

WORKDIR /app

COPY package.json package-lock.json ./
RUN if [ -n "$NPM_REGISTRY" ]; then npm ci --no-audit --no-fund --registry="$NPM_REGISTRY"; else npm ci --no-audit --no-fund; fi

COPY . .

# 缓存锚必须落在 COPY . . 之后：放在它之前只会让那一层失效，COPY 与 npm run build
# 仍然命中旧缓存（这正是 2026-11-20 那次「源码变了、镜像没变」的成因）。
RUN echo "cache-bust: ${BUILD_CACHE_BUST}" && npm run build

FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/ /usr/share/nginx/html/

EXPOSE 80
