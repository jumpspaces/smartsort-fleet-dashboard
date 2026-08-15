/**
 * Client for the cloud droplet's fleet control plane.
 *
 * Sessions, not a stored password. Sign-in exchanges an operator's own
 * credentials for a short access token (30 min) and a refresh token (one working
 * day); every call carries the access token, and a 401 triggers exactly ONE
 * refresh attempt before the UI drops to the sign-in screen. That single-flight
 * refresh matters because the dashboard polls several endpoints at once — six
 * parallel 401s must not become six refresh calls, five of which race and lose.
 *
 * Health is no longer computed here. The server returns `state` and `reasons`
 * per device, because deciding them needs a time-windowed count of errors that
 * are still open after triage — a database question. This file transports; it
 * does not judge.
 */

/* ------------------------------------------------------------------- types */

export interface Operator {
  id: string
  email: string
  name: string
  role: 'admin' | 'operator' | 'viewer'
}

/** One row of `GET /fleet/operators` — the account, not the signed-in session. */
export interface OperatorAccount extends Operator {
  active: boolean
  lastLoginAt: string | null
  createdAt: string
}

export interface CreateOperatorInput {
  email: string
  name: string
  password: string
  role: 'admin' | 'operator' | 'viewer'
}

export interface Session {
  apiBase: string
  accessToken: string
  refreshToken: string
  operator: Operator
}

export type FleetState = 'healthy' | 'attention' | 'offline'

export interface HealthReason {
  code:
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
  label: string
  severity: 'critical' | 'warning'
}

export interface DeviceRow {
  deviceId: string
  shopId: string | null
  shopName: string | null
  /**
   * From the machine's store key, not the heartbeat: what the shop called this
   * machine when it connected it, and the short code ("T3") that prefixes its
   * receipts. Both null until the machine claims a key.
   */
  machineName: string | null
  terminalCode: string | null
  appVersion: string | null
  /** Renderer hot-patch in use, or null on the build from the installer. */
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
  /** Inbound sync: last successful pull, and rows received but not applied. */
  lastPulledAt: string | null
  pullQuarantined: number | null
  salesTodayCount: number | null
  salesTodayPesewas: number | null
  dbSizeBytes: number | null
  /** False = reporting on the shared enrollment secret, identity unproven. */
  keyVerified: boolean
  firstReportAt: string
  lastReportAt: string
  /** Free/total space on the terminal's own volume, as the machine measured it. */
  diskFreeBytes: number | null
  diskTotalBytes: number | null
  /** Its last local database snapshot — see the terminal's backup service. */
  lastBackupAt: string | null
  backupSizeBytes: number | null
  backupError: string | null
  /** Local minus cloud, in ms; positive means this till runs ahead. */
  clockSkewMs: number | null
  /** Server-computed. */
  state: FleetState
  reasons: HealthReason[]
  online: boolean
  recentOpenErrorGroups: number
  openAlerts: number
  /** What an operator decided, as opposed to what the terminal reported. */
  mute: DeviceMute | null
  tags: string[]
  noteCount: number
  pinnedNote: string | null
}

export interface DeviceMute {
  id: string
  scope: 'device' | 'shop' | 'fleet'
  reason: string
  endsAt: string
  createdByLabel: string | null
}

