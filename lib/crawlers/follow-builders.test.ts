import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { transformTweets, transformPodcasts, transformBlogs } from './follow-builders'

test('transformTweets: 单 author 多 tweets → 多 ArticleInput', () => {
  const feed = {
    generatedAt: '2026-06-19T08:14:32.084Z',
    lookbackHours: 24,
    x: [
      {
        source: 'x',
        name: 'Sam Altman',
        handle: 'sama',
        bio: 'CEO @openai',
        tweets: [
          {
            id: '1',
            text: 'Sora 2 is live. Try it at sora.com',
            createdAt: '2026-06-19T00:22:40.000Z',
            url: 'https://x.com/sama/status/1',
            likes: 1000, retweets: 100, replies: 50, isQuote: false,
          },
          {
            id: '2',
            text: 'GPT-5 ships next week. Long context, much better tool use.',
            createdAt: '2026-06-18T20:00:00.000Z',
            url: 'https://x.com/sama/status/2',
            likes: 2000, retweets: 300, replies: 100, isQuote: false,
          },
        ],
      },
    ],
  }
  const rows = transformTweets(feed)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].source_slug, 'follow-builders-x')
  assert.equal(rows[0].source_name, 'X: @sama')
  assert.equal(rows[0].author, 'Sam Altman')
  assert.equal(rows[0].url, 'https://x.com/sama/status/1')
  assert.equal(rows[0].title, 'Sora 2 is live. Try it at sora.com')
  assert.equal(rows[0].content, 'Sora 2 is live. Try it at sora.com')
  assert.equal(rows[0].is_active, true)
})

test('transformTweets: title 切到 100 code point', () => {
  const longText = 'A'.repeat(200)
  const feed = {
    x: [{
      name: 'Test', handle: 'test', tweets: [{
        id: '1', text: longText,
        createdAt: '2026-06-19T00:00:00.000Z',
        url: 'https://x.com/test/status/1',
      }],
    }],
  }
  const rows = transformTweets(feed as any)
  assert.equal(rows[0].title.length, 100)
  assert.equal(rows[0].content, longText) // content 是完整 text
})

test('transformTweets: tweet.text 几乎空（< 10 字符）→ 跳过不入库', () => {
  const feed = {
    x: [{
      name: 'Test', handle: 'test', tweets: [
        {
          id: '1', text: '👍',
          createdAt: '2026-06-19T00:00:00.000Z',
          url: 'https://x.com/test/status/1',
        },
        {
          id: '2', text: 'This one is long enough to keep.',
          createdAt: '2026-06-19T00:00:00.000Z',
          url: 'https://x.com/test/status/2',
        },
      ],
    }],
  }
  const rows = transformTweets(feed as any)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].title, 'This one is long enough to keep.')
})

test('transformPodcasts: episode → ArticleInput', () => {
  const feed = {
    generatedAt: '2026-06-19T08:15:07.623Z',
    lookbackHours: 336,
    podcasts: [{
      source: 'podcast',
      name: 'Latent Space',
      title: 'Inside Cursor',
      guid: 'abc-123',
      url: 'https://www.youtube.com/watch?v=abc',
      publishedAt: '2026-06-18T11:30:00.000Z',
      transcript: `Speaker 1 | 00:00 - 00:36
Welcome to the show.

Speaker 2 | 00:36 - 01:00
Today we're talking about Cursor's growth.`,
    }],
  }
  const rows = transformPodcasts(feed)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].source_slug, 'follow-builders-podcasts')
  assert.equal(rows[0].source_name, 'Podcast: Latent Space')
  assert.equal(rows[0].title, 'Inside Cursor')
  assert.equal(rows[0].url, 'https://www.youtube.com/watch?v=abc')
  assert.equal(rows[0].author, 'Latent Space')
  assert.ok(rows[0].content.includes('Welcome to the show'))
  assert.ok(rows[0].content.includes("Today we're talking"))
})

test('transformPodcasts: 空 transcript → content 空但仍入库', () => {
  const feed = {
    podcasts: [{
      name: 'Test', title: 'Episode 1', guid: 'g', url: 'https://x.test/1',
      publishedAt: '2026-06-19T00:00:00.000Z', transcript: '',
    }],
  }
  const rows = transformPodcasts(feed as any)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].content, '')
  assert.equal(rows[0].title, 'Episode 1')
})

test('transformBlogs: blog post → ArticleInput', () => {
  const feed = {
    blogs: [{
      source: 'blog',
      name: 'Anthropic Engineering',
      title: 'Building Claude Code',
      url: 'https://www.anthropic.com/engineering/building-claude-code',
      publishedAt: '2026-06-15T00:00:00.000Z',
      author: 'Boris Cherny',
      description: 'Lessons learned...',
      content: 'Full article content here, several thousand chars...',
    }],
  }
  const rows = transformBlogs(feed)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].source_slug, 'follow-builders-blogs')
  assert.equal(rows[0].source_name, 'Blog: Anthropic Engineering')
  assert.equal(rows[0].author, 'Boris Cherny')
  assert.equal(rows[0].content, 'Full article content here, several thousand chars...')
})

test('transformBlogs: 无 author → 用 name 作 author', () => {
  const feed = {
    blogs: [{
      name: 'Claude', title: 'Post', url: 'https://claude.com/blog/post',
      publishedAt: '2026-06-19T00:00:00.000Z', content: 'body',
    }],
  }
  const rows = transformBlogs(feed as any)
  assert.equal(rows[0].author, 'Claude')
})
