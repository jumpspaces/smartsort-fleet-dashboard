/**
 * Run `fn` over every item, at most `limit` at a time, and report per item.
 * One failure never stops the rest: a bulk action on forty tills that dies on
 * the third would leave thirty-seven untouched and nobody sure which.
 */
export async function pool<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<unknown>,
  onProgress?: (done: number) => void,
): Promise<{ ok: T[]; failed: { item: T; error: string }[] }> {
  const ok: T[] = []
  const failed: { item: T; error: string }[] = []
  let next = 0
  let done = 0
  async function worker() {
    while (next < items.length) {
      const item = items[next++]!
      try {
        await fn(item)
        ok.push(item)
      } catch (e) {
        failed.push({ item, error: e instanceof Error ? e.message : String(e) })
      }
      onProgress?.(++done)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return { ok, failed }
}
