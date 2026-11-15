// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Gokhan OZGEZER

/**
 * The app's query client defaults; tests that depend on how long an answer is kept use them too (user
 * report 2026-11-11: a test client keeping nothing hid that Find showed a page read seconds before).
 */
export const QUERY_DEFAULTS = { retry: 1, refetchOnWindowFocus: false, staleTime: 10_000 } as const
