/**
 * Shapes the cloud's fleet control plane answers with. These mirror
 * server/src/routes/fleet.ts and server/src/routes/stores.ts; only the fields
 * this console reads are declared.
 */

export type Role = 'admin' | 'operator' | 'viewer'

export interface Operator {
  id: string
  email: string
  name: string
  role: Role
  /** This session began with a code from an authenticator app. */
  mfa?: boolean
}

/** A move of every till to a new cloud address, signed with the release key. */
export interface CloudAddressView {
  signed: { statement: string; signature: string } | null
  move: { apiUrl: string; fleetUrl: string; feedUrl: string; issuedAt: string } | null
  /** Checked here against the release key; null when the server has no copy of it. */
  verified: boolean | null
}

export interface TwoFactorStatus {
  enabled: boolean
  enabledAt: string | null
  recoveryCodesLeft: number
  /** Every operator must use codes (Settings → Team). */
  required: boolean
}

export interface Session {
  apiBase: string
  accessToken: string
  refreshToken: string
  operator: Operator
}

export type FleetState = 'healthy' | 'attention' | 'offline'

export type ReasonCode =
  | 'offline'
  | 'server_down'
  | 'sync_failed'
  | 'sync_stuck'
  | 'sync_deep'
  | 'pull_stale'
  | 'pull_quarantined'
  | 'errors_recent'
  | 'disk_low'
  | 'backup_stale'
  | 'clock_skew'
  | 'unverified_key'
  | 'key_rejected'

export interface HealthReason {
  code: ReasonCode
  label: string
  severity: 'critical' | 'warning'
}

export interface DeviceMute {
  id: string
  scope: 'device' | 'shop' | 'fleet'
  reason: string
  endsAt: string
  createdByLabel: string | null
}

export interface Device {
  deviceId: string
  shopId: string | null
  shopName: string | null
  removedAt: string | null
  machineName: string | null
  terminalCode: string | null
  keyId: string | null
  appVersion: string | null
  bundleVersion: string | null
  platform: string | null
  osVersion: string | null
  mode: string | null
  serverHealthy: boolean | null
  appUptimeSec: number | null
  syncPending: number | null
  syncFailed: number | null
  oldestPendingAgeMs: number | null
  lastSyncAt: string | null
  lastPulledAt: string | null
  pullQuarantined: number | null
  salesTodayCount: number | null
  salesTodayPesewas: number | null
  dbSizeBytes: number | null
  keyVerified: boolean
  firstReportAt: string
  lastReportAt: string
  diskFreeBytes: number | null
  diskTotalBytes: number | null
  lastBackupAt: string | null
  backupSizeBytes: number | null
  backupError: string | null
  clockSkewMs: number | null
  /** Until when the till checks in every few seconds — renewed while its page is open. */
  liveUntil: string | null
  /** When the shop last rang a sale, by the till's own count of how long ago. */
  lastSaleAt: string | null
  /** The remote commands this till's build knows; null on builds from before the list. */
  capabilities: string[] | null
  /** Lock, on-screen message and tuned settings, as the TILL reports them. */
  controlState: DeviceControlState | null
  /** When "after closing" would be for this till's shop; only on a single till's read. */
  nextClosingAt?: string | null
  /** Server-computed: the console renders these, it never derives them. */
  state: FleetState
  reasons: HealthReason[]
  online: boolean
  recentOpenErrorGroups: number
  openAlerts: number
  mute: DeviceMute | null
  tags: string[]
  noteCount: number
  pinnedNote: string | null
}

export type DeviceSort = 'state' | 'shop' | 'version' | 'sync' | 'sales' | 'errors' | 'lastSeen' | 'disk'

