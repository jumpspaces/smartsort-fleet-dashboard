import { expect, test, type Page } from '@playwright/test'

const API = process.env.E2E_API ?? 'http://localhost:3299'
const EMAIL = process.env.E2E_EMAIL ?? 'e2e@jumpspaces.co'
const PASSWORD = process.env.E2E_PASSWORD ?? 'e2e-password-123'

// The production build bakes in the live server as the default address.
// These tests must never talk to it: always set the address explicitly.
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(API)) throw new Error(`E2E_API must be a local server, got ${API}`)

async function signIn(page: Page) {
  await page.goto('/')
  const change = page.getByRole('button', { name: 'Change server' })
  if (await change.isVisible()) await change.click()
  await page.getByLabel('Server address').fill(API)
  await page.getByLabel('Email').fill(EMAIL)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible()
}

test.describe.configure({ mode: 'serial' })

test('signs in and shows what needs attention, one line per problem per shop', async ({ page }) => {
  await signIn(page)
  const card = page.locator('section', { hasText: 'Needs attention' })
  await expect(card.getByText('Osu Pharmacy')).toBeVisible()
  // Two offline tills in one shop read as one problem.
  await expect(card.locator('[data-nav]', { hasText: 'Not connected' }).filter({ hasText: 'e2e-osu' })).toHaveCount(1)
  await expect(page.getByRole('region', { name: 'Fleet status' })).toContainText('3 offline')
})

test('filters tills and opens one', async ({ page }) => {
  await signIn(page)
  await page.getByRole('region', { name: 'Fleet status' }).getByRole('link', { name: /offline/ }).click()
  await expect(page).toHaveURL(/#\/tills\?state=offline/)
  await expect(page.locator('main tbody tr')).toHaveCount(3)
  await page.getByRole('link', { name: 'Till e2e-osu-1' }).click()
  await expect(page.getByRole('heading', { name: /Till e2e-osu-1/ })).toBeVisible()
  await expect(page.getByText('Not connected').first()).toBeVisible()
})

test('labels and notes a till', async ({ page }) => {
  await signIn(page)
  await page.goto('/#/tills/e2e-tema-1')
  await page.getByLabel('Add a label').fill('e2e')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Remove label e2e' })).toBeVisible()
  await page.getByLabel('Add a note').fill('Router swap on Friday')
  await page.getByRole('button', { name: 'Add note' }).click()
  await expect(page.locator('main li', { hasText: 'Router swap on Friday' })).toBeVisible()
})

test('takes an alert from the keyboard', async ({ page }) => {
  await signIn(page)
  await page.goto('/#/alerts')
  const first = page.locator('main [data-nav]').first()
  await expect(first).toBeVisible()
  const before = await page.locator('main [data-nav]').count()
  await page.keyboard.press('j')
  await expect(first).toHaveAttribute('data-nav-active', '')
  await page.keyboard.press('a')
  await expect(page.locator('main [data-nav]')).toHaveCount(before - 1)
})

test('sets up a shop and stocks it', async ({ page }) => {
  await signIn(page)
  await page.goto('/#/shops')
  await page.getByRole('button', { name: 'New shop' }).click()
  const dialog = page.locator('dialog[open]')
  await dialog.getByLabel('Shop name').fill(`E2E Shop ${Date.now()}`)
  await dialog.getByLabel('Kind of business').selectOption('pharmacy')
  await dialog.getByLabel("Owner's name").fill('Kofi E2E')
  await dialog.getByLabel("Owner's staff ID").fill(`E2E${Date.now() % 100000}`)
  await dialog.getByRole('button', { name: 'Create shop' }).click()
  await expect(dialog.locator('code')).toBeVisible()
  await dialog.getByRole('link', { name: 'Open the shop' }).click()
  await page.getByRole('link', { name: 'Stock', exact: true }).click()
  await page.getByRole('button', { name: 'Add a product' }).click()
  const add = page.locator('dialog[open]')
  await add.getByLabel('Name', { exact: true }).fill('Paracetamol 500mg')
  await add.getByLabel(/Selling price/).fill('5.00')
  await add.getByLabel('Opening stock').fill('40')
  await add.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.locator('tr', { hasText: 'Paracetamol 500mg' })).toContainText('40')
})

test('goes anywhere with Ctrl+K', async ({ page }) => {
  await signIn(page)
  await page.keyboard.press('Control+k')
  await page.getByPlaceholder('Go to a page, shop or till…').fill('backu')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/#\/backups/)
})

test('reads on a phone without sideways scrolling @phone', async ({ page }) => {
  await signIn(page)
  for (const path of ['/#/', '/#/tills', '/#/tills/e2e-osu-1', '/#/shops']) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
    expect(overflow, `${path} scrolls sideways`).toBe(false)
  }
})
