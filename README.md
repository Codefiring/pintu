# 拼图 (Pintu) — 长图拼接

匿名、一次性的在线长图拼接工具：上传图片 → 排序/裁边 → 生成长图下载。
图片仅在生成请求期间经过服务器，处理完立即丢弃，不做任何存储。

## 开发

```bash
# 终端 1 — 后端 (http://localhost:3000)
cd server && npm install && npm run dev

# 终端 2 — 前端 (http://localhost:5173，/api 代理到 3000)
cd frontend && npm install && npm run dev
```

## 测试

```bash
cd server && npm test
cd frontend && npm test
```

## 部署 (VPS)

```bash
docker compose up -d --build
```

服务监听 3000 端口，由宿主机的 nginx/caddy 反代。
注意：反向代理需放行较大的请求体（图片总量上限 200MB），例如 nginx 设置
`client_max_body_size 200m;` 和 `proxy_read_timeout 60s;`。

## 限制

- 单次最多 30 张图片，单张 ≤ 20MB，总量 ≤ 200MB
- 输出图片单边 ≤ 65000 像素

## 设计文档

- 设计规格：`docs/superpowers/specs/2026-06-10-pintu-long-image-stitching-design.md`
- 实施计划：`docs/superpowers/plans/2026-06-10-pintu-long-image-stitching.md`
