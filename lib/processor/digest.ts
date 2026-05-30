// ======================================================
// AI Radar - Daily Digest Generator
// ======================================================

import { generateText, generateJson } from '../llm'
import { createServiceClient } from '../supabase'
import { categoryLabel } from '../i18n/categories'
import { getDateRangeCN } from '../utils/time'
import type { EnrichedArticle, DigestStats, ContentCategory } from '../types'
import { pangu } from '../utils/pangu'

const CATEGORY_EMOJI: Record<ContentCategory, string> = {
  model_release: '',
  product_tool: '',
  research_paper: '',
  industry_news: '',
  funding_ma: '',
  policy_regulation: '',
  open_source: '',
  opinion_insight: '',
}

const SCORE_LABEL: Record<number, string> = {
  10: '🔴 极重要', 9: '🔴 极重要',
  8: '🟠 重要', 7: '🟠 重要',
  6: '🟡 值得关注', 5: '🟡 值得关注',
  4: '⚪ 一般', 3: '⚪ 一般',
  2: '⚪ 普通', 1: '⚪ 普通',
}

export async function generateDailyDigest(date: string): Promise<string> {
  const supabase = createServiceClient()

  // Fetch articles from the day before (Beijing time 00:00~24:00)
  // e.g. digest for 2026-03-29 covers 2026-03-28 00:00 ~ 2026-03-29 00:00
  const [y, m, d] = date.split('-').map(Number)
  const prevDay = new Date(Date.UTC(y, m - 1, d - 1))
  const prevDateStr = `${prevDay.getUTCFullYear()}-${String(prevDay.getUTCMonth() + 1).padStart(2, '0')}-${String(prevDay.getUTCDate()).padStart(2, '0')}`
  const { since, until } = getDateRangeCN(prevDateStr)

  const { data: articles, error } = await supabase
    .from('enriched_articles')
    .select('*')
    .gte('published_at', since)
    .lt('published_at', until)
    .gte('importance_score', 5)
    .order('importance_score', { ascending: false })
    .limit(100)

  if (error) throw new Error(`Digest fetch error: ${error.message}`)

  const enriched: EnrichedArticle[] = (articles || [])
    .sort((a, b) => b.importance_score - a.importance_score)

  if (enriched.length === 0) {
    return `# AI 每日简报 ${date}\n\n今日暂无数据。`
  }

  // Top 30 for summary (before dedup, matches page.tsx query)
  const top = enriched.slice(0, 30)

  // Compute stats
  const stats: DigestStats = {
    total: enriched.length,
    by_category: {},
    avg_importance: Math.round(
      enriched.reduce((s, a) => s + a.importance_score, 0) / enriched.length * 10
    ) / 10,
  }
  for (const a of enriched) {
    stats.by_category[a.content_category] = (stats.by_category[a.content_category] || 0) + 1
  }

  // Generate executive summary from full list (before dedup)
  const executiveSummary = await generateExecutiveSummary(top)

  // Deduplicate for markdown article list only
  const deduped = await deduplicateArticles(enriched)

  // Build Markdown digest
  const dedupedTop = deduped.slice(0, 30)
  const md = pangu(buildMarkdown(since, until, executiveSummary, dedupedTop, stats))

  // Save to DB
  await supabase.from('daily_digests').upsert({
    date,
    content_md: md,
    top_article_ids: top.map(a => a.id),
    stats,
    generated_at: new Date().toISOString(),
  }, { onConflict: 'date' })

  return md
}