export interface MuteRow {
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

export interface NoteRow {
  id: string
  deviceId: string
  body: string
  pinned: boolean
  authorLabel: string | null
  createdAt: string
}

export interface TagCount {
  tag: string
  devices: number
}

/** One terminal's recent liveness, bucketed oldest-first. */
export interface HeartbeatStrip {
  deviceId: string
  buckets: number[]
  expectedPerBucket: number
  fromMs: number
  bucketMs: number
}

export interface DevicePage {
  devices: DeviceRow[]
  total: number
  limit: number
  offset: number
}

export interface DeviceQuery {
  q?: string
  state?: FleetState | 'all'
  shopId?: string
  platform?: string
  appVersion?: string
  tag?: string
  muted?: 'muted' | 'unmuted'
  sort?: string
  dir?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

/* ---- staged rollouts ---- */

export type RolloutState = 'canary' | 'rolling' | 'complete' | 'halted' | 'cancelled'
export type RolloutTargetState =
  | 'pending'
  | 'issued'
  | 'updated'
  | 'failed'
  | 'skipped'
  | 'reverted'

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

export interface RolloutRow {
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

export interface RolloutDetail extends RolloutRow {
  targets: RolloutTarget[]
}

export interface CreateRolloutInput {
  version: string
  deviceIds: string[]
  targetLabel?: string | null
  note?: string | null
  canaryPercent?: number
  haltErrorDevices?: number
  observeMinutes?: number
}

/* ---- notification channels ---- */

export type ChannelKind = 'webhook' | 'push_owner'

export interface ChannelRow {
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

export interface DeliveryRow {
  id: string
  direction: 'open' | 'resolve'
  sentAt: string | null
  attempts: number
  lastError: string | null
  heldUntil: string | null
  channelLabel: string
  channelKind: ChannelKind
}

/* ---- trends & SLO ---- */

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

export interface FleetTrends {
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

/* ---- one terminal's story, in order ---- */

export type TimelineKind =
  | 'alert_opened'
  | 'alert_resolved'
  | 'command'
  | 'note'
  | 'mute'
  | 'version'
  | 'error'
  | 'rollout'

export interface TimelineEvent {
  at: string
  kind: TimelineKind
  title: string
  detail: string | null
  severity: 'warning' | 'critical' | null
  actor: string | null
}

/* ---- detection rules ---- */

export interface RuleRow {
  key: string
  label: string
  description: string
  enabled: boolean
  severity: 'warning' | 'critical' | null
  runbookUrl: string | null
  notes: string | null
  updatedBy: string | null
}

/* ---- fleet-wide reads that rank rather than list ---- */

export interface VersionScore {
  version: string
  devices: number
  offline: number
  faultGroups: number
  faultDevices: number
  occurrences: number
  /** Terminals on this build that reported nothing wrong, as a percentage. */
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

export interface SyncPressureRow {
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

export interface ErrorRow {
  id: string
  deviceId: string
  shopId: string | null
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

export type GroupStatus = 'open' | 'resolved' | 'ignored'

export interface ErrorGroupRow {
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
  groups: ErrorGroupRow[]
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

export interface AlertRow {
  id: string
  ruleKey: string
  deviceId: string | null
  shopId: string | null
  shopName: string | null
  severity: 'warning' | 'critical'
  title: string
  detail: string | null
  state: 'open' | 'acknowledged' | 'resolved'
  openedAt: string
  lastSeenAt: string
  acknowledgedAt: string | null
  acknowledgedByLabel: string | null
  resolvedAt: string | null
  notifiedAt: string | null
  notifyError: string | null
  /** Devices this one alert stands in for, when it is a shop-level rollup. */
  rollupCount: number | null
  escalatedAt: string | null
  escalations: number
}

export interface CommandSpec {
  name: string
  label: string
  description: string
}

export interface CommandRow {
  id: string
  deviceId: string
  command: string
  payload: unknown
  state: 'pending' | 'sent' | 'done' | 'failed' | 'expired'
  issuedByLabel: string | null
  issuedAt: string
  sentAt: string | null
  completedAt: string | null
  expiresAt: string
  ok: boolean | null
  result: string | null
  error: string | null
}

/** One row from the fleet-wide command history — CommandRow plus where it went. */
export interface CommandHistoryRow extends CommandRow {
  shopId: string | null
  shopName: string | null
}

export interface CommandHistoryPage {
  commands: CommandHistoryRow[]
  total: number
  limit: number
  offset: number
}

export interface CommandHistoryQuery {
  command?: string
  state?: string
  shopId?: string
  limit?: number
  offset?: number
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
  /**
   * What has been published, read off the update feed — distinct from
   * `versions`, which is only ever what terminals reported running.
   */
  release: {
    latestVersion: string | null
    releasedAt: string | null
    installer: string | null
    /** Versions with a signed bundle; the only ones a rollout can name. */
    rollableVersions: string[]
    available: boolean
  }
}

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

export interface DeviceDayRow {
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

export interface DeviceHistory {
  beats: HistoryBeat[]
  days: DeviceDayRow[]
  uptimeBps: number | null
}

/** Tunable detection thresholds — mirrors server FleetThresholds, all raw units (ms/sec/count). */
export interface FleetThresholds {
  offlineAfterMs: number
  syncPendingDeep: number
  oldestPendingStuckMs: number
  pullStaleMs: number
  recentErrorWindowMs: number
  errorSpikeGroups: number
  flatlineUptimeSec: number
  flatlineMinSellingDays: number
}

export interface FleetConfigRow extends FleetThresholds {
  webhookLastSuccessAt: string | null
  webhookLastFailureAt: string | null
  webhookLastFailureError: string | null
  updatedBy: string | null
  updatedAt: string
  /** Minutes from local midnight; equal values mean no quiet window at all. */
  quietStartMinute: number
  quietEndMinute: number
  quietTimezone: string
  quietBreakthrough: 'critical' | 'none'
  sloTargetBps: number
  stormShopDevices: number
  escalateAfterMs: number
  escalateMaxTimes: number
  digestHour: number | null
  digestSentAt: string | null
}

/** Quiet hours and the availability target — routing, not detection. */
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

export interface AuditRow {
  id: string
  actorLabel: string | null
  action: string
  targetType: string | null
  targetId: string | null
  detail: unknown
  ip: string | null
  createdAt: string
}

/* ---- store onboarding: /api/stores/*, same operator session ---- */

export interface ShopMachine {
  keyId: string
  machineId: string
  machineName: string | null
  terminalCode: string
  /** 'peer' machines are additional tills sharing this shop by design, not a policy violation. */
  mode: 'exclusive' | 'peer'
  keyPrefix: string
  createdAt: string
  lastSeenAt: string | null
  revokedAt: string | null
  lastReportAt: string | null
}

export interface ShopRow {
  id: string
  name: string
  /** Typed alongside the staff ID when signing in to the cloud. */
  code: string | null
  location: string | null
  phone: string | null
  currency: string
  createdAt: string
  owner: { id: string; name: string; staffId: string; active: boolean } | null
  activated: boolean
  hasLiveClaimCode: boolean
  claimCodeExpiresAt: string | null
  /** Counts across this shop's reporting terminals — not machines(), which includes ones that never reported. */
  health: { healthy: number; attention: number; offline: number }
  machines: ShopMachine[]
}

export interface ProvisionInput {
  shopName: string
  location?: string
  phone?: string
  currency?: string
  ownerName: string
  staffId: string
}

export interface ProvisionResult {
  shopId: string
  shopCode: string
  ownerId: string
  claimCode: string
  expiresAt: string
}

/* ---- a shop's inventory, read and written on its behalf ---- */

/** Server-computed shelf state — the same four words the shop's own app uses. */
export type StockStatus = 'ok' | 'low' | 'out' | 'oversold'

export interface ShopProduct {
  id: string
  name: string
  category: string
  barcode: string | null
  /** Cedis, not pesewas: this list is rendered, never arithmetic'd. */
  costPrice: number
  sellingPrice: number
  /** Sellable units on hand. Excludes lapsed lots — those are `expiredStock`. */
  stock: number
  expiredStock: number
  sold: number
  reorderLevel: number | null
  packLabel: string | null
  unitsPerPack: number | null
  /** dd/mm/yyyy of the next lot out the door, or '' when nothing is dated. */
  expiryDate: string
  hidden: boolean
  status: StockStatus
}

export interface ShopInventorySummary {
  products: number
  lowStock: number
  outOfStock: number
  oversold: number
  hidden: number
  unitsOnHand: number
  expiredUnits: number
}

export interface ShopInventory {
  summary: ShopInventorySummary
  categories: string[]
  products: ShopProduct[]
}

/** What a shop's books can be downloaded as. */
export type ExportType = 'products' | 'sales' | 'profit' | 'tax' | 'wastage' | 'deadstock'
export type ExportFormat = 'csv' | 'pdf'

export interface ExportQuery {
  type: ExportType
  format?: ExportFormat
  /** YYYY-MM-DD, inclusive at both ends. Ignored by the snapshot types. */
  from?: string
  to?: string
}

/** A downloaded file, still in memory — the caller decides where it goes. */
export interface DownloadedFile {
  filename: string
  blob: Blob
}

/** One rejected row of a CSV import, reported with its line in the file. */
export interface ImportRowError {
  row: number
  message: string
  code?: string
}

export interface ImportResult {
  imported: number
  updated: number
  failed: number
  total: number
  errors: ImportRowError[]
}

export interface NewProductInput {
  name: string
  category?: string
  costPrice: number
  sellingPrice: number
  openingStock?: number
  /** dd/mm/yyyy. Omitted or blank creates an undated lot. */
  expiryDate?: string
  barcode?: string | null
  reorderLevel?: number | null
  packLabel?: string | null
  unitsPerPack?: number | null
  tracksExpiry?: boolean
}

export interface ReceiveStockLine {
  productId: string
  costPrice: number
  sellingPrice: number
  stock: number
  unit?: 'pack' | 'piece'
  expiryDate?: string
}

export interface ReceiveStockInput {
  supplier?: string
  invoiceNumber?: string
  lines: ReceiveStockLine[]
}

/* ----------------------------------------------------------------- errors */

export class Unauthorized extends Error {}

/** Thrown for a 403 — signed in, but this role may not do that. */
export class Forbidden extends Error {}

const trimBase = (base: string) => base.replace(/\/+$/, '')

async function failure(res: Response): Promise<Error> {
  const body = (await res.json().catch(() => null)) as
    | { error?: string; message?: string }
    | null
  const message = body?.message ?? `Request failed (HTTP ${res.status})`
  if (res.status === 403) return new Forbidden(message)
  return new Error(message)
}

/* ------------------------------------------------------------------ login */

export async function signIn(
  apiBase: string,
  email: string,
  password: string,
): Promise<Session> {
  const res = await fetch(`${trimBase(apiBase)}/fleet/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (res.status === 503) {
    throw new Error('The fleet control plane is not enabled on this server')
  }
  if (!res.ok) throw await failure(res)
  const body = (await res.json()) as Omit<Session, 'apiBase'>
  return { apiBase: trimBase(apiBase), ...body }
}

/* ----------------------------------------------------------------- client */

export interface Api {
  operator: Operator
  apiBase: string
  overview(): Promise<Overview>
  devices(query?: DeviceQuery): Promise<DevicePage>
  device(deviceId: string): Promise<DeviceRow>
  deviceHistory(deviceId: string, hours?: number): Promise<DeviceHistory>
  deviceErrors(deviceId: string): Promise<ErrorRow[]>
  errorGroups(query?: { status?: GroupStatus | 'all'; q?: string; limit?: number; offset?: number }): Promise<GroupPage>
  /** One fault by fingerprint, whether or not any current filter would list it. */
  errorGroup(fingerprint: string): Promise<ErrorGroupRow>
  groupDevices(fingerprint: string): Promise<GroupDevice[]>
  setGroupStatus(
    fingerprint: string,
    status: GroupStatus,
    resolvedInVersion?: string | null,
  ): Promise<void>
  alerts(state?: string): Promise<AlertRow[]>
  acknowledgeAlert(id: string): Promise<void>
  /** Force a pass now instead of waiting for the next minute — for "I just fixed it". */
  evaluateAlerts(): Promise<void>
  fleetConfig(): Promise<{ config: FleetConfigRow; defaults: FleetThresholds }>
  updateFleetConfig(patch: Partial<FleetThresholds>): Promise<FleetConfigRow>
  updateFleetSettings(patch: Partial<FleetSettings>): Promise<FleetConfigRow>

  /* -- what an operator decided about a terminal -- */

  /** Recent liveness for a whole page at once, bucketed for the row strip. */
  heartbeats(deviceIds: string[], hours?: number): Promise<HeartbeatStrip[]>
  notes(deviceId: string): Promise<NoteRow[]>
  addNote(deviceId: string, body: string, pinned?: boolean): Promise<NoteRow>
  pinNote(id: string, pinned: boolean): Promise<void>
  deleteNote(id: string): Promise<void>
  tagCatalogue(): Promise<TagCount[]>
  addTag(deviceId: string, tag: string): Promise<string>
  removeTag(deviceId: string, tag: string): Promise<void>
  mutes(all?: boolean): Promise<MuteRow[]>
  openMute(input: {
    scope: 'device' | 'shop' | 'fleet'
    deviceId?: string
    shopId?: string
    reason: string
    minutes: number
  }): Promise<MuteRow>
  cancelMute(id: string): Promise<void>

  /* -- staged rollouts -- */

  rollouts(): Promise<{ rollouts: RolloutRow[]; active: RolloutRow | null }>
  rollout(id: string): Promise<RolloutDetail>
  createRollout(input: CreateRolloutInput): Promise<RolloutDetail>
  promoteRollout(id: string): Promise<RolloutDetail>
  haltRollout(id: string): Promise<RolloutDetail>
  rollbackRollout(id: string): Promise<{ reverted: number; rollout: RolloutDetail }>

  /* -- routing -- */

  channels(): Promise<ChannelRow[]>
  createChannel(input: ChannelInput): Promise<ChannelRow>
  updateChannel(id: string, patch: Partial<ChannelInput>): Promise<ChannelRow>
  deleteChannel(id: string): Promise<void>
  testChannel(id: string): Promise<{ ok: boolean; error: string | null }>
  alertDeliveries(alertId: string): Promise<DeliveryRow[]>

  /* -- history and promises -- */

  timeline(deviceId: string, days?: number): Promise<TimelineEvent[]>
  rules(): Promise<RuleRow[]>
  updateRule(
    ruleKey: string,
    patch: {
      enabled?: boolean
      severity?: 'warning' | 'critical' | null
      runbookUrl?: string | null
    },
  ): Promise<void>
  resetRule(ruleKey: string): Promise<void>
  versionScores(): Promise<VersionScore[]>
  worstOffenders(days?: number, limit?: number): Promise<WorstOffender[]>
  quality(): Promise<ShopQuality[]>
  syncPressure(): Promise<SyncPressureRow[]>
  digest(): Promise<Digest>
  sendDigest(): Promise<Digest>
  trends(days?: number): Promise<FleetTrends>
  slo(days?: number): Promise<{ targetBps: number; days: number; shops: ShopSlo[] }>
  backups(): Promise<BackupTerminal[]>
  audit(limit?: number): Promise<AuditRow[]>
  operators(): Promise<OperatorAccount[]>
  createOperator(input: CreateOperatorInput): Promise<Operator>
  setOperatorActive(id: string, active: boolean): Promise<void>
  setOperatorPassword(id: string, password: string): Promise<void>
  commandCatalogue(): Promise<CommandSpec[]>
  deviceCommands(deviceId: string): Promise<CommandRow[]>
  issueCommand(deviceId: string, command: string, payload?: unknown): Promise<CommandRow>
  cancelCommand(id: string): Promise<void>
  commandHistory(query?: CommandHistoryQuery): Promise<CommandHistoryPage>
  shops(): Promise<ShopRow[]>
  /**
   * One shop by id. There is no single-shop endpoint — the list is the whole
   * fleet's shops and is small — so this narrows the list rather than pretending
   * to be a cheaper call than it is.
   */
  shop(shopId: string): Promise<ShopRow | null>
  provisionShop(input: ProvisionInput): Promise<ProvisionResult>
  reissueClaimCode(shopId: string): Promise<{ claimCode: string; expiresAt: string }>
  /**
   * A one-time code that attaches another machine to a LIVE shop, for when the
   * owner can't sign in to do it themselves. Unlike a claim code it sets no
   * password and grants no session — see stores.service.ts#issueReconnectCode.
   */
  issueReconnectCode(shopId: string): Promise<{ reconnectCode: string; expiresAt: string }>
  revokeStoreKey(keyId: string): Promise<void>

  /* -- a shop's inventory, on its behalf -- */

  shopInventory(shopId: string): Promise<ShopInventory>
  /**
   * Fetch one of the shop's books as a file. Returned rather than saved so the
   * caller can name the download, show an error inline, or (later) preview it —
   * a bare `window.open` would have carried no Authorization header anyway.
   */
  shopExport(shopId: string, query: ExportQuery): Promise<DownloadedFile>
  importShopProducts(shopId: string, csv: string): Promise<ImportResult>
  importShopBatches(shopId: string, csv: string): Promise<ImportResult>
  createShopProduct(shopId: string, input: NewProductInput): Promise<ShopProduct>
  receiveShopStock(shopId: string, input: ReceiveStockInput): Promise<void>
}

/**
 * Build the API surface for a signed-in session.
 *
 * `onRenewed` is called whenever a refresh produces new tokens so the caller can
 * persist them; `onExpired` when the session is beyond saving.
 */
export function createApi(
  initial: Session,
  hooks: { onRenewed: (s: Session) => void; onExpired: () => void },
): Api {
  let session = initial
  // One shared refresh at a time. Six concurrent 401s should produce one refresh
  // and five waiters, not six competing attempts that invalidate each other.
  let refreshing: Promise<boolean> | null = null

  async function refresh(): Promise<boolean> {
    refreshing ??= (async () => {
      try {
        const res = await fetch(`${session.apiBase}/fleet/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: session.refreshToken }),
        })
        if (!res.ok) return false
        const body = (await res.json()) as Omit<Session, 'apiBase'>
        session = { apiBase: session.apiBase, ...body }
        hooks.onRenewed(session)
        return true
      } catch {
        return false
      } finally {
        // Cleared on the next tick so waiters settled in this microtask all read
        // the same result before another refresh can start.
        setTimeout(() => {
          refreshing = null
        }, 0)
      }
    })()
    return refreshing
  }

