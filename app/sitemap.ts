import { MetadataRoute } from 'next'
import { createPublicClient } from '@/lib/supabase'
import { getSiteUrl } from '@/lib/site'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = getSiteUrl()
  const supabase = createPublicClient()

  // Fetch last 30 digest dates
  const { data: digests } = await supabase
    .from('daily_digests')
    .select('date')
    .order('date', { ascending: false })
    .limit(30)

  const digestEntries: MetadataRoute.Sitemap = (digests ?? []).map(d => ({
    url: `${siteUrl}/history/${d.date}`,
    lastModified: new Date(`${d.date}T08:00:00+08:00`),
    changeFrequency: 'never' as const,
    priority: 0.7,
  }))

  return [
    {
      url: siteUrl,
      lastModified: new Date(),
      changeFrequency: 'hourly',
      priority: 1.0,
    },
    {
      url: `${siteUrl}/digest`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.8,
    },
    ...digestEntries,
  ]
}
