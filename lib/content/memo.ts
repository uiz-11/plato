// Content memoization (§5.4). In production, content changes only on deploy,
// which restarts the process, so loaded and rendered content is kept for the
// life of the process. Elsewhere nothing is kept, so the pipeline's
// edit-and-check loop always sees the current files.

const g = globalThis as { __platoContentCache?: Map<string, unknown> }

export function memo<T>(key: string, load: () => T): T {
  if (process.env.NODE_ENV !== "production") return load()
  const cache = (g.__platoContentCache ??= new Map())
  if (!cache.has(key)) cache.set(key, load())
  return cache.get(key) as T
}

/** Drops every memoized value. For tests. */
export function clearMemo(): void {
  g.__platoContentCache?.clear()
}
