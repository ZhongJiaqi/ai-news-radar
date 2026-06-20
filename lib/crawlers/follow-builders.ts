// Follow-Builders feed transform 纯函数。
// 把 zarazhangrui/follow-builders 的 3 份 JSON feed 转成 ai-news-radar
// articles 表的 ArticleInput 格式。
//
// Type guards 用宽松（部分字段可能 undefined），实际 schema 参考
// docs/superpowers/specs/2026-06-20-follow-builders-integration-design.html §5.2

import { sliceByCodePoints } from '../utils/sliceByCodePoints'
import { extractIntro } from '../utils/extractIntro'

export interface ArticleInput {
  source_slug: string
  source_name: string
  title: string
  url: string
  content: string
  author: string
  published_at: string
  is_active: boolean
}

// ============ Feed JSON 类型（宽松） ============

interface XTweet {
  id: string
  text: string
  createdAt: string
  url: string
  likes?: number
  retweets?: number
  replies?: number
  isQuote?: boolean
}

interface XAuthor {
  name: string
  handle: string
  bio?: string
  tweets: XTweet[]
}

export interface FeedXJson {
  generatedAt?: string
  lookbackHours?: number
  x: XAuthor[]
}

interface PodcastEpisode {
  name: string         // 频道名（如 "Latent Space"）
  title: string        // 集名
  guid?: string
  url: string
  publishedAt: string
  transcript: string
}

export interface FeedPodcastsJson {
  generatedAt?: string
  lookbackHours?: number
  podcasts: PodcastEpisode[]
}

interface BlogPost {
  name: string         // 博客名（如 "Anthropic Engineering"）
  title: string
  url: string
  publishedAt: string
  author?: string
  description?: string
  content: string
}

export interface FeedBlogsJson {
  generatedAt?: string
  blogs: BlogPost[]
}

// ============ Transform 函数 ============

const TITLE_MAX_CODE_POINTS = 100
const TWEET_MIN_TEXT_LEN = 10

export function transformTweets(feed: FeedXJson): ArticleInput[] {
  const rows: ArticleInput[] = []
  for (const author of feed.x || []) {
    for (const tweet of author.tweets || []) {
      const text = (tweet.text || '').trim()
      if (text.length < TWEET_MIN_TEXT_LEN) continue  // 跳过几乎空的 tweet
      rows.push({
        source_slug: 'follow-builders-x',
        source_name: `X: @${author.handle}`,
        title: sliceByCodePoints(text, TITLE_MAX_CODE_POINTS),
        url: tweet.url,
        content: text,
        author: author.name,
        published_at: tweet.createdAt,
        is_active: true,
      })
    }
  }
  return rows
}

export function transformPodcasts(feed: FeedPodcastsJson): ArticleInput[] {
  const rows: ArticleInput[] = []
  for (const ep of feed.podcasts || []) {
    rows.push({
      source_slug: 'follow-builders-podcasts',
      source_name: `Podcast: ${ep.name}`,
      title: ep.title,
      url: ep.url,
      content: extractIntro(ep.transcript || ''),
      author: ep.name,
      published_at: ep.publishedAt,
      is_active: true,
    })
  }
  return rows
}

export function transformBlogs(feed: FeedBlogsJson): ArticleInput[] {
  const rows: ArticleInput[] = []
  for (const post of feed.blogs || []) {
    rows.push({
      source_slug: 'follow-builders-blogs',
      source_name: `Blog: ${post.name}`,
      title: post.title,
      url: post.url,
      content: post.content || '',
      author: post.author || post.name,
      published_at: post.publishedAt,
      is_active: true,
    })
  }
  return rows
}