export interface DeviceQuery {
  q?: string
  state?: FleetState | 'all'
  shopId?: string
  platform?: string
  version?: string
  tag?: string
  muted?: 'muted' | 'unmuted'
  /** Include tills taken off their shop — out of the fleet by default. */
  includeRemoved?: boolean
  sort?: DeviceSort
  dir?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

export interface DevicePage {
  devices: Device[]
  total: number
  limit: number
  offset: number
}

/** One terminal's recent liveness, bucketed oldest-first. */
export interface HeartbeatStrip {
  deviceId: string
  buckets: number[]
  expectedPerBucket: number
  fromMs: number
  bucketMs: number
}

export interface Overview {
  counts: { all: number; healthy: number; attention: number; offline: number }
  pendingCommands: number
  uptimeBps30d: number | null
  syncLagMs: { p50: number | null; p95: number | null }
  versions: { version: string; count: number }[]
  openErrorGroups: number
  openAlerts: number
  /** Help requests nobody has replied to. Absent from an older server. */
  openHelpRequests?: number
  unverifiedDevices: number
  windowHours: number
  release: {
    latestVersion: string | null
    releasedAt: string | null
    installer: string | null
    rollableVersions: string[]
    available: boolean
  }
}

export interface DeviceError {
  id: string
  deviceId: string
  fingerprint: string
  source: string | null
  message: string
  stack: string | null
  appVersion: string | null
  count: number
  firstSeen: string
  lastSeen: string
  status: 'open' | 'resolved' | 'ignored' | null
}

export type AlertState = 'open' | 'acknowledged' | 'resolved'

export interface Alert {
  id: string
  ruleKey: string
  deviceId: string | null
  shopId: string | null
  shopName: string | null
  severity: 'warning' | 'critical'
  title: string
  detail: string | null
  state: AlertState
  openedAt: string
  lastSeenAt: string
  acknowledgedAt: string | null
  acknowledgedByLabel: string | null
  resolvedAt: string | null
  notifiedAt: string | null
  notifyError: string | null
  rollupCount: number | null
  escalatedAt: string | null
  escalations: number
  /** What the rule's automatic fix did when this opened, if it has one. */
  autoFixNote?: string | null
}

export interface ShopMachine {
  keyId: string
  machineId: string
  machineName: string | null
  terminalCode: string
  mode: 'exclusive' | 'peer'
  keyPrefix: string
  createdAt: string
  lastSeenAt: string | null
  revokedAt: string | null
  removedAt: string | null
  lastReportAt: string | null
}

export interface Shop {
  id: string
  name: string
  code: string | null
  location: string | null
  phone: string | null
  currency: string
  createdAt: string
  owner: { id: string; name: string; staffId: string; active: boolean } | null
  activated: boolean
  hasLiveClaimCode: boolean
  claimCodeExpiresAt: string | null
  health: { healthy: number; attention: number; offline: number }
  /** Set while the shop is closed (until its data is deleted); absent on older servers. */
  closure?: { status: 'closed'; closedAt: string; purgeAfter: string; purgeApprovedAt: string | null } | null
  machines: ShopMachine[]
}

/* ------------------------------------------------------- closing a shop --- */

export type ClosureStatus = 'closed' | 'reopened' | 'purged'

export interface ShopClosure {
  id: string
  shopId: string
  shopName: string
  shopCode: string | null
  status: ClosureStatus
  reason: string | null
  closedAt: string
  closedBy: string | null
  closedByLabel: string | null
  /** The earliest the data may be deleted. */
  purgeAfter: string
  purgeApprovedAt: string | null
  purgeApprovedBy: string | null
  purgeApprovedByLabel: string | null
  exportedAt: string | null
  exportedByLabel: string | null
  reopenedAt: string | null
  reopenedByLabel: string | null
  purgedAt: string | null
  purgeCounts: Record<string, number> | null
  purgeError: string | null
}

export interface ClosureView {
  status: 'open' | ClosureStatus
  closure: ShopClosure | null
  /** When the data goes if nothing changes; null until closed AND approved. */
  purgeOn: string | null
  /** Tills holding sales the cloud hasn't got: an export now won't have them. */
  unsent: { deviceId: string; syncPending: number; lastReportAt: string | null }[]
  purgeAfterDays: number
}

/** Why a till was locked — each has its own wording on the till's screen. */
export const LOCK_REASONS = ['support_hold', 'decommissioned', 'stolen'] as const
export type LockReason = (typeof LOCK_REASONS)[number]

export interface DeviceControlState {
  lock: { reason: LockReason; message: string | null; since: string } | null
  notice: { text: string; tone: 'info' | 'warn'; until: string } | null
  config: TillConfig
  /** The kept settings the till last took up; absent on builds from before them. */
  version?: string | null
}

export interface TillConfig {
  reportIntervalSec?: number
  backupEveryHours?: number
}
export type TillConfigKey = keyof TillConfig

/** Where a setting a till runs under was set. */
export type SettingSource = 'device' | 'shop' | 'fleet'

interface KeptStamp {
  since: string
  by: string | null
}
export type KeptLock = { reason: LockReason; message: string | null } & KeptStamp
export type KeptNotice = { text: string; tone: 'info' | 'warn'; until: string } & KeptStamp
export type KeptHold = { reason: string | null } & KeptStamp

/**
 * What the console keeps for a till, at one level — the fleet, a shop or the
 * till itself. The till takes it up on every check-in, so none of it expires.
 */
export interface TillSettingsLevel {
  lock?: KeptLock | null
  notice?: KeptNotice | null
  config?: TillConfig
  /** Enforced in the cloud: the till's uploads and pulls are turned away. */
  syncHold?: KeptHold | null
  /** Enforced in the cloud: no update reaches it. */
  updateHold?: KeptHold | null
}

export interface EffectiveSettings {
  lock: KeptLock | null
  notice: (KeptNotice & { from: SettingSource }) | null
  config: TillConfig
  configFrom: Partial<Record<TillConfigKey, SettingSource>>
  syncHold: KeptHold | null
  updateHold: (KeptHold & { from: SettingSource }) | null
}

export interface DeviceSettingsView {
  layers: { fleet: TillSettingsLevel; shop: TillSettingsLevel; device: TillSettingsLevel }
  effective: EffectiveSettings
  version: string
  tillVersion: string | null
  /** Has the till taken them up? Null for a build too old to keep settings. */
  onTill: boolean | null
}

export interface NoticeInput {
  text: string
  tone: 'info' | 'warn'
  hours: number
}

export type ConfigPatch = Partial<Record<TillConfigKey, number | null>>

export interface FleetTillSettings {
  fleet: TillSettingsLevel
  shops: { shopId: string; settings: TillSettingsLevel; updatedByLabel: string | null; updatedAt: string }[]
  devices: { deviceId: string; settings: TillSettingsLevel; shopName: string | null; updatedByLabel: string | null; updatedAt: string }[]
}

export interface ScheduleResult {
  issued: number
  skipped: { deviceId: string; reason: string }[]
  skippedTotal: number
}

export interface Schedule {
  id: string
  label: string
  scope: 'fleet' | 'shop' | 'device'
  target: string
  /** `recipe:<name>` or `command:<name>`. */
  action: string
  payload: Record<string, unknown> | null
  every: 'day' | 'week'
  /** 0 = Sunday. */
  weekday: number | null
  /** Minutes after midnight, shop time. */
  atMinute: number
  whenQuiet: boolean
  enabled: boolean
  nextRunAt: string
  lastRunAt: string | null
  lastResult: ScheduleResult | null
  createdByLabel: string | null
  actionLabel: string
  targetLabel: string
}

export interface ScheduleInput {
  label: string
  scope: Schedule['scope']
  target?: string | null
  action: string
  payload?: Record<string, unknown>
  every: Schedule['every']
  weekday?: number | null
  atMinute: number
  whenQuiet?: boolean
}

/**
 * How much a command can hurt. `destructive` ones need your password again,
 * never go out in bulk, and may need a second operator.
 */
export type CommandRisk = 'safe' | 'disruptive' | 'destructive'

export interface CommandSpec {
  name: string
  label: string
  description: string
  risk: CommandRisk
  /** Can wait for ten minutes without a sale. */
  quietable: boolean
  /** Understood by builds that don't list what they understand. */
  legacy: boolean
}

export type CommandState = 'awaiting_approval' | 'pending' | 'sent' | 'done' | 'failed' | 'expired'

export interface Command {
  id: string
  deviceId: string
  command: string
  payload: Record<string, unknown> | null
  state: CommandState
  issuedBy: string | null
  issuedByLabel: string | null
  issuedAt: string
  notBefore: string | null
  whenQuiet: boolean
  approvedByLabel: string | null
  approvedAt: string | null
  /** Set on each step of a fix recipe. */
  recipe: string | null
  recipeRun: string | null
  /** Tell the team's channels when it finishes. */
  notify: boolean
  sentAt: string | null
  completedAt: string | null
  expiresAt: string
  ok: boolean | null
  result: string | null
  error: string | null
}

/** How to send a command: when, and with what proof. */
export interface IssueOptions {
  payload?: Record<string, unknown>
  /** ISO time; not delivered before it. */
  notBefore?: string | null
  whenQuiet?: boolean
  /** Not before the shop's next closing time. */
  afterClosing?: boolean
  /** Tell the team's channels when it finishes (the server picks if unset). */
  notify?: boolean
  /** Your password again — only for destructive commands. */
  password?: string
}

/** A fix recipe: a few commands always run together, in order. */
export interface Recipe {
  name: string
  label: string
  description: string
  steps: string[]
  stopOnFailure: boolean
  risk: CommandRisk
  /** Can be held for a quiet till, a time, or closing. */
  holdable: boolean
  /** May go to many tills at once. */
  bulk: boolean
}

/** What `Check the hardware` brings back. */
export interface HardwareReport {
  ok: boolean
  items: { part: 'printer' | 'drawer' | 'display'; status: 'ok' | 'missing' | 'not_set' | 'unknown'; detail: string }[]
}

/** What `List stuck rows` brings back from a till (parsed from the result). */
export interface StuckRow {
  ref: string
  table: string
  rowRef: string
  attempts: number
  error: string | null
  since: string
  lastTriedAt: string
}

export interface StuckRows {
  received: StuckRow[]
  receivedTotal: number
  sending: StuckRow[]
  sendingTotal: number
}

/** What `Check the database` brings back. */
export interface DbCheck {
  ok: boolean
  tables: { table: string; rows: number | null; ms: number; error: string | null }[]
  sizeBytes: number | null
  ms: number
}

export interface Note {
  id: string
  deviceId: string
  body: string
  pinned: boolean
  authorLabel: string | null
  createdAt: string
}

/* ------------------------------------------------------------ annotations */

export interface Mute {
  id: string
  scope: 'device' | 'shop' | 'fleet'
  deviceId: string | null
  shopId: string | null
  shopName: string | null
  reason: string
  startsAt: string
  endsAt: string
  cancelledAt: string | null
  cancelledBy: string | null
  createdByLabel: string | null
  createdAt: string
  active: boolean
}

export interface MuteInput {
  scope: 'device' | 'shop' | 'fleet'
  deviceId?: string
  shopId?: string
  reason: string
  minutes: number
}

export interface TagCount {
  tag: string
  devices: number
}

export type TimelineKind = 'alert_opened' | 'alert_resolved' | 'command' | 'note' | 'mute' | 'version' | 'error' | 'rollout'

export interface TimelineEvent {
  at: string
  kind: TimelineKind
  title: string
  detail: string | null
  severity: 'warning' | 'critical' | null
  actor: string | null
}

export interface DeviceDay {
  day: string
  beats: number
  expectedBeats: number
  uptimeBps: number
  maxSyncPending: number | null
  maxSyncFailed: number | null
  salesCount: number | null
  salesPesewas: number | null
  appVersion: string | null
}

/** One heartbeat as stored: what the till said about itself at that moment. */
export interface HistoryBeat {
  capturedAt: string
  syncPending: number | null
  syncFailed: number | null
  oldestPendingAgeMs: number | null
  salesTodayCount: number | null
  salesTodayPesewas: number | null
  appVersion: string | null
  serverHealthy: boolean | null
  errorGroups: number
}

export interface DeviceHistory {
  beats: HistoryBeat[]
  days: DeviceDay[]
  uptimeBps: number | null
}

/* ---------------------------------------------------------- app problems */

export type GroupStatus = 'open' | 'resolved' | 'ignored'

export interface ErrorGroup {
  id: string
  fingerprint: string
  message: string
  source: string | null
  stack: string | null
  totalCount: number
  deviceCount: number
  firstVersion: string | null
  lastVersion: string | null
  firstSeen: string
  lastSeen: string
  status: GroupStatus
  resolvedAt: string | null
  resolvedByLabel: string | null
  resolvedInVersion: string | null
  regressedAt: string | null
}

export interface GroupPage {
  groups: ErrorGroup[]
  total: number
  limit: number
  offset: number
}

export interface GroupDevice {
  deviceId: string
  shopId: string | null
  count: number
  appVersion: string | null
  firstSeen: string
  lastSeen: string
}

/* --------------------------------------------------------------- updates */

export type RolloutState = 'canary' | 'rolling' | 'complete' | 'halted' | 'cancelled'
export type RolloutTargetState = 'pending' | 'issued' | 'updated' | 'failed' | 'skipped' | 'reverted'

export interface RolloutProgress {
  total: number
  pending: number
  issued: number
  updated: number
  failed: number
  skipped: number
  reverted: number
  canaryTotal: number
  canaryUpdated: number
}

export interface Rollout {
  id: string
  version: string
  note: string | null
  targetLabel: string | null
  state: RolloutState
  canaryPercent: number
  haltErrorDevices: number
  observeMinutes: number
  canaryIssuedAt: string | null
  promotedAt: string | null
  completedAt: string | null
  haltedAt: string | null
  haltReason: string | null
  createdByLabel: string | null
  createdAt: string
  progress: RolloutProgress
}

export interface RolloutTarget {
  id: string
  deviceId: string
  shopName: string | null
  wave: number
  state: RolloutTargetState
  fromVersion: string | null
  issuedAt: string | null
  confirmedAt: string | null
  note: string | null
}

export interface RolloutDetail extends Rollout {
  targets: RolloutTarget[]
}

export interface RolloutInput {
  version: string
  deviceIds: string[]
  targetLabel?: string | null
  note?: string | null
  canaryPercent?: number
  haltErrorDevices?: number
  observeMinutes?: number
}

/* ---------------------------------------------------------- remote fixes */

export interface CommandHistoryRow extends Command {
  shopId: string | null
  shopName: string | null
}

export interface CommandHistoryPage {
  commands: CommandHistoryRow[]
  total: number
  limit: number
  offset: number
}

/* ---------------------------------------------------------------- history */

export interface TrendDay {
  day: string
  uptimeBps: number | null
  devices: number
  salesCount: number
  salesPesewas: number
  backedUp: number
  alertsOpened: number
  criticalOpened: number
}

export interface Trends {
  days: TrendDay[]
  versions: { day: string; version: string; devices: number }[]
  summary: {
    uptimeBps: number | null
    previousUptimeBps: number | null
    salesPesewas: number
    previousSalesPesewas: number
    alertsOpened: number
    previousAlertsOpened: number
  }
}

export interface ShopSlo {
  shopId: string | null
  shopName: string | null
  devices: number
  days: number
  uptimeBps: number
  targetBps: number
  budgetUsedPct: number
  budgetMinutesLeft: number
  breaching: boolean
  worstDay: { day: string; uptimeBps: number } | null
}

export interface VersionScore {
  version: string
  devices: number
  offline: number
  faultGroups: number
  faultDevices: number
  occurrences: number
  cleanPct: number
}

export interface WorstOffender {
  deviceId: string
  shopId: string | null
  shopName: string | null
  uptimeBps: number
  days: number
  downtimeHours: number
}

export interface SyncPressure {
  deviceId: string
  shopId: string | null
  shopName: string | null
  syncPending: number | null
  syncFailed: number | null
  oldestPendingAgeMs: number | null
  lastPulledAt: string | null
  pullQuarantined: number | null
  lastReportAt: string
}

export interface Digest {
  day: string
  terminals: number
  offline: number
  alertsOpened: number
  criticalsOpen: number
  salesPesewas: number
  worstShops: { shopName: string | null; uptimeBps: number }[]
  neverBackedUp: number
  lines: string[]
}

export interface ShopQuality {
  shopId: string
  shopName: string
  oversold: number
  expiredLots: number
  expiredUnits: number
  staleShifts: number
  oldestShiftHours: number | null
  losingMoney: number
  issues: number
}

export interface BackupTerminal {
  deviceId: string
  shopId: string | null
  shopName: string | null
  lastBackupAt: string | null
  backupSizeBytes: number | null
  backupError: string | null
  dbSizeBytes: number | null
  lastReportAt: string
  mode: string | null
}

/* --------------------------------------------------------------- settings */

export interface OperatorAccount extends Operator {
  active: boolean
  lastLoginAt: string | null
  createdAt: string
  /** When they turned sign-in codes on; null if they haven't. */
  twoFactorAt?: string | null
}

export interface OperatorInput {
  email: string
  name: string
  password: string
  role: Role
}

export interface AuditEntry {
  id: string
  actorLabel: string | null
  action: string
  targetType: string | null
  targetId: string | null
  detail: unknown
  ip: string | null
  createdAt: string
}

export interface Rule {
  key: string
  label: string
  description: string
  enabled: boolean
  severity: 'warning' | 'critical' | null
  runbookUrl: string | null
  notes: string | null
  /** The fix it runs on a till when it opens an alert there: `recipe:…` or `command:…`. */
  autoFix: string | null
  /** The fixes that suit this rule; empty when it has none. */
  autoFixChoices: { value: string; label: string }[]
  updatedBy: string | null
}

export interface Thresholds {
  offlineAfterMs: number
  syncPendingDeep: number
  oldestPendingStuckMs: number
  pullStaleMs: number
  recentErrorWindowMs: number
  errorSpikeGroups: number
  flatlineUptimeSec: number
  flatlineMinSellingDays: number
}

export interface FleetSettings {
  quietStartMinute: number
  quietEndMinute: number
  quietTimezone: string
  quietBreakthrough: 'critical' | 'none'
  sloTargetBps: number
  stormShopDevices: number
  escalateAfterMs: number
  escalateMaxTimes: number
  digestHour: number | null
  /** A second operator must approve locks and discarded rows. */
  requireCommandApproval: boolean
  /** Every operator signs in with a code from an authenticator app. Absent on older servers. */
  requireTwoFactor?: boolean
}

export interface FleetConfig extends Thresholds, FleetSettings {
  webhookLastSuccessAt: string | null
  webhookLastFailureAt: string | null
  webhookLastFailureError: string | null
  updatedBy: string | null
  updatedAt: string
  digestSentAt: string | null
}

export type ChannelKind = 'webhook' | 'push_owner'

export interface Channel {
  id: string
  kind: ChannelKind
  label: string
  target: string | null
  minSeverity: 'warning' | 'critical'
  respectQuietHours: boolean
  ruleKeys: string[] | null
  active: boolean
  managed: boolean
  lastSuccessAt: string | null
  lastFailureAt: string | null
  lastError: string | null
}

export interface ChannelInput {
  kind: ChannelKind
  label: string
  target?: string | null
  minSeverity?: 'warning' | 'critical'
  respectQuietHours?: boolean
  ruleKeys?: string[] | null
  active?: boolean
}

export interface Delivery {
  id: string
  direction: 'open' | 'resolve'
  sentAt: string | null
  attempts: number
  lastError: string | null
  heldUntil: string | null
  channelLabel: string
  channelKind: ChannelKind
}

export interface Holiday {
  season: string
  year: number
  day: string
  source: 'feed' | 'manual'
  updatedAt: string
}

export interface HolidayFeed {
  at: string | null
  ok: boolean
  found: number
  error: string | null
}

/* -------------------------------------------------------------- assistant */

export type ModelId = string

export interface AssistantModel {
  id: ModelId
  label: string
  blurb: string
  price: { input: number; output: number; cacheRead: number; cacheWrite: number }
}

export type LimitMetric = 'requests' | 'spend' | 'tokens'
export type LimitPeriod = 'hour' | 'day' | 'week' | 'month'

export interface LimitRule {
  metric: LimitMetric
  period: LimitPeriod
  feature: string | null
  value: number | null
}

export interface LimitStanding extends LimitRule {
  value: number
  used: number
  source: 'fleet' | 'shop'
  resetsAt: string | null
}

export type ReportPeriod = 'today' | 'week' | 'month' | 'last_month' | '30d'

export interface AssistantTotals {
  requests: number
  errors: number
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
  totalTokens: number
  costMicros: number
}

export interface AssistantDay {
  day: string
  requests: number
  tokens: number
  costMicros: number
}

export interface FleetAssistantUsage {
  period: ReportPeriod
  range: { from: string; to: string | null }
  totals: AssistantTotals
  shops: Array<
    AssistantTotals & {
      shopId: string
      shopName: string
      lastUsedAt: string
      model: ModelId
      nearestLimit: (Omit<LimitStanding, 'value' | 'used'> & { value: number; used: number; share: number }) | null
    }
  >
  byDay: AssistantDay[]
}

export interface AssistantSwitches {
  systemEnabled: boolean
  systemChangedBy: string | null
  systemChangedAt: string | null
  apiKey: {
    source: 'console' | 'environment' | null
    hint: string | null
    setBy: string | null
    setAt: string | null
    unreadable: boolean
    canStore: boolean
  }
  defaults: { model: ModelId }
  limits: LimitRule[]
  serverHourlyLimit: number
  models: AssistantModel[]
  enabledShops: Array<{ shopId: string; shopName: string; enabledBy: string | null; enabledAt: string }>
  notEnabledCount: number
  blockedShops: Array<{ shopId: string; shopName: string; reason: string | null; disabledBy: string | null; disabledAt: string }>
}

export interface ShopAssistant {
  settings: {
    model: ModelId | null
    briefing: boolean
    invoiceReading: boolean
    updatedBy: string | null
    updatedAt: string | null
  }
  plan: { model: ModelId; briefing: boolean; invoiceReading: boolean }
  limits: { fleet: LimitRule[]; own: LimitRule[]; current: LimitStanding[] }
  access: { allowed: true } | { allowed: false; by: 'system' | 'shop' }
  usage: {
    period: ReportPeriod
    totals: AssistantTotals
    byKind: Array<AssistantTotals & { kind: string }>
    byModel: Array<AssistantTotals & { model: string }>
    byDay: AssistantDay[]
    lastUsedAt: string | null
  }
}

export interface AssistantBrief {
  content: { headline: string; points: string[]; actions: string[] }
  createdAt: string
  cached: boolean
}

/* ------------------------------------------------------- shop onboarding */

export const BUSINESS_TYPES = [
  'provisions',
  'supermarket',
  'pharmacy',
  'beauty',
  'electronics',
  'hardware',
  'fashion',
  'repairs',
  'restaurant',
  'other',
] as const
export type BusinessType = (typeof BUSINESS_TYPES)[number]

export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  provisions: 'Provisions & groceries',
  supermarket: 'Supermarket or mini-mart',
  pharmacy: 'Pharmacy or chemist',
  beauty: 'Cosmetics & beauty',
  electronics: 'Phones & electronics',
  hardware: 'Hardware & building',
  fashion: 'Fashion, clothing & shoes',
  repairs: 'Repairs & services',
  restaurant: 'Restaurant, chop bar or bar',
  other: 'Other',
}