export async function generateExecutiveSummary(articles: EnrichedArticle[]): Promise<string> {
  const articleList = articles
    .map((a, i) =>
      `${i + 1}. [${SCORE_LABEL[a.importance_score] || ''}] ${a.title}\n   ${a.why_it_matters}`
    )
    .join('\n')

  const prompt = `你是 AI 行业分析师，面向中国 AI 从业者（产品经理、开发者、创业者）撰写每日要点。

基于以下今日资讯，提炼 4-8 个最值得关注的要点。注意：严格控制在 4-8 个，绝对不要超过 8 个。

写作要求：
- 每个要点必须包含两部分：前半句写"发生了什么"（事件主体 + 关键事实），后半句写"这意味着什么"（对从业者的影响或行动建议）
- 前半句必须点明事件主体（谁做了什么），不能省略主语；不要照搬标题原文，用自己的话概括核心事实
- **必须使用具体公司、产品或人名**（如 OpenAI、xAI、Anthropic、Google、Microsoft、字节跳动、Spotify、马斯克、黄仁勋）。不允许使用泛化代称：禁止"头部企业""国际巨头""大厂""科技巨头""传统软件巨头""音乐平台""某公司""一家厂商""业内人士"等。如果原文未点明主体，宁可放弃这条要点也不要用代称。
- 每个要点只围绕一个具体事件或趋势，不要把不相关的新闻强行拼在一起
- 如果多条资讯报道同一事件，合并为一个要点；但不同事件必须分开写
- 每个要点一行，50-80 字，用完整的中文句子，必须有逗号和句号等标点符号
- 中英文之间加空格（例如"OpenAI 发布"而不是"OpenAI发布"）
- 不加序号、emoji、符号，直接输出要点内容
- 每个要点之间用换行符分隔

反面示例（禁止这样写）：
头部企业诉讼案揭示训练数据合规边界，提示技术团队需建立模型蒸馏版权审查机制。 ❌ 用了"头部企业"代称
国际巨头在短期内将巨额预算投入 AI 编程工具，表明智能编码已具备显著提效价值。 ❌ 用了"国际巨头"代称
科技巨头加速并购具身智能公司表明机器人专用模型正成为竞争焦点。 ❌ 用了"科技巨头"代称
直接影响中国 AI 芯片设计公司的供应链稳定性，加速国产替代技术研发需求。 ❌ 缺少事件主体

正面示例（必须像这样写，主体具体 + 影响完整）：
xAI 在 OpenAI 诉讼案中承认 Grok 训练数据来自 ChatGPT 蒸馏，揭示大模型训练版权边界，技术团队需建立蒸馏数据审查机制。
微软花 19 亿美元采购 Cursor 企业版授权，表明 AI 编程工具已被验证可显著提效，开发者应优先重构研发工作流。
英伟达加速并购 Wayve、Skild 等具身智能公司，机器人基座模型正成为竞争焦点，从业者需重点突破跨域数据闭环。
Spotify 推出"Made by Humans"标识区分人类与 AI 生成内容，为 AIGC 溯源提供新范式，创作者需提前布局数字水印方案。
OpenAI 广告业务两月内年化营收破亿美元，大模型商业化从 API 扩展到广告分发，开发者应关注 AI 原生广告变现。
美国拟限制 ASML 深紫外光刻机对华出口，直接威胁国内 AI 芯片代工产能，从业者需加速评估国产替代方案。

${articleList}

直接输出要点，每个一行。`

  const toErrText = (err: unknown): string => {
    if (err && typeof err === 'object') {
      const anyErr = err as any
      if (typeof anyErr.error === 'string') return anyErr.error
      if (anyErr.error && typeof anyErr.error === 'object') {
        if (typeof anyErr.error.error === 'string') return anyErr.error.error
        if (typeof anyErr.error.message === 'string') return anyErr.error.message
      }
      if (typeof anyErr.message === 'string') return anyErr.message
    }
    return String(err)
  }

  let lastErr: unknown = null
  try {
    const response = await generateText({
      task: 'digest',
      prompt,
      maxTokens: 1200,
    })
    if (response.text.trim()) return pangu(response.text.trim())
    throw new Error('LLM returned empty summary')
  } catch (err) {
    lastErr = err
    console.warn(`[Digest] Executive summary failed: ${toErrText(err)}`)
  }

  // Hard fallback: generate a deterministic one-paragraph summary so the workflow doesn't block site updates.
  console.warn('[Digest] Executive summary fallback: using heuristic summary due to LLM errors:', toErrText(lastErr))
  const titles = articles
    .slice(0, 5)
    .map(a => String(a.title || '').trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .join('；')

  const fallback = `今日共收录${articles.length}条 AI 资讯。重点包括：${titles || '（暂无可用标题）'}。整体来看，大模型能力与产品化落地继续并行推进，开源生态与算力/基础设施仍是高频主题。建议关注头部模型与关键工具更新带来的研发效率、成本结构与商业化机会变化。`
  return fallback
}

function formatCNTime(utcISO: string): string {
  const d = new Date(utcISO)
  const cn = new Date(d.getTime() + 8 * 60 * 60 * 1000)
  const y = cn.getUTCFullYear()
  const m = String(cn.getUTCMonth() + 1).padStart(2, '0')
  const day = String(cn.getUTCDate()).padStart(2, '0')
  const h = String(cn.getUTCHours()).padStart(2, '0')
  const min = String(cn.getUTCMinutes()).padStart(2, '0')
  return `${y}-${m}-${day} ${h}:${min}`
}

function buildMarkdown(
  since: string,
  until: string,
  summary: string,
  articles: EnrichedArticle[],
  stats: DigestStats
): string {
  const lines: string[] = []

  // Header
  lines.push(`# AI 每日简报`)
  lines.push('')
  lines.push(`> ${formatCNTime(since)} — ${formatCNTime(until)} (UTC+8)`)
  lines.push('')

  // Stats bar
  lines.push(`> 今日收录 **${stats.total}** 条资讯 | 平均重要性 **${stats.avg_importance}/10** | 来源覆盖 ${Object.keys(stats.by_category).length} 个类别`)
  lines.push('')

  // Executive Summary
  lines.push(`## 今日总结`)
  lines.push('')
  lines.push(summary)
  lines.push('')

  // Top articles by category
  const byCategory: Record<string, EnrichedArticle[]> = {}
  for (const a of articles) {
    if (!byCategory[a.content_category]) byCategory[a.content_category] = []
    byCategory[a.content_category].push(a)
  }

  // Sort categories by total importance
  const sortedCategories = Object.entries(byCategory)
    .sort((a, b) => {
      const sumA = a[1].reduce((s, x) => s + x.importance_score, 0)
      const sumB = b[1].reduce((s, x) => s + x.importance_score, 0)
      return sumB - sumA
    })

  lines.push(`## 分类速览`)
  lines.push('')

  for (const [category, catArticles] of sortedCategories) {
    const label = categoryLabel(category as ContentCategory)
    lines.push(`### ${label} (${catArticles.length})`)
    lines.push('')

    for (const a of catArticles) {
      const score = SCORE_LABEL[a.importance_score] || `⚪ ${a.importance_score}/10`
      lines.push(`#### [${a.title}](${a.url})`)
      lines.push(`${score} | 来源: ${a.source_name}${a.author ? ` · ${a.author}` : ''}`)
      lines.push('')
      lines.push(`**摘要:** ${a.summary_zh}`)
      lines.push('')
      lines.push(`**为什么重要:** ${a.why_it_matters}`)
      if (a.tags.length > 0) {
        lines.push('')
        lines.push(`**标签:** ${a.tags.map(t => `\`${t}\``).join(' ')}`)
      }
      lines.push('')
      lines.push('---')
      lines.push('')
    }
  }

  return lines.join('\n')
}

// ---- LLM-assisted deduplication ----

export async function deduplicateArticles(articles: EnrichedArticle[]): Promise<EnrichedArticle[]> {
  if (articles.length <= 5) return articles

  const titleList = articles
    .map((a, i) => `${i}: ${a.title}`)
    .join('\n')

  const prompt = `你是一个新闻去重助手。以下是一组 AI 新闻标题，请找出报道同一事件的文章组。

规则：
- 只有确实报道同一个具体事件的才算重复（例如"OpenAI 发布 GPT-5"和"GPT-5 正式推出"是重复的）
- 不同角度的评论文章不算重复
- 泛泛类似的主题不算重复（例如两篇都关于 AI 安全但讨论不同事件，不算重复）

${titleList}

返回严格 JSON 格式，列出重复组（每组包含重复文章的序号数组），没有重复则返回空数组：
{"groups": [[0, 5, 12], [3, 7]]}`

  try {
    const response = await generateJson({
      task: 'digest',
      prompt,
      maxTokens: 300,
    })

    const jsonMatch = response.text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return articles

    const parsed = JSON.parse(jsonMatch[0]) as { groups?: number[][] }
    if (!Array.isArray(parsed.groups) || parsed.groups.length === 0) return articles

    // For each group, keep the article with highest importance_score
    const removedIndices = new Set<number>()
    for (const group of parsed.groups) {
      if (!Array.isArray(group) || group.length < 2) continue

      const validIndices = group.filter(i => typeof i === 'number' && i >= 0 && i < articles.length)
      if (validIndices.length < 2) continue

      // Find the best article in the group (highest score, then earliest published)
      let bestIdx = validIndices[0]
      for (const idx of validIndices.slice(1)) {
        const current = articles[idx]
        const best = articles[bestIdx]
        if (
          current.importance_score > best.importance_score ||
          (current.importance_score === best.importance_score &&
            new Date(current.published_at || 0) < new Date(best.published_at || 0))
        ) {
          bestIdx = idx
        }
      }

      // Remove all but the best
      for (const idx of validIndices) {
        if (idx !== bestIdx) removedIndices.add(idx)
      }
    }

    if (removedIndices.size > 0) {
      console.log(`[Digest] Dedup removed ${removedIndices.size} duplicate articles`)
    }

    return articles.filter((_, i) => !removedIndices.has(i))
  } catch (err) {
    console.warn('[Digest] Dedup failed (non-fatal), using all articles:', err)
    return articles
  }
}
