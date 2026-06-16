# AI News

Daily AI Briefing — 每日 AI 简报，帮助 AI 从业者快速了解最重要的 AI 动态。

**线上地址**: https://ai-radar-delta.vercel.app/

## 技术栈

- **前端**: Next.js 15 (App Router) + TypeScript + Tailwind CSS
- **数据库**: Supabase (PostgreSQL)
- **LLM**: Generic provider layer (Anthropic + OpenAI-compatible endpoints such as DashScope) with **self-healing dynamic chain**（discover → revive → probe-sweep unknown pool）
- **部署**: Vercel + GitHub Actions Cron
- **通知**: 飞书机器人卡片（可选，digest 跑完自动推送）

## 核心功能

| 页面 | 功能 |
|------|------|
| `/digest` | Daily Briefing 今日要点（基于前 8 篇文章的摘要） + Top Stories 3 + More Signals 5（北京时间昨天一整天） |
| `/archive/[date]` | 简报归档，按日期回溯查看（基于前 30 篇文章的 lede + 结构化分类 tab）。旧路径 `/history` 永久 301 至此 |

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
3. Cron Jobs（GitHub Actions）：
   - **Crawl Sources** (`crawl.yml`)：每 6h 抓取，`workflow_dispatch` 也可手动触发
   - **Process Articles** (`process.yml`)：**事件驱动 + cron 兜底**——`crawl` 完成立刻触发（`workflow_run`），同时保留每 3h cron 作为 backup。180 min wall-clock budget，内部 drain loop 跑到队列清空或临近超时；单次 LLM 调用 60s timeout 防 hang
   - **Generate Daily Digest** (`digest.yml`)：**事件驱动 + cron 兜底**——`process` 完成立刻触发（`workflow_run`），同时保留每天 UTC 23:07 cron 作 safety net（GH cron 实测延迟 60-150min，事件驱动消除该延迟）。脚本层 `isAlreadyFinalized` 检查兜重复触发（process 每天跑 ~8 次，已 finalized 的直接 exit 0 不烧 LLM）。可选 `LARK_WEBHOOK_URL` → 推送飞书卡片
   - **Retention Cleanup** (`cleanup.yml`)：每周一清理（articles >90d、job_runs >30d、daily_digests >7d）

### LLM 动态自愈链（Supabase `llm_model_health` 表）

`scripts/process.ts` 启动 warm-up 三件套：

1. **`reviveExhaustedModels`** — `exhausted_until` 已过的自动复活回 `available`
2. **`discoverModels`** — 调 provider 的 `/v1/models` 拉账号当前清单 UPSERT 进表（新模型 status=`unknown`）
3. **`probeSweep`** — `getDynamicChain` 返回的 available < 3 时，对 unknown 池跑 1-token 探测（最多 30 个，每个 10s timeout），命中的自动 mark `available` 并立即进入 chain。**DashScope 免费额度按模型 ID 单独计**，已知 chain 全 exhausted 时这一步能从 200+ 个未知模型里挖出新可用桶（实测一次 sweep 65s 出 13 个可用，含 `kimi-k2.6` 343ms / `qwen3.7-max-preview` 1.5s / `deepseek-v4-pro` 3.4s 等）

调用顺序：`generate()` 时 `resolveDynamicChain` 按 `last_success_at` + `avg_latency_ms` 排序生成动态 chain。模型 quota 耗尽（403/429 + quota 文字）自动标 `exhausted` + `exhausted_until = 次日 UTC 0 点`；401/404 标 `broken`；其他 4xx 不污染状态。

一键关闭：`LLM_DYNAMIC_CHAIN=off`。详见 `lib/llm/discovery.ts`。

### 飞书机器人推送（可选）

`digest` 跑完后自动推送一张交互卡片到飞书自定义机器人。卡片含：今日要点 4 行 + Top Stories 3 篇（带原文 URL / 来源 / score emoji 🔴🟠🟡⚪）+「查看完整简报」按钮跳 `/digest`。

#### 配置步骤

1. 飞书群 → 群设置 → 群机器人 → 添加 → 自定义机器人
2. 安全设置：
   - ⛔ **签名校验关闭**（脚本不带签名，开启会被 19021 拒收）
   - ✅ **关键词**：填 `Radar`（卡片 header `🛰 AI News Radar · YYYY-MM-DD` 自动满足）
3. 拷贝 webhook URL（形如 `https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxx`）
4. 设置 GitHub Actions secret：`gh secret set LARK_WEBHOOK_URL`
5. 本地手跑想发飞书：在 `.env.local` 加 `LARK_WEBHOOK_URL=...`

#### 双 idempotent 兜底

- digest 脚本入口 `isAlreadyFinalized` 检查：今日 row 已 finalized（usable summary + non-empty ids）→ 整 digest skip → 不发飞书
- pushLarkDigest 内部 `isUsableSummary` 检查：row 是 hard fallback 单段落 → 单独 skip 推送（不污染飞书）
- 所有 fetch/parse 错误 console.warn 不抛，飞书挂不会拖垮 digest job

未设 `LARK_WEBHOOK_URL` → 静默 skip。详见 `lib/notify/lark.ts`。

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
│   ├── llm/                 # LLM provider 层 + discovery (probe-sweep 自愈)
│   ├── notify/              # 飞书机器人卡片推送 (lark.ts)
│   ├── history.ts           # History 结构化数据层
│   ├── db.ts                # 查询重试封装 (queryWithRetry)
│   └── utils/               # 工具函数 (digestSummary/时间/pangu)
└── supabase/migrations/     # 数据库 Schema
```
