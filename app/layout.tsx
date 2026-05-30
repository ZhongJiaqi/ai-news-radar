import type { Metadata } from 'next'
import { Outfit, JetBrains_Mono } from 'next/font/google'
import Link from 'next/link'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'
import NavClock from '@/components/NavClock'
import NavLinks from '@/components/NavLinks'
import { getSiteUrl } from '@/lib/site'

const outfit = Outfit({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-outfit',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono-jb',
})

const siteUrl = getSiteUrl()

export const metadata: Metadata = {
  title: {
    default: 'AI News — Daily AI Briefing',
    template: '%s | AI RADAR',
  },
  description: '每日聚合分析全球最重要的 AI 资讯，帮助 AI 从业者在 3 分钟内掌握行业动态',
  metadataBase: new URL(siteUrl),
  openGraph: {
    type: 'website',
    locale: 'zh_CN',
    siteName: 'AI RADAR',
    title: 'AI News — Daily AI Briefing',
    description: '每日聚合分析全球最重要的 AI 资讯，帮助 AI 从业者在 3 分钟内掌握行业动态',
    url: siteUrl,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AI News — Daily AI Briefing',
    description: '每日聚合分析全球最重要的 AI 资讯，帮助 AI 从业者在 3 分钟内掌握行业动态',
  },
  robots: {
    index: true,
    follow: true,
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN">
      <body
        className={`${outfit.variable} ${jetbrainsMono.variable} font-sans bg-[#0A0D0E] text-[#E9EBE8] min-h-screen`}
      >
        <nav className="root-nav sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-200/60 relative">
          <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2">
              <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="#1A1A1A" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="2" fill="#1A1A1A" stroke="none" />
                <path d="M4.93 4.93a10 10 0 0 0 0 14.14" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                <path d="M7.76 7.76a6 6 0 0 0 0 8.49" />
                <path d="M16.24 7.76a6 6 0 0 1 0 8.49" />
              </svg>
              <span className="font-semibold tracking-wider text-sm uppercase text-[#1A1A1A]">AI Radar</span>
            </Link>
            <NavLinks />
            <NavClock />
          </div>
        </nav>
        <main className="root-main max-w-6xl mx-auto px-6 py-10">
          {children}
        </main>
        <footer className="root-footer text-center py-8 font-mono text-[0.68rem] text-gray-400 border-t border-gray-200 mt-8 tracking-widest uppercase">
          AI News — Daily AI Briefing
        </footer>
        <Analytics />
      </body>
    </html>
  )
}
