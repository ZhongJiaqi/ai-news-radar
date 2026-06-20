# AI News Radar

Daily AI Briefing — 每日 AI 简报，帮 AI 从业者快速了解最重要的 AI 动态。

🔗 **线上地址**：https://ai-radar-delta.vercel.app/

## 你能看到什么

| 页面 | 内容 |
|---|---|
| **Daily Briefing** [`/digest`](https://ai-radar-delta.vercel.app/digest) | 今日要点 8 行 + Top 3 头条 + More Signals 5 条 |
| **Archive** [`/archive`](https://ai-radar-delta.vercel.app/archive) | 按日期翻历史，每天 Top 30 精选 + 8 类速览 |

每天北京时间凌晨自动跑一遍：从 130 个数据源抓取 → LLM 摘要 / 分类 / 跨语言去重 / 按重要性 1-10 打分 → 生成简报。

## 数据源（130 个）

涵盖 AI 行业全谱：

- 🏢 **官方博客** — OpenAI / Anthropic / Google DeepMind / Meta AI / xAI / Mistral / NVIDIA / Hugging Face 等
- 📰 **媒体** — 36氪 / 量子位 / TechCrunch / CNBC / MIT Technology Review 等
- 👥 **Builder 一手观点** *(2026-06-20 新增)* — 26 个 AI builder 的 X 推文（@karpathy / @sama / @bcherny 等）+ 6 个 AI 播客 transcript（Latent Space / No Priors / The MAD Podcast 等）+ 2 个官博（Anthropic Engineering / Claude Blog），数据由 [zarazhangrui/follow-builders](https://github.com/zarazhangrui/follow-builders) 提供
- 🛠 **社区** — Hacker News / GitHub Trending / Hugging Face Trending

完整数据源清单见 [`lib/crawlers/sources.ts`](lib/crawlers/sources.ts)。

## 设计

暗色「雷达终端」(Dark Radar Terminal) 风格：1180 居中阅读列 + 左右框线、雷达扫描动画、绿色信号 accent (`#5FE3A1`)、mono 元信息。字体：英文 **Outfit** / 数字 **JetBrains Mono** / 中文 **苹方 (PingFang SC)**。

## 怎么订阅

### 网页书签
直接收藏 [`/digest`](https://ai-radar-delta.vercel.app/digest)，每天打开看今日。

### 飞书机器人推送
每天自动推送今日要点到你的飞书群（含 Top Stories + 查看完整简报按钮）。

配置 5 分钟：

1. 飞书群 → 群设置 → 群机器人 → 添加 → 自定义机器人
2. 安全设置：**签名校验关闭** ⛔（开了机器人会被拒收）+ **关键词** 填 `Radar` ✅
3. 拷贝 webhook URL，设置环境变量 `LARK_WEBHOOK_URL`

工作日异常时（爬虫失败 / LLM 全挂 / 上游 RSS 5xx）会推**红色告警卡**，正常 digest 是**蓝色卡**。

## 开发者文档

技术栈（Next.js 15 + Supabase + GitHub Actions Cron + 自愈 LLM 链路 + 飞书机器人）、数据库 schema、cron 配置、本地部署、LLM 自愈链设计等开发细节，见 [`docs/`](docs/) 和源码注释。

环境变量 example: [`.env.example`](.env.example) / 数据库 migration: [`supabase/migrations/`](supabase/migrations/)。
