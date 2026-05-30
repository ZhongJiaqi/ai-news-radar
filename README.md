# AI News

Daily AI Briefing — 每日 AI 简报，帮助 AI 从业者快速了解最重要的 AI 动态。

**线上地址**: https://ai-radar-delta.vercel.app/

## 技术栈

- **前端**: Next.js 15 (App Router) + TypeScript + Tailwind CSS
- **数据库**: Supabase (PostgreSQL)
- **LLM**: Generic provider layer (Anthropic + OpenAI-compatible endpoints such as DashScope)
- **部署**: Vercel + GitHub Actions Cron

## 核心功能

| 页面 | 功能 |
|------|------|
| `/digest` | Daily Briefing 今日要点（基于前 8 篇文章的摘要） + Top Stories 3 + More Signals 5（北京时间昨天一整天） |
| `/history/[date]` | 简报归档，按日期回溯查看（基于前 30 篇文章的 lede + 结构化分类 tab） |

页面渲染**走 fast path（0 LLM 调用）**：cron 一天一次集中跑 LLM 去重并把结果（top 30 deduped article IDs + summary_top8 + 今日总结 markdown）写进 `daily_digests`，页面按 ID 读即可。Cron 没跑过的日期 fallback 到 live LLM dedup。

## 设计

暗色「雷达终端」(Dark Radar Terminal) 风格：1180 居中阅读列 + 左右框线、雷达扫描动画、绿色信号 accent (`#5FE3A1`)、mono 元信息。字体：英文 **Outfit** / 数字 **JetBrains Mono** / 中文 **苹方 (PingFang SC)**。

## 数据流

```
爬虫 (每6h) → LLM处理 (每3h) → 简报生成 (每天07:07北京时间)
    ↓              ↓                    ↓
 128个数据源   打分/分类/摘要      Daily Briefing + 分类速览
```

### 数据源覆盖 (128 个)

以 RSS 为主（122 RSS + 2 API + 1 爬虫 + 3 Twitter），覆盖官方博客（OpenAI / Anthropic / Google DeepMind / Meta AI / xAI / Mistral / NVIDIA / Hugging Face 等）、媒体（36氪 / 量子位 / TechCrunch / CNBC / MIT Technology Review 等）、个人与社区（Hacker News / GitHub Trending / Hugging Face Trending 等）。完整清单见 `lib/crawlers/sources.ts`。

> Twitter 源需要 `TWITTER_BEARER_TOKEN`

### 内容处理

每篇文章经 LLM 处理后生成：

| 字段 | 说明 |
|------|------|
| `summary_zh` | 2-3 句中文摘要 |
| `category` | 8 类之一（模型发布/产品工具/研究论文等） |
| `tags` | 最多 8 个标签 |
| `importance_score` | 1-10 分（10=行业级事件） |
| `why_it_matters` | 一句话核心洞察 |

### 去重机制

1. **URL 唯一约束** — 完全匹配（数据库 unique index）
2. **标题哈希去重** — 规范化后 SHA256
3. **LLM 辅助去重** — 简报 cron 调用 `deduplicateArticles`，把同一核心事件的新闻报道、评论分析、侧面数据视为一组，按重要性保留代表；结果存进 `daily_digests.top_article_ids`（dedup 后 top 30）+ `stats.dedup_applied=true`，页面按 ID 读避免重复 LLM 调用

### Fallback 自动补全

LLM 处理失败时写入 heuristic 结果并标记 `is_fallback=true`，后续 cron 自动重试补全（最多 3 次）。

## 快速开始

### 1. 配置环境变量

```bash
cp .env.example .env.local
# 填入：
# NEXT_PUBLIC_SUPABASE_URL
# NEXT_PUBLIC_SUPABASE_ANON_KEY
# SUPABASE_SERVICE_ROLE_KEY
# LLM_API_KEY
# LLM_BASE_URL
# CRON_SECRET
```

### 2. 初始化数据库

```bash
supabase db push
```

### 3. 安装依赖和启动

```bash
npm install
npm run dev
```

### 4. 手动触发首次抓取

```bash
curl -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/crawl
curl -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/process
curl -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/digest
```

### E2E 测试

```bash
npm run build
npm run test:e2e
```

## 部署

1. 推送到 GitHub，Vercel 自动部署
2. 配置所有环境变量
3. Cron Jobs（GitHub Actions + Vercel）：
   - **每 6 小时**: 抓取新资讯
   - **每 3 小时**: LLM 处理 + Fallback 补全（默认 timeout 20 分钟）
   - **每天 23:07 UTC**: 生成每日简报（含 dedup + summary_top8 + summary_top30）
   - **每周一**: 数据保留（articles >90d、job_runs >30d、daily_digests >7d）

### Vercel Analytics

`@vercel/analytics/next` 已挂在 root layout，dashboard 看 PV/UV/热门页/来源/设备。无 cookie 无 GDPR 横幅。

> 所有日期计算统一使用北京时间 (UTC+8)，与服务器时区无关。

## LLM 配置

```bash
LLM_API_KEY=your-api-key
LLM_BASE_URL=https://api.anthropic.com
LLM_MODEL=（可选，覆盖默认模型）
```

兼容 Anthropic 官方和 OpenAI 兼容接口（如阿里云百炼 DashScope）。

## 项目结构

```
ai-news-radar/
├── app/
│   ├── digest/              # Daily Briefing 主页 (News)
│   ├── history/             # 简报归档 (按日期, 结构化)
│   └── api/cron/            # Cron 路由 (crawl/process/digest)
├── components/              # UI 组件 (RadarNav / HistoryReader / HistoryRail)
├── lib/
│   ├── crawlers/            # 128 个数据源爬虫
│   ├── processor/           # LLM 处理 + 简报生成
│   ├── llm/                 # LLM provider 层
│   ├── history.ts           # History 结构化数据层
│   ├── db.ts                # 查询重试封装 (queryWithRetry)
│   └── utils/               # 工具函数 (去重/时间/pangu)
└── supabase/migrations/     # 数据库 Schema
```
