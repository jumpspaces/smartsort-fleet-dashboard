import { describe, expect, it } from 'vitest'
import { reasonPlain, rulePlain, tillName } from './plain.ts'

describe('plain words', () => {
  it('names known reasons and falls back for new ones', () => {
    expect(reasonPlain('offline').title).toBe('Not connected')
    expect(reasonPlain('something_new').title).toBe('Needs a look')
    expect(reasonPlain(undefined).title).toBe('Needs a look')
  })
  it("falls back to the server's own title for unknown rules", () => {
    expect(rulePlain('device.offline', 'x').title).toBe('Not connected')
    expect(rulePlain('brand.new', 'Server title').title).toBe('Server title')
  })
  it('names a till by name, then code, then id', () => {
    expect(tillName({ machineName: 'Front', terminalCode: 'T1', deviceId: 'abcdefghij' })).toBe('Front')
    expect(tillName({ machineName: null, terminalCode: 'T1', deviceId: 'abcdefghij' })).toBe('T1')
    expect(tillName({ machineName: null, terminalCode: null, deviceId: 'dev-5-3-ab12' })).toBe('Till dev-5-3-ab12')
    expect(tillName({ machineName: null, terminalCode: null, deviceId: '3f2a9c1e-77aa-4b0e-9d1c-0a1b2c3d4e5f' })).toBe('Till 3f2a9c1e…')
  })
})