export interface ProvisionInput {
  shopName: string
  location?: string
  phone?: string
  currency?: string
  ownerName: string
  staffId: string
  businessType: BusinessType
}

export interface ProvisionResult {
  shopId: string
  shopCode: string
  ownerId: string
  claimCode: string
  expiresAt: string
}

export interface EditionFeature {
  key: string
  label: string
  description: string
  built: boolean
  enabled: boolean
  source: string | null
  reason: string | null
  changedBy: string | null
  changedAt: string | null
  minAppVersion: string | null
}

export interface ShopEdition {
  shopId: string
  businessType: BusinessType | null
  businessTypes: BusinessType[]
  version: number
  setupCompletedAt: string | null
  features: EditionFeature[]
}

/* -------------------------------------------------------- shop inventory */

export type StockStatus = 'ok' | 'low' | 'out' | 'oversold'

export interface ShopProduct {
  id: string
  name: string
  category: string
  barcode: string | null
  /** Major units (cedis), as the server renders them — display only. */
  costPrice: number
  sellingPrice: number
  stock: number
  expiredStock: number
  sold: number
  reorderLevel: number | null
  packLabel: string | null
  unitsPerPack: number | null
  expiryDate: string
  hidden: boolean
  status: StockStatus
  /** Each piece carries a serial number; receiving needs one per piece. */
  trackSerials?: boolean
  /** "kg" / "l" / "m" when sold by weight — then every quantity is in thousandths. */
  soldBy?: string | null
}