  /**
   * One authorised request, refresh-and-retry included, returning the raw
   * Response. Split out from `call` because not every endpoint answers with
   * JSON — the export routes answer with a file, and a download must ride the
   * same session handling as everything else rather than reinvent it.
   */
  async function request(path: string, init?: RequestInit, retried = false): Promise<Response> {
    const res = await fetch(`${session.apiBase}${path}`, {
      ...init,
      headers: {
        // A caller that sets its own Content-Type (the CSV importers) wins:
        // `init.headers` is spread after this default.
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
        Authorization: `Bearer ${session.accessToken}`,
      },
    })

    if (res.status === 401 && !retried) {
      if (await refresh()) return request(path, init, true)
      hooks.onExpired()
      throw new Unauthorized('Session expired')
    }
    if (res.status === 401) {
      hooks.onExpired()
      throw new Unauthorized('Session expired')
    }
    if (!res.ok) throw await failure(res)
    return res
  }

  const call = async <T>(path: string, init?: RequestInit): Promise<T> =>
    (await request(path, init)).json() as Promise<T>

  const post = <T>(path: string, body?: unknown) =>
    call<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

  /** POST a raw spreadsheet — the importers take the file as the body. */
  const postCsv = <T>(path: string, csv: string) =>
    call<T>(path, { method: 'POST', body: csv, headers: { 'Content-Type': 'text/csv' } })

