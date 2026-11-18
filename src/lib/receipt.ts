/**
 * Whether what someone typed into ⌘K is a receipt number, so the palette can
 * offer "Find sale …" first. Mirrors the server's parser
 * (server/src/services/receipt-lookup.service.ts): TXN-T2-0451, T2-451,
 * T2 451, T2/451, #451. A bare number counts only with a "#" — "451" alone is
 * as likely a shop code fragment or a till.
 */
export function looksLikeReceipt(text: string): boolean {
  const q = text.trim()
  if (!q) return false
  if (/^TXN-(?:[A-Za-z][A-Za-z0-9]*-)?\d+$/i.test(q)) return true
  if (/^T\d+\s*[-\s/#:]\s*\d{1,9}$/i.test(q)) return true
  return /^#\s*\d{1,9}$/.test(q)
}