export interface ShopInventory {
  summary: {
    products: number
    lowStock: number
    outOfStock: number
    oversold: number
    hidden: number
    unitsOnHand: number
    expiredUnits: number
  }
  categories: string[]
  products: ShopProduct[]
}

export type ExportType = 'products' | 'sales' | 'profit' | 'tax' | 'wastage' | 'deadstock'
export type ExportFormat = 'csv' | 'pdf'

export interface ImportResult {
  imported: number
  updated: number
  failed: number
  total: number
  errors: { row: number; message: string; code?: string }[]
}

export interface NewProductInput {
  name: string
  category?: string
  costPrice: number
  sellingPrice: number
  openingStock?: number
  expiryDate?: string
  barcode?: string | null
  reorderLevel?: number | null
}

export interface ReceiveStockInput {
  supplier?: string
  invoiceNumber?: string
  lines: {
    productId: string
    costPrice: number
    sellingPrice: number
    stock: number
    unit?: 'pack' | 'piece'
    expiryDate?: string
    serials?: string[]
  }[]
}

/* --------------------------------------------- the shops as accounts --- */

export interface QuietShop {
  shopId: string
  name: string
  code: string | null
  phone: string | null
  owner: string | null
  reason: 'stopped' | 'dropping'
  why: string
  lastSaleAt: string | null
  lastWeekSales: number
  lastWeekPesewas: number
  usualWeekSales: number
  lastContactAt: string | null
}

