import { describe, expect, it } from 'vitest'
import type { CommandSpec } from '../api/types.ts'
import { holdLine, liveState, outcomeLine, parseStuckRows, supportedCommands, timingFields } from '../lib/commands.ts'

const spec = (name: string, legacy?: boolean): CommandSpec =>
  ({ name, label: name, description: '', risk: 'safe', quietable: false, ...(legacy === undefined ? {} : { legacy }) }) as CommandSpec

describe('supportedCommands', () => {
  const catalogue = [spec('sync.now', true), spec('till.lock', false)]
  it('takes the till at its word when it lists what it knows', () => {
    expect([...supportedCommands({ capabilities: ['till.lock'] }, catalogue)]).toEqual(['till.lock'])
  })
  it('offers an older till only the original commands', () => {
    expect([...supportedCommands({ capabilities: null }, catalogue)]).toEqual(['sync.now'])
  })
  it('offers everything when the server is too old to say which are new', () => {
    const old = [spec('sync.now'), spec('server.restart')]
    expect([...supportedCommands({ capabilities: null }, old)]).toEqual(['sync.now', 'server.restart'])
  })
})

describe('outcomeLine', () => {
  it('summarises a stuck-row listing rather than dumping it', () => {
    const result = JSON.stringify({ received: [], receivedTotal: 3, sending: [], sendingTotal: 1 })
    expect(outcomeLine({ command: 'pull.inspect', result, error: null })).toBe('3 received rows not applied, 1 row not sent.')
    expect(outcomeLine({ command: 'pull.inspect', result: JSON.stringify({ received: [], receivedTotal: 0, sending: [], sendingTotal: 0 }), error: null })).toBe(
      'Nothing stuck.',
    )
  })
  it('falls back to the raw text when a result is not what it should be', () => {
    expect(outcomeLine({ command: 'pull.inspect', result: '{"cut off', error: null })).toBe('{"cut off')
    expect(parseStuckRows('{"cut off')).toBeNull()
  })
  it('puts an error first', () => {
    expect(outcomeLine({ command: 'sync.now', result: 'x', error: 'offline' })).toBe('offline')
  })
})

describe('timingFields', () => {
  it('turns the picker into what the server takes', () => {
    expect(timingFields({ kind: 'now' })).toEqual({})
    expect(timingFields({ kind: 'quiet' })).toEqual({ whenQuiet: true })
    expect(timingFields({ kind: 'at', at: '2026-11-16T22:00' }).notBefore).toBe(new Date('2026-11-16T22:00').toISOString())
    expect(timingFields({ kind: 'at', at: 'not a time' })).toEqual({})
  })
})

describe('holdLine', () => {
  const now = Date.parse('2026-11-16T10:00:00Z')
  it('says what a waiting command is waiting for', () => {
    expect(holdLine({ state: 'pending', whenQuiet: true, notBefore: null }, now)).toMatch(/10 minutes without a sale/)
    expect(holdLine({ state: 'pending', whenQuiet: false, notBefore: '2026-11-16T22:00:00Z' }, now)).toMatch(/^Held not before/)
    expect(holdLine({ state: 'sent', whenQuiet: true, notBefore: null }, now)).toBeNull()
  })
})

describe('liveState', () => {
  const now = Date.parse('2026-11-16T10:00:00Z')
  it('is live only once the till has actually answered fast', () => {
    expect(liveState({ liveUntil: null, lastReportAt: '2026-11-16T09:59:50Z' }, now)).toBe('off')
    expect(liveState({ liveUntil: '2026-11-16T10:04:00Z', lastReportAt: '2026-11-16T09:59:50Z' }, now)).toBe('live')
    expect(liveState({ liveUntil: '2026-11-16T10:04:00Z', lastReportAt: '2026-11-16T09:58:00Z' }, now)).toBe('connecting')
    expect(liveState({ liveUntil: '2026-11-16T09:59:00Z', lastReportAt: '2026-11-16T09:59:50Z' }, now)).toBe('off')
  })
})
