-- ======================================================
-- Migration 007: follow-builders 数据源融合
-- - sources.type CHECK 加 'feed' 值（zarazhangrui/follow-builders 中央 JSON feed）
-- - INSERT 3 行 sources 让 enriched_articles 视图 INNER JOIN 不丢 builder 文章
-- - articles 加 is_active 字段支持软删除回滚（spec §11）
-- - 重建 enriched_articles 视图加 WHERE is_active = true 过滤
-- ======================================================

-- 1. ALTER sources.type CHECK 加 'feed'
ALTER TABLE sources DROP CONSTRAINT sources_type_check;
ALTER TABLE sources ADD CONSTRAINT sources_type_check
  CHECK (type IN ('rss', 'api', 'scraper', 'twitter', 'feed'));

-- 2. INSERT 3 行 sources（INNER JOIN 兜底）
INSERT INTO sources (slug, name, type, category, url, home_url, is_active, priority) VALUES
  ('follow-builders-x',
   'Follow Builders · X',
   'feed', 'person',
   'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-x.json',
   'https://github.com/zarazhangrui/follow-builders',
   true, 5),
  ('follow-builders-podcasts',
   'Follow Builders · Podcasts',
   'feed', 'media',
   'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-podcasts.json',
   'https://github.com/zarazhangrui/follow-builders',
   true, 5),
  ('follow-builders-blogs',
   'Follow Builders · Blogs',
   'feed', 'official',
   'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-blogs.json',
   'https://github.com/zarazhangrui/follow-builders',
   true, 6)
ON CONFLICT (slug) DO NOTHING;

-- 3. ALTER articles 加 is_active 支持软删除
ALTER TABLE articles ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS articles_is_active_idx ON articles(is_active) WHERE is_active = false;

-- 4. 重建 enriched_articles 视图加 is_active 过滤
DROP VIEW IF EXISTS enriched_articles;
CREATE VIEW enriched_articles AS
SELECT
  a.id,
  a.source_slug,
  a.source_name,
  a.title,
  a.url,
  a.author,
  a.published_at,
  a.crawled_at,
  s.category  AS source_category,
  s.priority  AS source_priority,
  pa.summary_zh,
  pa.category AS content_category,
  pa.tags,
  pa.importance_score,
  pa.why_it_matters,
  pa.processed_at
FROM articles a
JOIN processed_articles pa ON pa.article_id = a.id
JOIN sources s ON s.slug = a.source_slug
WHERE a.is_active = true   -- v2 新增过滤，让回滚软删除生效
ORDER BY pa.importance_score DESC, a.published_at DESC;