export interface SetupStep {
  key: 'claimed' | 'tills' | 'products' | 'staff' | 'firstSale' | 'backups'
  label: string
  done: boolean
  detail: string
}

export interface SetupProgress {
  shopId: string
  name: string
  code: string | null
  owner: string | null
  createdAt: string
  daysIn: number
  steps: SetupStep[]
  done: number
}

export type LagReason = 'held' | 'offline' | 'failed' | 'waiting' | 'not_sent'

export interface UpdateLag {
  latest: string | null
  total: number
  onLatest: number
  byVersion: { version: string; tills: number }[]
  behind: { deviceId: string; shopId: string | null; shopName: string | null; version: string | null; reason: LagReason; detail: string; lastReportAt: string | null }[]
}

export type CalendarKind = 'schedule' | 'deletion' | 'follow_up' | 'renewal' | 'setup_code' | 'mute_ends' | 'rollout' | 'hold'

export interface CalendarEvent {
  at: string
  kind: CalendarKind
  title: string
  detail?: string
  shopId?: string | null
  deviceId?: string | null
}

export type ContactKind = 'call' | 'visit' | 'message' | 'note'

export interface ShopContact {
  id: string
  shopId: string
  kind: ContactKind
  summary: string
  followUpAt: string | null
  doneAt: string | null
  doneByLabel: string | null
  createdBy: string | null
  createdByLabel: string | null
  createdAt: string
}

