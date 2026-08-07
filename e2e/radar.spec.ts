import { test, expect } from '@playwright/test'

// Dark "Radar Terminal" redesign — News (/digest) + Archive (/archive).
// Assertions are data-independent (nav + chrome render regardless of feed data).

test('home redirects to News and renders radar chrome', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/digest$/)

  // Brand visible.
  await expect(page.getByRole('link', { name: 'AI Radar' })).toBeVisible()
  // The redesigned radar nav exposes exactly two items — News + Archive, no Models.
  await expect(page.locator('.radar-navlinks a')).toHaveText(['News', 'Archive'])

  // Hero eyebrow always renders.
  await expect(page.getByText('Daily Briefing').first()).toBeVisible()
})

test('News links through to Archive', async ({ page }) => {
  await page.goto('/digest')
  await page.getByRole('link', { name: 'Archive', exact: true }).click()
  await expect(page).toHaveURL(/\/archive(\/\d{4}-\d{2}-\d{2})?$/)

  // Archive chrome: active nav + archive rail label.
  await expect(page.getByRole('link', { name: 'Archive', exact: true })).toBeVisible()
  await expect(page.getByText('Archive').first()).toBeVisible()
})
