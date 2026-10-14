import type { HealthReason } from '../api.ts'
import type { View } from './route.ts'

/**
 * Everyday words for the fleet console.
 *
 * The console is used by whoever is on duty, not only by the people who wrote
 * the sync engine, so nothing on the front page should need knowing what a
 * "p95" or a "sync queue" is. Each problem is named the way a shop owner would
 * describe it on the phone, with one sentence on what usually fixes it. The
 * technical wording stays reachable — on the detail pages and in hover text —
 * for whoever has to go deeper.
 */

/** What each page is called, in the menu, the search box and its own heading. */
export const PAGE_NAME: Partial<Record<View, string>> = {
  triage: 'Home',
  shops: 'Shops',
  alerts: 'Alerts',
  rollouts: 'Updates',
  operators: 'Settings',
  terminals: 'Tills',
  errors: 'App problems',
  backups: 'Backups',
  quality: 'Records check',
  trends: 'History',
  commands: 'Remote fixes',
  audit: 'Activity log',
}

export const pageName = (view: View): string => PAGE_NAME[view] ?? view

export interface Plain {
  /** The problem, as someone in the shop would put it. */
  title: string
  /** What usually fixes it, or who to hand it to. */
  hint: string
}

const CALL = 'Call the shop.'
const DEV = 'Pass it to a developer.'

/** By health reason — why a till is not "fine". */
export const REASON_PLAIN: Record<HealthReason['code'], Plain> = {
  offline: {
    title: 'Not connected',
    hint: `Usually the computer is switched off or the shop’s internet is down. ${CALL}`,
  },
  server_down: {
    title: 'SmartSort has stopped running',
    hint: 'Ask the shop to close SmartSort and open it again.',
  },
  sync_failed: {
    title: 'Sales aren’t reaching the cloud',
    hint: 'The till keeps retrying. If it lasts more than an hour, ask the shop to restart SmartSort.',
  },
  sync_stuck: {
    title: 'Sales are stuck on the till',
    hint: `Nothing has gone up for a while. Ask the shop to restart SmartSort; if that doesn’t help, ${DEV.toLowerCase()}`,
  },
  sync_deep: {
    title: 'Sales are piling up on the till',
    hint: 'Usually a slow connection. It catches up by itself once the internet improves.',
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
    hint: 'Ask the shop to delete old downloads or files they don’t need.',
  },
  backup_stale: {
    title: 'Backups have stopped',
    hint: 'Check the computer is left on. If it is, pass it to a developer.',
  },
  clock_skew: {
    title: 'The computer’s clock is wrong',
    hint: 'Ask the shop to set the date and time — receipts show the wrong time until they do.',
  },
  unverified_key: {
    title: 'Till isn’t linked to its shop yet',
    hint: 'Finish connecting it from the shop’s page, under Machines.',
  },
  key_rejected: {
    title: 'Till’s link to its shop was refused',
    hint: 'The link may have been removed. Reconnect it from the shop’s page, under Machines.',
  },
}

/** By alert rule. Rules that describe a till's health reuse its reason. */
export const RULE_PLAIN: Record<string, Plain> = {
  'device.offline': REASON_PLAIN.offline,
  'server.down': REASON_PLAIN.server_down,
  'sync.failed': REASON_PLAIN.sync_failed,
  'sync.stuck': REASON_PLAIN.sync_stuck,
  'sync.deep': REASON_PLAIN.sync_deep,
  'sync.pull_stale': REASON_PLAIN.pull_stale,
  'sync.pull_quarantined': REASON_PLAIN.pull_quarantined,
  'disk.low': REASON_PLAIN.disk_low,
  'backup.stale': REASON_PLAIN.backup_stale,
  'clock.skew': REASON_PLAIN.clock_skew,
  'device.key_rejected': REASON_PLAIN.key_rejected,
  'shop.offline': {
    title: 'The whole shop is offline',
    hint: `No till there is connected — probably the internet or the power. ${CALL}`,
  },
  'sales.flatline': {
    title: 'No sales yet today',
    hint: 'May just be quiet or closed. Worth a call if the shop is normally busy by now.',
  },
  'errors.spike': {
    title: 'Lots of app problems at once',
    hint: `Something changed suddenly. ${DEV}`,
  },
  'errors.new_group': {
    title: 'A new kind of app problem',
    hint: `It hasn’t happened before. ${DEV}`,
  },
  'assistant.account': {
    title: 'The shop assistant isn’t working',
    hint: `The AI service account needs attention. ${DEV}`,
  },
  'assistant.limit_reached': {
    title: 'Shop has used up its AI allowance',
    hint: 'The assistant stays off for them until the allowance resets or is raised.',
  },
  'rollout.halted': {
    title: 'An update stopped itself',
    hint: 'Something went wrong on the first tills to get it. Open Updates to see why.',
  },
}

/** Used when the server reports something this build has no words for yet. */
export const UNKNOWN_PLAIN: Plain = {
  title: 'Needs a look',
  hint: 'Open it to see what the till reported.',
}

export const reasonPlain = (code: string | undefined): Plain =>
  (code && REASON_PLAIN[code as HealthReason['code']]) || UNKNOWN_PLAIN

export const rulePlain = (key: string): Plain | undefined => RULE_PLAIN[key]

/** "1 till", "3 tills". */
export const tills = (n: number): string => `${n} till${n === 1 ? '' : 's'}`