export interface FollowUp {
  id: string
  shopId: string
  shopName: string
  summary: string
  followUpAt: string
}

export type SubscriptionState = 'paid' | 'due_soon' | 'overdue' | 'none'

export interface ShopSubscription {
  plan: string
  amountPesewas: number
  every: 'month' | 'year'
  paidUntil: string
  remindDays: number
  notes: string | null
  lastRemindedAt: string | null
  updatedByLabel: string | null
}

export interface ShopPayment {
  id: string
  amountPesewas: number
  paidAt: string
  coversUntil: string
  method: string | null
  reference: string | null
  recordedByLabel: string | null
}

export interface SubscriptionView {
  subscription: ShopSubscription | null
  state: SubscriptionState
  payments: ShopPayment[]
  features: string[]
}

export interface SubscriptionRow {
  shopId: string
  name: string
  code: string | null
  state: SubscriptionState
  plan: string | null
  amountPesewas: number | null
  every: 'month' | 'year' | null
  paidUntil: string | null
  lastRemindedAt: string | null
}

/* ------------------------------------------------------------ support ---- */

export interface ShopOwnerAccount {
  id: string
  name: string
  staffId: string
  active: boolean
}

/** A shop's owner reset codes, as the console may see them (never the code). */
export interface OwnerResetView {
  owners: ShopOwnerAccount[]
  live: { userId: string; expiresAt: string; issuedByLabel: string | null; createdAt: string } | null
  lastUsed: { userId: string; usedAt: string; issuedByLabel: string | null } | null
}

