import type { Device, ReasonCode } from '../api/types.ts'

/**
 * Everyday words. Whoever is on duty should be able to read the console without
 * knowing how sync works: each problem is named the way a shop would describe
 * it on the phone, with one line on what usually fixes it. The server's own
 * wording stays visible underneath for whoever has to dig.
 */

export interface Plain {
  title: string
  hint: string
}

const CALL = 'Call the shop.'
const DEV = 'Pass it to a developer.'

const REASONS: Record<ReasonCode, Plain> = {
  offline: {
    title: 'Not connected',
    hint: `Usually the computer is off or the shop's internet is down. ${CALL}`,
  },
  server_down: {
    title: 'SmartSort has stopped running',
    hint: 'Ask the shop to close SmartSort and open it again.',
  },
  sync_failed: {
    title: "Sales aren't reaching the cloud",
    hint: 'The till keeps retrying. If it lasts over an hour, ask the shop to restart SmartSort.',
  },
  sync_stuck: {
    title: 'Sales are stuck on the till',
    hint: `Nothing has gone up for a while. Ask the shop to restart SmartSort; if that doesn't help, ${DEV.toLowerCase()}`,
  },
  sync_deep: {
    title: 'Sales are piling up on the till',
    hint: 'Usually a slow connection. It catches up once the internet improves.',
  },
  pull_stale: {
    title: 'Not getting changes from other tills',
    hint: 'Prices or stock changed elsewhere may be out of date here. Ask the shop to restart SmartSort.',
  },
  pull_quarantined: {
    title: 'Some changes from other tills were refused',
    hint: DEV,
  },
  errors_recent: {
    title: 'The app has been hitting problems',
    hint: DEV,
  },
  disk_low: {
    title: 'The computer is running out of space',
    hint: "Ask the shop to delete old downloads or files they don't need.",
  },
  backup_stale: {
    title: 'Backups have stopped',
    hint: `Check the computer is left on. If it is, ${DEV.toLowerCase()}`,
  },
  clock_skew: {
    title: "The computer's clock is wrong",
    hint: 'Ask the shop to set the date and time — receipts show the wrong time until they do.',
  },
  unverified_key: {
    title: "Till isn't linked to its shop yet",
    hint: "Finish connecting it from the shop's page.",
  },
  key_rejected: {
    title: "Till's link to its shop was refused",
    hint: "The link may have been removed. Reconnect it from the shop's page.",
  },
}

const RULES: Record<string, Plain> = {
  'device.offline': REASONS.offline,
  'server.down': REASONS.server_down,
  'sync.failed': REASONS.sync_failed,
  'sync.stuck': REASONS.sync_stuck,
  'sync.deep': REASONS.sync_deep,
  'sync.pull_stale': REASONS.pull_stale,
  'sync.pull_quarantined': REASONS.pull_quarantined,
  'disk.low': REASONS.disk_low,
  'backup.stale': REASONS.backup_stale,
  'clock.skew': REASONS.clock_skew,
  'device.key_rejected': REASONS.key_rejected,
  'shop.offline': {
    title: 'The whole shop is offline',
    hint: `No till there is connected — probably the internet or the power. ${CALL}`,
  },
  'sales.flatline': {
    title: 'No sales yet today',
    hint: 'May just be quiet or closed. Worth a call if the shop is normally busy by now.',
  },
  'errors.spike': { title: 'Lots of app problems at once', hint: `Something changed suddenly. ${DEV}` },
  'errors.new_group': { title: 'A new kind of app problem', hint: `It hasn't happened before. ${DEV}` },
  'assistant.account': { title: "The shop assistant isn't working", hint: DEV },
  'assistant.limit_reached': {
    title: 'Shop has used up its AI allowance',
    hint: 'The assistant stays off for them until the allowance resets or is raised.',
  },
  'rollout.halted': {
    title: 'An update stopped itself',
    hint: 'Something went wrong on the first tills to get it.',
  },
}

const UNKNOWN: Plain = { title: 'Needs a look', hint: 'Open it to see what the till reported.' }

export const reasonPlain = (code: string | undefined): Plain =>
  (code && REASONS[code as ReasonCode]) || UNKNOWN

/** An alert rule in plain words, falling back to the server's own title. */
export const rulePlain = (ruleKey: string, fallbackTitle: string): Plain =>
  RULES[ruleKey] ?? { title: fallbackTitle, hint: '' }

/** What to call a till: its given name, its receipt code, or a short device id. */
export function tillName(d: Pick<Device, 'machineName' | 'terminalCode' | 'deviceId'>): string {
  if (d.machineName || d.terminalCode) return (d.machineName || d.terminalCode)!
  // Short ids read fine whole; long ones (uuids) are cut at a readable length.
  return `Till ${d.deviceId.length <= 20 ? d.deviceId : `${d.deviceId.slice(0, 8)}…`}`
}

export const STATE_LABEL = {
  healthy: 'Working',
  attention: 'Needs a look',
  offline: 'Offline',
} as const
