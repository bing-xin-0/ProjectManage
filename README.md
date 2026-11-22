# 项目管家 Project Pulse

开发者个人的「多项目记忆助手」：聚合所有 git 项目的提交元数据 + 轻量笔记，配合 Web 仪表盘可视化（提交时间线、凉了提醒、日报/周报），回到项目 30 秒恢复上下文。

> 策划文档见 [项目管家-产品策划.md](./项目管家-产品策划.md)

## 技术栈

- **desktop/** Tauri v2（Rust 壳 + React 前端）— 桌面端：登记项目、采集 git 元数据、填笔记、同步
- **server/** Node.js + TypeScript + Fastify + SQLite — 服务端：存储、统计、日报周报、邮件摘要
- **web/** React + Vite + Ant Design + ECharts — Web 仪表盘：项目卡片、时间线、提醒、报告

## 开发

```bash
pnpm install        # 安装全部依赖
pnpm dev            # 同时起 server(:3000) 和 web(:5173)
pnpm dev:server     # 只起服务端
pnpm dev:web        # 只起 Web
pnpm dev:desktop    # 起桌面端（需 Rust 工具链）
```

## 环境要求

- Node.js >= 20（推荐 22+）
- pnpm
- Rust 工具链（仅桌面端需要）