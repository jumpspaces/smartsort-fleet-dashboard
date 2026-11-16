/**
 * Lists as spreadsheets, for handing to someone outside the console.
 */

export interface Column<T> {
  header: string
  value: (row: T) => string | number | boolean | null | undefined
}

/** RFC 4180: quote anything with a comma, quote or line break; double quotes. */
function cell(v: string | number | boolean | null | undefined): string {
  if (v == null) return ''
  let s = String(v)
  // A leading = + - @ makes Excel run the cell as a formula. Data from tills
  // (error messages, names) is not ours to trust.
  if (/^[=+\-@\t\r]/.test(s) && typeof v === 'string') s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv<T>(rows: T[], columns: Column<T>[]): string {
  const lines = [columns.map((c) => cell(c.header)).join(',')]
  for (const r of rows) lines.push(columns.map((c) => cell(c.value(r))).join(','))
  return lines.join('\r\n') + '\r\n'
}

export function saveFile(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** A BOM so Excel opens UTF-8 (cedi signs, Twi names) correctly. */
export function saveCsv<T>(name: string, rows: T[], columns: Column<T>[]) {
  const stamp = new Date().toISOString().slice(0, 10)
  saveFile(`${name}-${stamp}.csv`, new Blob(['﻿', toCsv(rows, columns)], { type: 'text/csv;charset=utf-8' }))
}
