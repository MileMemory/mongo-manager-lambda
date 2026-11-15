// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Gokhan OZGEZER
import type { RecentQuery } from '@/api/documents'
import { decodeValue, toShell } from './values'

/** A recent query on one line: the filter, then any other parts by name. */
export function describeQuery(q: RecentQuery): string {
  const shell = (v: unknown) => toShell(decodeValue(v), 0)
  const parts = [shell(q.filter)]
  if (q.projection) parts.push(`projection: ${shell(q.projection)}`)
  if (q.sort) parts.push(`sort: ${shell(q.sort)}`)
  if (q.collation) parts.push(`collation: ${shell(q.collation)}`)
  if (q.hint !== undefined) parts.push(`hint: ${typeof q.hint === 'string' ? q.hint : shell(q.hint)}`)
  return parts.join(' ')
}