  const shopPath = (shopId: string, suffix: string) =>
    `/api/stores/${encodeURIComponent(shopId)}${suffix}`

  const query = (params: Record<string, string | number | undefined>): string => {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '' && v !== 'all') qs.set(k, String(v))
    }
    const s = qs.toString()
    return s ? `?${s}` : ''
  }

  return {
    get operator() {
      return session.operator
    },
    get apiBase() {
      return session.apiBase
    },

    overview: () => call<Overview>('/fleet/overview'),

    devices: (q = {}) =>
      call<DevicePage>(
        `/fleet/devices${query({
          q: q.q,
          state: q.state,
          shopId: q.shopId,
          platform: q.platform,
          version: q.appVersion,
          tag: q.tag,
          muted: q.muted,
          sort: q.sort,
          dir: q.dir,
          limit: q.limit,
          offset: q.offset,
        })}`,
      ),

    device: async (deviceId) =>
      (await call<{ device: DeviceRow }>(`/fleet/devices/${encodeURIComponent(deviceId)}`)).device,

    deviceHistory: (deviceId, hours = 48) =>
      call<DeviceHistory>(
        `/fleet/devices/${encodeURIComponent(deviceId)}/history${query({ hours })}`,
      ),

    deviceErrors: async (deviceId) =>
      (await call<{ errors: ErrorRow[] }>(`/fleet/errors${query({ deviceId })}`)).errors,

    errorGroups: (q = {}) =>
      call<GroupPage>(
        `/fleet/errors${query({ status: q.status, q: q.q, limit: q.limit, offset: q.offset })}`,
      ),

    errorGroup: async (fingerprint) =>
      (
        await call<{ group: ErrorGroupRow }>(`/fleet/errors/${encodeURIComponent(fingerprint)}`)
      ).group,

    groupDevices: async (fingerprint) =>
      (
        await call<{ devices: GroupDevice[] }>(
          `/fleet/errors/${encodeURIComponent(fingerprint)}/devices`,
        )
      ).devices,

    setGroupStatus: async (fingerprint, status, resolvedInVersion) => {
      await post(`/fleet/errors/${encodeURIComponent(fingerprint)}/status`, {
        status,
        resolvedInVersion: resolvedInVersion ?? null,
      })
    },

    alerts: async (state = 'open') =>
      (await call<{ alerts: AlertRow[] }>(`/fleet/alerts${query({ state })}`)).alerts,

    acknowledgeAlert: async (id) => {
      await post(`/fleet/alerts/${encodeURIComponent(id)}/ack`)
    },

    evaluateAlerts: async () => {
      await post('/fleet/alerts/evaluate')
    },

    fleetConfig: () => call('/fleet/config'),

    updateFleetConfig: async (patch) =>
      (
        await call<{ config: FleetConfigRow }>('/fleet/config', {
          method: 'PUT',
          body: JSON.stringify(patch),
        })
      ).config,

    updateFleetSettings: async (patch) =>
      (
        await call<{ config: FleetConfigRow }>('/fleet/settings', {
          method: 'PUT',
          body: JSON.stringify(patch),
        })
      ).config,

    /* -- annotations -- */

    heartbeats: async (deviceIds, hours = 24) =>
      deviceIds.length === 0
        ? []
        : (await post<{ strips: HeartbeatStrip[] }>('/fleet/devices/heartbeats', { deviceIds, hours }))
            .strips,

    notes: async (deviceId) =>
      (await call<{ notes: NoteRow[] }>(`/fleet/devices/${encodeURIComponent(deviceId)}/notes`)).notes,

    addNote: async (deviceId, body, pinned) =>
      (
        await post<{ note: NoteRow }>(`/fleet/devices/${encodeURIComponent(deviceId)}/notes`, {
          body,
          pinned,
        })
      ).note,

    pinNote: async (id, pinned) => {
      await post(`/fleet/notes/${encodeURIComponent(id)}/pin`, { pinned })
    },

    deleteNote: async (id) => {
      await call(`/fleet/notes/${encodeURIComponent(id)}`, { method: 'DELETE' })
    },

    tagCatalogue: async () => (await call<{ tags: TagCount[] }>('/fleet/tags')).tags,

    addTag: async (deviceId, tag) =>
      (await post<{ tag: string }>(`/fleet/devices/${encodeURIComponent(deviceId)}/tags`, { tag }))
        .tag,

    removeTag: async (deviceId, tag) => {
      await call(
        `/fleet/devices/${encodeURIComponent(deviceId)}/tags/${encodeURIComponent(tag)}`,
        { method: 'DELETE' },
      )
    },

    mutes: async (all = false) =>
      (await call<{ mutes: MuteRow[] }>(`/fleet/mutes${all ? '?all=1' : ''}`)).mutes,

    openMute: async (input) => (await post<{ mute: MuteRow }>('/fleet/mutes', input)).mute,

    cancelMute: async (id) => {
      await post(`/fleet/mutes/${encodeURIComponent(id)}/cancel`)
    },

    /* -- rollouts -- */

    rollouts: () => call('/fleet/rollouts'),

    rollout: async (id) =>
      (await call<{ rollout: RolloutDetail }>(`/fleet/rollouts/${encodeURIComponent(id)}`)).rollout,

    createRollout: async (input) =>
      (await post<{ rollout: RolloutDetail }>('/fleet/rollouts', input)).rollout,

    promoteRollout: async (id) =>
      (await post<{ rollout: RolloutDetail }>(`/fleet/rollouts/${encodeURIComponent(id)}/promote`))
        .rollout,

    haltRollout: async (id) =>
      (await post<{ rollout: RolloutDetail }>(`/fleet/rollouts/${encodeURIComponent(id)}/halt`))
        .rollout,

    rollbackRollout: (id) => post(`/fleet/rollouts/${encodeURIComponent(id)}/rollback`),

    /* -- routing -- */

    channels: async () => (await call<{ channels: ChannelRow[] }>('/fleet/channels')).channels,

    createChannel: async (input) =>
      (await post<{ channel: ChannelRow }>('/fleet/channels', input)).channel,

    updateChannel: async (id, patch) =>
      (
        await call<{ channel: ChannelRow }>(`/fleet/channels/${encodeURIComponent(id)}`, {
          method: 'PUT',
          body: JSON.stringify(patch),
        })
      ).channel,

    deleteChannel: async (id) => {
      await call(`/fleet/channels/${encodeURIComponent(id)}`, { method: 'DELETE' })
    },

    testChannel: (id) => post(`/fleet/channels/${encodeURIComponent(id)}/test`),

    alertDeliveries: async (alertId) =>
      (
        await call<{ deliveries: DeliveryRow[] }>(
          `/fleet/alerts/${encodeURIComponent(alertId)}/deliveries`,
        )
      ).deliveries,

    /* -- history and promises -- */

    timeline: async (deviceId, days = 14) =>
      (
        await call<{ events: TimelineEvent[] }>(
          `/fleet/devices/${encodeURIComponent(deviceId)}/timeline${query({ days })}`,
        )
      ).events,

    rules: async () => (await call<{ rules: RuleRow[] }>('/fleet/rules')).rules,

    updateRule: async (ruleKey, patch) => {
      await call(`/fleet/rules/${encodeURIComponent(ruleKey)}`, {
        method: 'PUT',
        body: JSON.stringify(patch),
      })
    },

    resetRule: async (ruleKey) => {
      await call(`/fleet/rules/${encodeURIComponent(ruleKey)}`, { method: 'DELETE' })
    },

    versionScores: async () => (await call<{ versions: VersionScore[] }>('/fleet/versions')).versions,

    worstOffenders: async (days = 30, limit = 10) =>
      (await call<{ devices: WorstOffender[] }>(`/fleet/worst${query({ days, limit })}`)).devices,

    quality: async () => (await call<{ shops: ShopQuality[] }>('/fleet/quality')).shops,

    syncPressure: async () =>
      (await call<{ devices: SyncPressureRow[] }>('/fleet/sync-pressure')).devices,

    digest: async () => (await call<{ digest: Digest }>('/fleet/digest')).digest,

    sendDigest: async () => (await post<{ digest: Digest }>('/fleet/digest/send')).digest,

    trends: (days = 30) => call<FleetTrends>(`/fleet/trends${query({ days })}`),

    slo: (days = 30) =>
      call<{ targetBps: number; days: number; shops: ShopSlo[] }>(`/fleet/slo${query({ days })}`),

    backups: async () => (await call<{ terminals: BackupTerminal[] }>('/fleet/backups')).terminals,

    audit: async (limit = 100) =>
      (await call<{ entries: AuditRow[] }>(`/fleet/audit${query({ limit })}`)).entries,

    operators: async () =>
      (await call<{ operators: OperatorAccount[] }>('/fleet/operators')).operators,

    createOperator: async (input) =>
      (await post<{ operator: Operator }>('/fleet/operators', input)).operator,

    setOperatorActive: async (id, active) => {
      await post(`/fleet/operators/${encodeURIComponent(id)}/active`, { active })
    },

    setOperatorPassword: async (id, password) => {
      await post(`/fleet/operators/${encodeURIComponent(id)}/password`, { password })
    },

    commandCatalogue: async () =>
      (await call<{ commands: CommandSpec[] }>('/fleet/commands')).commands,

    deviceCommands: async (deviceId) =>
      (
        await call<{ commands: CommandRow[] }>(
          `/fleet/devices/${encodeURIComponent(deviceId)}/commands`,
        )
      ).commands,

    issueCommand: async (deviceId, command, payload) =>
      (
        await post<{ command: CommandRow }>(
          `/fleet/devices/${encodeURIComponent(deviceId)}/commands`,
          { command, payload },
        )
      ).command,

    cancelCommand: async (id) => {
      await post(`/fleet/commands/${encodeURIComponent(id)}/cancel`)
    },

    commandHistory: (q = {}) =>
      call<CommandHistoryPage>(
        `/fleet/commands/history${query({
          command: q.command,
          state: q.state,
          shopId: q.shopId,
          limit: q.limit,
          offset: q.offset,
        })}`,
      ),

    shops: async () => (await call<{ shops: ShopRow[] }>('/api/stores')).shops,

    shop: async (shopId) => {
      const { shops } = await call<{ shops: ShopRow[] }>('/api/stores')
      return shops.find((s) => s.id === shopId) ?? null
    },

    provisionShop: (input) => post<ProvisionResult>('/api/stores/provision', input),

    reissueClaimCode: (shopId) =>
      post<{ claimCode: string; expiresAt: string }>(
        `/api/stores/${encodeURIComponent(shopId)}/claim-code`,
      ),

    issueReconnectCode: (shopId) =>
      post<{ reconnectCode: string; expiresAt: string }>(
        `/api/stores/${encodeURIComponent(shopId)}/reconnect-code`,
      ),

    revokeStoreKey: async (keyId) => {
      await post(`/api/stores/keys/${encodeURIComponent(keyId)}/revoke`)
    },

    shopInventory: (shopId) => call<ShopInventory>(shopPath(shopId, '/inventory')),

    shopExport: async (shopId, q) => {
      const res = await request(
        shopPath(
          shopId,
          `/export${query({ type: q.type, format: q.format, from: q.from, to: q.to })}`,
        ),
      )
      return {
        filename: filenameOf(res, `${q.type}.${q.format ?? 'csv'}`),
        blob: await res.blob(),
      }
    },

    importShopProducts: (shopId, csv) =>
      postCsv<ImportResult>(shopPath(shopId, '/import/products'), csv),

    importShopBatches: (shopId, csv) =>
      postCsv<ImportResult>(shopPath(shopId, '/import/batches'), csv),

    createShopProduct: (shopId, input) =>
      post<ShopProduct>(shopPath(shopId, '/products'), input),

    receiveShopStock: async (shopId, input) => {
      await post(shopPath(shopId, '/batches'), input)
    },
  }
}

/**
 * The name the server chose for a download, from `Content-Disposition`.
 *
 * Falls back to the caller's guess rather than failing: the header is only
 * readable cross-origin because the API explicitly exposes it, and a dashboard
 * pointed at an older droplet should still save the file — under a duller name
 * — instead of throwing on the way to the disk.
 */
function filenameOf(res: Response, fallback: string): string {
  const header = res.headers.get('Content-Disposition') ?? ''
  const match = /filename="([^"]+)"/.exec(header)
  return match?.[1] ?? fallback
}
