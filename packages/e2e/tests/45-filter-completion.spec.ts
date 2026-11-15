// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Gokhan OZGEZER
import type { Page } from '@playwright/test'
import { MongoClient } from 'mongodb'
import { expect, signIn, test } from '../fixtures'

/**
 * User report 2026-11-07: in the filter, "cod" and Enter wrote { code: | }, but the name typed in
 * full ran the bare name and failed. A field typed in full is still offered, its values follow, and
 * a filter written without its braces runs. The data is invented.
 */
const DB = 'filtercompletion'
const COLL = 'parcels'

test.beforeAll(async () => {
  const client = new MongoClient(process.env.MM_E2E_MONGO_URI!)
  try {
    const db = client.db(DB)
    await db.dropDatabase()
    await db.collection(COLL).insertMany([
      { code: 'PX-100', weight: 2 },
      { code: 'PX-200', weight: 5 },
      { code: 'PX-300', weight: 9 },
    ])
  } finally {
    await client.close()
  }
})

async function openCollection(page: Page): Promise<void> {
  await signIn(page)
  await expect(page.getByRole('button', { name: /^Account menu/ })).toBeVisible()
  const list = (await (await page.request.get('api/connections')).json()) as Array<{
    id: string
    name: string
  }>
  const id = list.find((c) => c.name === 'Local test')!.id
  await page.goto(`c/${id}/db/${DB}/coll/${COLL}`)
  await expect(page.getByRole('button', { name: /^Open document / })).toHaveCount(3)
}

const rows = (page: Page) => page.getByRole('button', { name: /^Open document / })

test('a field typed in full is written as a document, and its values follow', async ({ page }) => {
  await openCollection(page)
  const box = page.getByRole('textbox', { name: 'Filter', exact: true })
  await box.click()
  await page.keyboard.type('code')
  const list = page.getByRole('listbox')
  await expect(list.getByRole('option').first()).toContainText('code')
  await page.keyboard.press('Enter')
  await expect(box).toHaveValue('{ code:  }')
  // Nothing ran: no error under the bar, the three documents still shown.
  await expect(page.getByText(/Syntax error|line 1/)).toHaveCount(0)
  await expect(rows(page)).toHaveCount(3)
  // The values seen for the field are offered at once.
  await expect(list.getByRole('option')).toHaveCount(3)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(box).toHaveValue('{ code: "PX-200" }')
  await page.keyboard.press('Enter')
  await expect(rows(page)).toHaveCount(1)
})

test('the values seen for a field are offered once its colon is typed', async ({ page }) => {
  await openCollection(page)
  const box = page.getByRole('textbox', { name: 'Filter', exact: true })
  await box.click()
  await box.pressSequentially('{ weight:')
  await page.keyboard.press('Escape')
  await page.keyboard.type(' ')
  const list = page.getByRole('listbox')
  await expect(list.getByRole('option')).toHaveCount(3)
  await page.keyboard.type('9')
  await expect(list).toHaveCount(0)
  await page.keyboard.press('Enter')
  await expect(rows(page)).toHaveCount(1)
})

test('Tab completes as Enter does, and the word before the caret while no list shows', async ({ page }) => {
  await openCollection(page)
  const box = page.getByRole('textbox', { name: 'Filter', exact: true })
  await box.click()
  await page.keyboard.type('wei')
  await page.keyboard.press('Tab')
  await expect(box).toBeFocused()
  await expect(box).toHaveValue('{ weight:  }')
  await page.keyboard.press('Escape')
  await page.keyboard.type('5, cod')
  await page.keyboard.press('Escape')
  // The list closed, the caret moved away and back: Tab still completes the word.
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Tab')
  await expect(box).toHaveValue('{ weight: 5, code:  }')
})

test('a filter written without its braces runs', async ({ page }) => {
  await openCollection(page)
  const box = page.getByRole('textbox', { name: 'Filter', exact: true })
  await box.fill('weight: { $gt: 4 }')
  await box.press('Enter')
  await expect(rows(page)).toHaveCount(2)
})

// User report 2026-11-11: a field chosen, a quote typed came alone, and the closing one typed after
// the name came twice and broke the filter.
test('quotes typed for a value: one pair, the closing one steps over, and the filter runs', async ({
  page,
}) => {
  await openCollection(page)
  const box = page.getByRole('textbox', { name: 'Filter', exact: true })
  await box.click()
  await page.keyboard.type('code')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(3)
  await page.keyboard.type('"')
  await expect(box).toHaveValue('{ code: "" }')
  await page.keyboard.type('PX-300"')
  await expect(box).toHaveValue('{ code: "PX-300" }')
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await page.keyboard.press('Enter')
  await expect(rows(page)).toHaveCount(1)
})

// User report 2026-11-11: a document changed by another app, and Find showed it as it was; only
// reloading the page read it again.
test('Find reads the documents again after another app changed them', async ({ page }) => {
  await openCollection(page)
  const box = page.getByRole('textbox', { name: 'Filter', exact: true })
  await box.fill('{ code: "PX-100" }')
  await page.getByRole('button', { name: 'Find', exact: true }).click()
  await expect(rows(page)).toHaveCount(1)
  await expect(page.locator('tbody')).toContainText('2')
  const client = new MongoClient(process.env.MM_E2E_MONGO_URI!)
  try {
    await client
      .db(DB)
      .collection(COLL)
      .updateOne({ code: 'PX-100' }, { $set: { weight: 77 } })
  } finally {
    await client.close()
  }
  await page.getByRole('button', { name: 'Find', exact: true }).click()
  await expect(page.locator('tbody')).toContainText('77')
  await expect(rows(page)).toHaveCount(1)
})

// User request 2026-11-12 (as in Compass): a click in the empty filter lists the queries run before
// on the collection, to choose one from.
test('a click in the empty filter lists the queries run before, and the one chosen runs', async ({
  page,
}) => {
  await openCollection(page)
  const box = page.getByRole('textbox', { name: 'Filter', exact: true })
  await box.fill('{ weight: 5 }')
  await box.press('Enter')
  await expect(rows(page)).toHaveCount(1)
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await expect(rows(page)).toHaveCount(3)
  await expect(box).toHaveValue('')
  await box.click()
  const list = page.getByRole('listbox')
  // Named by its filter: the sort the tab opened with (newest first) is no part written.
  await expect(list.getByRole('option').first()).toHaveText(/^\{ weight: 5 \}\s*recent query$/)
  await page.screenshot({ path: 'test-results/recent-in-filter-open.png' })
  // Enter as it opens runs the empty filter: none is chosen until an arrow key chooses one.
  await page.keyboard.press('Enter')
  await expect(list).toHaveCount(0)
  await expect(rows(page)).toHaveCount(3)
  // The arrow down brings them back, the newest chosen.
  await page.keyboard.press('ArrowDown')
  await expect(list.getByRole('option').first()).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Enter')
  await expect(box).toHaveValue('{ weight: 5 }')
  await expect(rows(page)).toHaveCount(1)
  await expect(page.getByRole('button', { name: /^Options(, \d+ set)?$/ })).toHaveAttribute(
    'aria-expanded',
    'false',
  )
  await page.screenshot({ path: 'test-results/recent-in-filter.png' })
})
