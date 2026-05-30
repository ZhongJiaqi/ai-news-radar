import { test, expect } from '@playwright/test'

// Dark "Radar Terminal" redesign — News (/digest) + History (/history).
// Assertions are data-independent (nav + chrome render regardless of feed data).

test('home redirects to News and renders radar chrome', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/digest$/)

  // Brand visible.
  await expect(page.getByRole('link', { name: 'AI Radar' })).toBeVisible()
  // The redesigned radar nav exposes exactly two items — News + History, no Models.
  await expect(page.locator('.radar-navlinks a')).toHaveText(['News', 'History'])

  // Hero eyebrow always renders.
  await expect(page.getByText('Daily Briefing').first()).toBeVisible()
})

test('News links through to History', async ({ page }) => {
  await page.goto('/digest')
  await page.getByRole('link', { name: 'History', exact: true }).click()
  await expect(page).toHaveURL(/\/history(\/\d{4}-\d{2}-\d{2})?$/)

  // History chrome: active nav + archive rail label.
  await expect(page.getByRole('link', { name: 'History', exact: true })).toBeVisible()
  await expect(page.getByText('Archive').first()).toBeVisible()
})