export interface OwnerResetIssued {
  code: string
  expiresAt: string
  owner: ShopOwnerAccount
}

export interface FoundSaleLine {
  name: string
  qty: number
  soldBy: string | null
  unitPrice: number
  lineTotal: number
  discount: number
  options: string | null
}

export interface FoundSale {
  id: string
  shopId: string
  shopName: string
  shopCode: string | null
  currency: string
  receipt: string
  terminalCode: string | null
  receiptNumber: number
  createdAt: string
  receivedAt: string | null
  total: number
  paymentType: string
  cashAmount: number
  momoAmount: number
  momoRef: string | null
  momoNetwork: string | null
  creditAmount: number
  discount: number
  cashier: string | null
  lines: FoundSaleLine[]
  voided: { at: string; reason: string | null; by: string | null } | null
  returns: { at: string; refundTotal: number; method: string; reason: string | null }[]
  drawer: { id: string; openedAt: string; closedAt: string | null; cashier: string | null } | null
  till: { deviceId: string; name: string | null; lastReportAt: string | null; syncPending: number | null; lastSyncAt: string | null } | null
}

export interface TillHint {
  terminalCode: string
  deviceId: string
  name: string | null
  removed: boolean
  highestReceipt: number | null
  highestReceiptAt: string | null
  lastReportAt: string | null
  syncPending: number | null
  syncFailed: number | null
  lastSyncAt: string | null
}

export interface ReceiptSearch {
  query: { terminalCode: string | null; number: number } | null
  sales: FoundSale[]
  tills: TillHint[] | null
}

export type HelpStatus = 'open' | 'answered' | 'closed'

export interface HelpRequest {
  id: string
  shopId: string
  shopName: string | null
  shopCode: string | null
  deviceId: string | null
  requesterName: string | null
  requesterRole: string | null
  source: 'till' | 'phone'
  message: string
  callbackPhone: string | null
  screen: string | null
  status: HelpStatus
  reply: string | null
  repliedAt: string | null
  repliedByLabel: string | null
  closedAt: string | null
  closedByLabel: string | null
  createdAt: string
}

export interface HelpSnapshot {
  terminalCode: string | null
  appVersion: string | null
  lastReportAt: string | null
  serverHealthy: boolean | null
  syncPending: number | null
  syncFailed: number | null
  lastSyncAt: string | null
  lastPulledAt: string | null
  diskFreeBytes: number | null
  lastBackupAt: string | null
  locked: boolean
}

export interface HelpRequestDetail extends HelpRequest {
  tillName: string | null
  snapshot: HelpSnapshot | null
  logs: { id: string; state: string; ok: boolean | null; result: string | null; error: string | null; completedAt: string | null } | null
  logsNote: string | null
  /** After a reply: whether it reached the owner's phone too. */
  pushed?: boolean
}

