// ======================================================
// AI Radar - Global TypeScript Types
// ======================================================

export type SourceType = 'rss' | 'api' | 'scraper' | 'twitter' | 'youtube'
export type SourceCategory = 'official' | 'community' | 'person' | 'media'

export type ContentCategory =
  | 'model_release'
  | 'product_tool'
  | 'research_paper'
  | 'industry_news'
  | 'funding_ma'
  | 'policy_regulation'
  | 'open_source'
  | 'opinion_insight'

export const CONTENT_CATEGORIES: ContentCategory[] = [
  'model_release', 'product_tool', 'research_paper',
  'industry_news', 'funding_ma', 'policy_regulation',
  'open_source', 'opinion_insight',
]

// ---- Database row types ----

export interface Source {
  id: string
  slug: string
  name: string
  type: SourceType
  category: SourceCategory
  url: string
  home_url?: string
  is_active: boolean
  priority: number
  last_crawled_at?: string
  created_at: string
}

export interface Article {
  id: string
  source_id?: string
  source_slug: string
  source_name: string
  title: string
  url: string
  content?: string
  author?: string
  published_at?: string
  crawled_at: string
  is_processed: boolean
}

export interface ProcessedArticle {
  id: string
  article_id: string
  summary_zh: string
  category: ContentCategory
  tags: string[]
  importance_score: number
  why_it_matters: string
  model_used: string
  processed_at: string
}

export interface DailyDigest {
  id: string
  date: string
  content_md: string
  top_article_ids: string[]
  stats: DigestStats
  generated_at: string
}

export interface DigestStats {
  total: number
  by_category: Record<string, number>
  avg_importance: number
  /**
   * Marker set by the digest cron (since 2026-05-30) to say
   * `top_article_ids` is the LLM-deduplicated top 30. Older rows
   * lack this and need a live dedup pass at read time.
   */
  dedup_applied?: boolean
  /**
   * Executive summary derived from the *top 8* dedup'd articles
   * — used by /digest's "今日要点" SIG grid so the grid matches
   * what's shown below (Top Stories 3 + More Signals 5). The
   * `## 今日总结` block in `content_md` still covers the top 30
   * dedup'd articles (used by /history's lede). Newline-joined
   * 4–8 short Chinese bullets (no leading "-").
   */
  summary_top8?: string
}

// ---- Enriched view (joined) ----

export interface EnrichedArticle {
  id: string
  source_slug: string
  source_name: string
  title: string
  url: string
  author?: string
  published_at?: string
  crawled_at: string
  source_category: SourceCategory
  source_priority: number
  summary_zh: string
  content_category: ContentCategory
  tags: string[]
  importance_score: number
  why_it_matters: string
  processed_at: string
}

// ---- Crawler raw output ----

export interface RawArticle {
  source_slug: string
  source_name: string
  title: string
  url: string
  content?: string
  author?: string
  published_at?: Date
}

// ---- LLM processor output ----

export interface LLMResult {
  summary_zh: string
  category: ContentCategory
  tags: string[]
  importance_score: number
  why_it_matters: string
}

// ---- Source config (static) ----

export interface SourceConfig {
  slug: string
  name: string
  type: SourceType
  category: SourceCategory
  url: string
  home_url?: string
  priority: number
  // For twitter
  twitter_username?: string
}
