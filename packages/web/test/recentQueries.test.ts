// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Gokhan OZGEZER
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import DocumentsView from '../src/documents/DocumentsView.vue'
import DialogHost from '../src/ds/DsConfirmHost.vue'
import { useCollectionViewsStore } from '../src/stores/collectionViews'
import { i18n } from '../src/i18n'
import { mockApi, mountApp, type Handler } from './support/app'
import { button, byLabel } from './support/dom'

beforeEach(() => {
  setActivePinia(createPinia())
  i18n.global.locale.value = 'en'
})
afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

const PREFIX = 'connections/c1/databases/shop/collections/orders'

async function view(recent: unknown[], extra: Record<string, Handler> = {}) {
  let list = recent
  const api = mockApi({
    [`POST ${PREFIX}/find`]: () => [200, { documents: [], hasMore: false }],
    [`POST ${PREFIX}/count`]: () => [200, { count: 0, exact: true }],
    [`GET ${PREFIX}/recent-queries`]: () => [200, { queries: list }],
    [`DELETE ${PREFIX}/recent-queries`]: () => {
      list = []
      return [204, undefined]
    },
    ...extra,
  })
  useCollectionViewsStore().stateFor('t')
  mountApp(DocumentsView, {
    props: {
      target: { connectionId: 'c1', db: 'shop', coll: 'orders' },
      tabId: 't',
      canWrite: true,
      isView: false,
    },
  })
  mountApp(DialogHost)
  await flushPromises()
  return api
}

const entries = () => [...document.querySelectorAll<HTMLButtonElement>('[data-test="recent-query"]')]