export interface HelpList {
  requests: HelpRequest[]
  counts: Partial<Record<HelpStatus, number>>
}

export interface Phone {
  installId: string
  shopId: string
  shopName: string | null
  userName: string | null
  userRole: string | null
  platform: string | null
  osVersion: string | null
  model: string | null
  appVersion: string | null
  buildNumber: string | null
  runtimeVersion: string | null
  updateId: string | null
  updateCreatedAt: string | null
  channel: string | null
  embedded: boolean | null
  firstSeenAt: string
  lastSeenAt: string
  /** Occurrences in the window, and how many different faults. */
  errors: number
  errorKinds: number
}

export interface PhoneVersion {
  appVersion: string | null
  updateId: string | null
  updateCreatedAt: string | null
  channel: string | null
  count: number
  errors: number
}

export interface PhoneList {
  phones: Phone[]
  versions: PhoneVersion[]
  days: number
}

export interface PhoneError {
  id: string
  fingerprint: string
  message: string
  stack: string | null
  appVersion: string | null
  count: number
  firstSeen: string
  lastSeen: string
}

export type CloudLevel = 'ok' | 'warning' | 'critical'

export interface CloudWarning {
  key: string
  level: Exclude<CloudLevel, 'ok'>
  title: string
  detail: string
}

export interface CloudHealth {
  checkedAt: string
  server: { imageTag: string | null; node: string; startedAt: string; rssBytes: number; lastAlertPassAt: string | null }
  disk: { path: string; freeBytes: number; totalBytes: number } | null
  diskLevel: CloudLevel
  runway: { bytesPerDay: number | null; fullInDays: number | null }
  database: {
    bytes: number
    version: string | null
    connections: number
    maxConnections: number
    largest: { name: string; bytes: number; rows: number }[]
    migrations: { applied: number; shipped: number | null; lastAppliedAt: string | null }
  }
  backups: {
    visible: boolean
    dir: string | null
    files: { name: string; bytes: number; modifiedAt: string }[]
    newestAt: string | null
    offsiteAt: string | null
    /** The nightly restore check (absent from an older server). */
    verified?: RestoreCheck | null
  }
  cert: { host: string; validTo: string | null; error: string | null } | null
  history: { day: string; dbBytes: number | null; diskFreeBytes: number | null; diskTotalBytes: number | null }[]
  warnings: CloudWarning[]
  /** The rest arrived with the second Cloud release; an older server leaves them out. */
  machine?: CloudMachine
  boots?: { recent: CloudBoot[]; lastHour: number }
  requests?: { day: { requests: number; clientErrors: number; serverErrors: number }; last15m: { requests: number; serverErrors: number }; since: string }
  dependencies?: CloudDependency[]
  settings?: { checked: number; problems: number }
}

export interface RestoreCheck {
  at: string
  dump: string | null
  ok: boolean
  tables: number | null
  sales: number | null
  error: string | null
}

export interface CloudMachine {
  cpus: number
  load: number[]
  uptimeSec: number
  memory: {
    totalBytes: number
    availableBytes: number
    swapTotalBytes: number | null
    swapFreeBytes: number | null
    containerLimitBytes: number | null
    containerUsedBytes: number | null
    measured: boolean
  }
  folders: { label: string; path: string; bytes: number; files: number; truncated: boolean }[]
}

export type CloudBootKind = 'first' | 'deploy' | 'restart' | 'rollback'

export interface CloudBoot {
  id: string
  startedAt: string
  imageTag: string | null
  kind: CloudBootKind
  from: string | null
  ranForMs: number | null
}

export interface CloudRoute {
  route: string
  requests: number
  clientErrors: number
  serverErrors: number
  avgMs: number
  p95Ms: number | null
  slowestMs: number
}

export interface CloudRequests {
  since: string
  hours: { hour: string; requests: number; clientErrors: number; serverErrors: number; p95Ms: number | null; slowestMs: number | null }[]
  routes: CloudRoute[]
  last15m: { requests: number; serverErrors: number }
  day: { requests: number; clientErrors: number; serverErrors: number }
}

export interface CloudDatabase {
  bytes: number
  version: string | null
  connections: { state: string; count: number }[]
  maxConnections: number
  largest: { name: string; bytes: number; rows: number }[]
  migrations: { applied: number; shipped: number | null; lastAppliedAt: string | null }
  openTransactions: { pid: number; state: string | null; ageMs: number; waiting: string | null; application: string | null; query: string }[]
  blocked: { pid: number; blockers: number[]; ageMs: number; query: string }[]
  deadRows: { table: string; live: number; dead: number; vacuumedAt: string | null }[]
  cacheHitPct: number | null
  commits: number
  rollbacks: number
  deadlocks: number
}

export type SettingLevel = 'required' | 'recommended' | 'optional'
export type SettingState = 'ok' | 'missing' | 'broken' | 'default'

export interface CloudSetting {
  key: string
  label: string
  level: SettingLevel
  state: SettingState
  note: string
}

export interface CloudDependency {
  name: string
  what: string
  health: 'ok' | 'failing' | 'unused' | 'off'
  lastOkAt: string | null
  lastFailAt: string | null
  lastError: string | null
}
