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
  machines: ShopMachine[]
}

export interface CommandSpec {
  name: string
  label: string
  description: string
}

export interface Command {
  id: string
  deviceId: string
  command: string
  state: 'pending' | 'sent' | 'done' | 'failed' | 'expired'
  issuedByLabel: string | null
  issuedAt: string
  completedAt: string | null
  expiresAt: string
  ok: boolean | null
  result: string | null
  error: string | null
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