describe('recent queries (phase 1g-1)', () => {
  it('lists them on request and runs the one picked, filling the query bar', async () => {
    const { calls } = await view([
      {
        query: { filter: { qty: { $lt: { $numberInt: '30' } } }, sort: { qty: { $numberInt: '-1' } } },
        usedAt: 2,
      },
      { query: { filter: { name: 'Ada' } }, usedAt: 1 },
    ])
    button('Recent queries').click()
    await flushPromises()
    expect(entries().map((e) => e.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      '{ qty: { $lt: 30 } } sort: { qty: -1 }',
      '{ name: "Ada" }',
    ])
    entries()[0]!.click()
    await flushPromises()
    expect(useCollectionViewsStore().stateFor('t').draft).toMatchObject({
      filter: '{ qty: { $lt: 30 } }',
      sort: '{ qty: -1 }',
    })
    expect(calls.filter((c) => c.path.endsWith('/find')).at(-1)!.body).toMatchObject({
      filter: { qty: { $lt: { $numberInt: '30' } } },
      sort: { qty: { $numberInt: '-1' } },
    })
    expect(entries()).toHaveLength(0) // the list closed
  })

  it('shows an empty state, and clears the history after confirmation', async () => {
    const { calls } = await view([{ query: { filter: { a: { $numberInt: '1' } } }, usedAt: 1 }])
    button('Recent queries').click()
    await flushPromises()
    button('Clear history').click()
    await flushPromises()
    ;(document.querySelector('[data-test="confirm"]') as HTMLButtonElement).click()
    await flushPromises()
    expect(calls.some((c) => c.method === 'DELETE' && c.path.endsWith('/recent-queries'))).toBe(true)
    expect(document.body.textContent).toContain('No recent queries yet.')
  })

  it('closes with Escape and gives focus back to its button', async () => {
    await view([{ query: { filter: { a: { $numberInt: '1' } } }, usedAt: 1 }])
    const trigger = button('Recent queries')
    trigger.click()
    await flushPromises()
    entries()[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(entries()).toHaveLength(0)
    expect(document.activeElement).toBe(trigger)
  })
})

// User request 2026-11-12 (as in Compass): a click in the empty filter lists the recent queries of the
// collection under it, to choose one from.
describe('recent queries in the empty filter', () => {
  const RECENT = [
    { query: { filter: { id: { $numberInt: '221' } } }, usedAt: 2 },
    { query: { filter: { name: 'Ada' }, sort: { qty: { $numberInt: '-1' } } }, usedAt: 1 },
  ]
  const filter = () => byLabel<HTMLTextAreaElement>('Filter')
  const listed = () =>
    [...document.querySelectorAll('[role="option"]')].map((o) =>
      [...o.querySelectorAll('span')].map((s) => s.textContent?.replace(/\s+/g, ' ').trim()).join(' · '),
    )
  const key = (k: string) =>
    filter().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
  async function clickFilter() {
    filter().focus()
    filter().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
  }

  it('lists them on a click, and runs the one chosen with Enter', async () => {
    const { calls } = await view(RECENT)
    await clickFilter()
    expect(listed()).toEqual([
      '{ id: 221 } · recent query',
      '{ name: "Ada" } sort: { qty: -1 } · recent query',
    ])
    key('ArrowDown')
    key('ArrowDown')
    key('Enter')
    await flushPromises()
    expect(useCollectionViewsStore().stateFor('t').draft).toMatchObject({
      filter: '{ name: "Ada" }',
      sort: '{ qty: -1 }',
    })
    expect(calls.filter((c) => c.path.endsWith('/find')).at(-1)!.body).toMatchObject({
      filter: { name: 'Ada' },
      sort: { qty: { $numberInt: '-1' } },
    })
    expect(listed()).toEqual([])
  })

  it('none is chosen as it opens: Enter runs the filter as written', async () => {
    const { calls } = await view(RECENT)
    await clickFilter()
    expect(document.querySelector('[aria-selected="true"]')).toBeNull()
    key('Enter')
    await flushPromises()
    expect(listed()).toEqual([])
    expect(useCollectionViewsStore().stateFor('t').draft.filter).toBe('')
    expect(calls.filter((c) => c.path.endsWith('/find'))).toHaveLength(2)
    expect(calls.filter((c) => c.path.endsWith('/find')).at(-1)!.body).toMatchObject({ filter: {} })
  })

  it('after Escape, the arrow down brings them back with the newest chosen, read again', async () => {
    const { calls } = await view(RECENT)
    const reads = () => calls.filter((c) => c.method === 'GET' && c.path.endsWith('/recent-queries')).length
    await clickFilter()
    key('Escape')
    await flushPromises()
    expect(listed()).toEqual([])
    const before = reads()
    key('ArrowDown')
    await flushPromises()
    expect(reads()).toBe(before + 1)
    expect(document.querySelector('[aria-selected="true"]')!.textContent).toContain('221')
  })

  it('opens on a click, not when the app puts the caret in the filter', async () => {
    const { calls } = await view(RECENT)
    filter().focus()
    await flushPromises()
    expect(listed()).toEqual([])
    expect(calls.some((c) => c.path.endsWith('/recent-queries'))).toBe(false)
  })

  it('the arrow up goes to the oldest', async () => {
    await view(RECENT)
    await clickFilter()
    key('ArrowUp')
    await flushPromises()
    expect(document.querySelector('[aria-selected="true"]')!.textContent).toContain('Ada')
  })

  it('runs the one clicked', async () => {
    const { calls } = await view(RECENT)
    await clickFilter()
    document.querySelector('[role="option"]')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await flushPromises()
    expect(useCollectionViewsStore().stateFor('t').draft.filter).toBe('{ id: 221 }')
    expect(calls.filter((c) => c.path.endsWith('/find')).at(-1)!.body).toMatchObject({
      filter: { id: { $numberInt: '221' } },
    })
  })

  it('reads them again each time, so the query just run is among them', async () => {
    const { calls } = await view(RECENT)
    await clickFilter()
    filter().blur()
    await clickFilter()
    expect(
      calls.filter((c) => c.method === 'GET' && c.path.endsWith('/recent-queries')).length,
    ).toBeGreaterThanOrEqual(2)
  })

  it('gives way to the suggestions once something is typed', async () => {
    await view(RECENT)
    await clickFilter()
    const el = filter()
    el.value = 'na'
    el.setSelectionRange(2, 2)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    expect(listed().some((l) => l?.endsWith('recent query'))).toBe(false)
  })

  it('shows none in a filter already written', async () => {
    await view(RECENT)
    useCollectionViewsStore().stateFor('t').draft.filter = '{ qty: 1 }'
    await flushPromises()
    await clickFilter()
    expect(listed()).toEqual([])
  })

  it('closes with Escape, and Tab leaves the filter without choosing one', async () => {
    const { calls } = await view(RECENT)
    await clickFilter()
    key('Escape')
    await flushPromises()
    expect(listed()).toEqual([])
    filter().blur()
    await clickFilter()
    key('Tab')
    await flushPromises()
    expect(listed()).toEqual([])
    expect(useCollectionViewsStore().stateFor('t').draft.filter).toBe('')
    expect(calls.filter((c) => c.path.endsWith('/find'))).toHaveLength(1)
  })

  it('leaves out how the tab opened (newest first), run again by Reset', async () => {
    useCollectionViewsStore().stateFor('t').openingSort = '{ _id: -1 }'
    await view([{ query: { filter: {}, sort: { _id: { $numberInt: '-1' } } }, usedAt: 3 }, ...RECENT])
    await clickFilter()
    expect(listed()).toEqual([
      '{ id: 221 } · recent query',
      '{ name: "Ada" } sort: { qty: -1 } · recent query',
    ])
  })

  it('names a query by its filter alone where it ran newest first, as the tab opened, and keeps Options closed', async () => {
    useCollectionViewsStore().stateFor('t').openingSort = '{ _id: -1 }'
    const { calls } = await view([
      { query: { filter: { id: { $numberInt: '221' } }, sort: { _id: { $numberInt: '-1' } } }, usedAt: 1 },
    ])
    await clickFilter()
    expect(listed()).toEqual(['{ id: 221 } · recent query'])
    document.querySelector('[role="option"]')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await flushPromises()
    expect(useCollectionViewsStore().stateFor('t').draft).toMatchObject({
      filter: '{ id: 221 }',
      sort: '{ _id: -1 }',
    })
    expect(calls.filter((c) => c.path.endsWith('/find')).at(-1)!.body).toMatchObject({
      filter: { id: { $numberInt: '221' } },
      sort: { _id: { $numberInt: '-1' } },
    })
    expect(document.querySelector('button[title="Options"]')!.getAttribute('aria-expanded')).toBe('false')
  })

  it('shows nothing where none was run yet', async () => {
    await view([])
    await clickFilter()
    expect(listed()).toEqual([])
  })
})
