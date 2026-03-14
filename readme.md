# AutoOps Monorepo

包含后端服务与前端应用的工作区。

## 目录结构
- `apps/autoops-server`：后端服务（Fastify/TypeScript/Prisma）
- `apps/autoops-web`：前端应用（Next.js）

## 开发准备
- Node.js：建议 `nvm use 22`
- 包管理器：`pnpm`

安装依赖：
```sh
pnpm install --registry=https://registry.npmmirror.com
```

## 本地运行
- 启动后端：
```sh
cd apps/autoops-server
pnpm dev
```

- 启动前端（默认端口 4000）：
```sh
cd apps/autoops-web
pnpm dev
```

## 推送到 GitHub
```sh
git remote add origin git@github.com:daifuyang/autoops.git
git branch -M main
git push -u origin main
```
