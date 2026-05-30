'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_ITEMS = [
  { href: '/', label: 'News' },
  { href: '/digest', label: 'Digest' },
]

export default function NavLinks() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* Desktop nav */}
      <ul className="hidden md:flex items-center gap-8">
        {NAV_ITEMS.map(({ href, label }) => {
          const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href)
          return (
            <li key={href}>
              <Link
                href={href}
                className={`text-[13px] tracking-widest font-medium uppercase transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2 rounded-sm ${
                  isActive
                    ? 'text-gray-900'
                    : 'text-gray-400 hover:text-gray-900'
                }`}
              >
                {label}
              </Link>
            </li>
          )
        })}
      </ul>

      {/* Mobile: hamburger button */}
      <button
        className="md:hidden flex flex-col gap-[5px] p-2 -mr-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111] focus-visible:ring-offset-2 rounded-sm"
        onClick={() => setOpen(v => !v)}
        aria-label={open ? '关闭菜单' : '打开菜单'}
        aria-expanded={open}
      >
        <span className={`block w-5 h-px bg-[#111] transition-transform duration-200 ${open ? 'translate-y-[6px] rotate-45' : ''}`} />
        <span className={`block w-5 h-px bg-[#111] transition-opacity duration-200 ${open ? 'opacity-0' : ''}`} />
        <span className={`block w-5 h-px bg-[#111] transition-transform duration-200 ${open ? '-translate-y-[6px] -rotate-45' : ''}`} />
      </button>

      {/* Mobile: dropdown menu */}
      {open && (
        <div className="md:hidden absolute top-16 left-0 right-0 bg-white/95 backdrop-blur-md border-b border-gray-200 z-50">
          <ul className="max-w-6xl mx-auto px-6 py-4 flex flex-col gap-1">
            {NAV_ITEMS.map(({ href, label }) => {
              const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href)
              return (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={() => setOpen(false)}
                    className={`block py-3 text-[13px] tracking-widest uppercase font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2 rounded-sm ${
                      isActive ? 'text-gray-900' : 'text-gray-400 hover:text-gray-900'
                    }`}
                  >
                    {label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </>
  )
}
