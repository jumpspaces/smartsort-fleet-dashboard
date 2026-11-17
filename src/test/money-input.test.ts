import { describe, expect, it } from 'vitest'
import { toPesewas } from '../pages/shop/ShopAccount.tsx'

describe('toPesewas', () => {
  it('reads cedis exactly, never through a float', () => {
    expect(toPesewas('150')).toBe(15000)
    expect(toPesewas('150.5')).toBe(15050)
    expect(toPesewas('150.05')).toBe(15005)
    expect(toPesewas('0.29')).toBe(29)
    expect(toPesewas('1,250.10')).toBe(125010)
  })
  it('refuses what is not an amount', () => {
    expect(toPesewas('')).toBeNull()
    expect(toPesewas('12.345')).toBeNull()
    expect(toPesewas('-5')).toBeNull()
    expect(toPesewas('GHS 5')).toBeNull()
  })
})
