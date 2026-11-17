import type { Client } from './client.ts'
import type {
  Alert,
  AlertState,
  ClosureView,
  ShopClosure,
  AssistantBrief,
  AssistantSwitches,
  AuditEntry,
  BackupTerminal,
  Channel,
  ChannelInput,
  Command,
  CommandHistoryPage,
  CommandHistoryRow,
  CommandSpec,
  Delivery,
  Device,
  DeviceError,
  DeviceHistory,
  DevicePage,
  DeviceQuery,
  Digest,
  ErrorGroup,
  ExportFormat,
  ExportType,
  FleetAssistantUsage,
  FleetConfig,
  FleetSettings,
  GroupDevice,
  GroupPage,
  GroupStatus,
  HeartbeatStrip,
  IssueOptions,
  ConfigPatch,
  DeviceSettingsView,
  FleetTillSettings,
  NoticeInput,
  Schedule,
  ScheduleInput,
  ScheduleResult,
  TillSettingsLevel,
  Recipe,
  Holiday,
  HolidayFeed,
  ImportResult,
  LimitRule,
  ModelId,
  Mute,
  MuteInput,
  NewProductInput,
  Note,
  Operator,
  OperatorAccount,
  OperatorInput,
  Overview,
  ProvisionInput,
  ProvisionResult,
  ReceiveStockInput,
  ReportPeriod,
  Rollout,
  RolloutDetail,
  RolloutInput,
  Rule,
  Shop,
  ShopAssistant,
  ShopEdition,
  ShopInventory,
  ShopProduct,
  ShopQuality,
  ShopSlo,
  SyncPressure,
  TagCount,
  Thresholds,
  TimelineEvent,
  Trends,
  VersionScore,
  WorstOffender,
} from './types.ts'

/** Query string from params, dropping blanks and the "all" sentinel. */
export function qs(params: Record<string, string | number | undefined>): string {
  const out = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '' && v !== 'all') out.set(k, String(v))
  }
  const s = out.toString()
  return s ? `?${s}` : ''
}

const enc = encodeURIComponent

export const overview = (c: Client, signal?: AbortSignal) => c.get<Overview>('/fleet/overview', signal)

export const devices = (c: Client, q: DeviceQuery = {}, signal?: AbortSignal) =>
  c.get<DevicePage>(
    `/fleet/devices${qs({
      q: q.q,
      state: q.state,
      shopId: q.shopId,
      platform: q.platform,
      version: q.version,
      tag: q.tag,
      muted: q.muted,
      includeRemoved: q.includeRemoved ? '1' : undefined,
      sort: q.sort,
      dir: q.dir,
      limit: q.limit,
      offset: q.offset,
    })}`,
    signal,
  )

export const device = async (c: Client, id: string, signal?: AbortSignal) =>
  (await c.get<{ device: Device }>(`/fleet/devices/${enc(id)}`, signal)).device

export const heartbeats = async (c: Client, deviceIds: string[], hours = 24) =>
  deviceIds.length === 0
    ? []
    : (await c.post<{ strips: HeartbeatStrip[] }>('/fleet/devices/heartbeats', { deviceIds, hours, buckets: 48 }))
        .strips

export const deviceErrors = async (c: Client, deviceId: string, signal?: AbortSignal) =>
  (await c.get<{ errors: DeviceError[] }>(`/fleet/errors${qs({ deviceId })}`, signal)).errors

export const alerts = async (c: Client, state: AlertState | 'all' = 'open', signal?: AbortSignal) =>
  // The server treats a missing state as "open", so "all" has to be sent.
  (await c.get<{ alerts: Alert[] }>(`/fleet/alerts?state=${enc(state)}`, signal)).alerts

export const acknowledgeAlert = (c: Client, id: string) => c.post(`/fleet/alerts/${enc(id)}/ack`)

export const evaluateAlerts = (c: Client) => c.post('/fleet/alerts/evaluate')

export const shops = async (c: Client, signal?: AbortSignal) =>
  (await c.get<{ shops: Shop[] }>('/api/stores', signal)).shops

export const commandCatalogue = async (c: Client, signal?: AbortSignal) =>
  (await c.get<{ commands: CommandSpec[] }>('/fleet/commands', signal)).commands

export const deviceCommands = async (c: Client, deviceId: string, signal?: AbortSignal) =>
  (await c.get<{ commands: Command[] }>(`/fleet/devices/${enc(deviceId)}/commands`, signal)).commands

export const issueCommand = async (c: Client, deviceId: string, command: string, opts: IssueOptions = {}) =>
  (
    await c.post<{ command: Command }>(`/fleet/devices/${enc(deviceId)}/commands`, {
      command,
      ...(opts.payload ? { payload: opts.payload } : {}),
      ...(opts.notBefore ? { notBefore: opts.notBefore } : {}),
      ...(opts.whenQuiet ? { whenQuiet: true } : {}),
      ...(opts.afterClosing ? { afterClosing: true } : {}),
      ...(opts.notify !== undefined ? { notify: opts.notify } : {}),
      ...(opts.password ? { password: opts.password } : {}),
    })
  ).command

export const cancelCommand = (c: Client, id: string) => c.post(`/fleet/commands/${enc(id)}/cancel`)

/** A second operator's yes, with their own password. */
export const approveCommand = async (c: Client, id: string, password: string) =>
  (await c.post<{ command: Command }>(`/fleet/commands/${enc(id)}/approve`, { password })).command

export const recipes = async (c: Client, signal?: AbortSignal) =>
  (await c.get<{ recipes: Recipe[] }>('/fleet/recipes', signal)).recipes

/** Queue a fix recipe's steps as one run. */
export const issueRecipe = async (
  c: Client,
  deviceId: string,
  recipe: string,
  opts: Pick<IssueOptions, 'notBefore' | 'whenQuiet' | 'afterClosing' | 'notify'> = {},
) =>
  (
    await c.post<{ commands: Command[] }>(`/fleet/devices/${enc(deviceId)}/recipes`, {
      recipe,
      ...(opts.notBefore ? { notBefore: opts.notBefore } : {}),
      ...(opts.whenQuiet ? { whenQuiet: true } : {}),
      ...(opts.afterClosing ? { afterClosing: true } : {}),
      ...(opts.notify !== undefined ? { notify: opts.notify } : {}),
    })
  ).commands

/** Everything fleet-wide that is waiting for a second operator. */
export const awaitingApproval = async (c: Client, signal?: AbortSignal) =>
  (await c.get<{ commands: CommandHistoryRow[] }>('/fleet/commands/awaiting', signal)).commands

/** What the console keeps for this till, at every level, and whether it has them. */
export const deviceSettings = (c: Client, deviceId: string, signal?: AbortSignal) =>
  c.get<DeviceSettingsView>(`/fleet/devices/${enc(deviceId)}/settings`, signal)

/**
 * Pause a till's sync, or keep it out of updates — both enforced by the cloud.
 * Pausing sync needs your password; lifting either does not.
 */
export const setHold = (
  c: Client,
  deviceId: string,
  kind: 'sync' | 'updates',
  on: boolean,
  opts: { reason?: string | null; password?: string } = {},
) => c.post<DeviceSettingsView>(`/fleet/devices/${enc(deviceId)}/holds`, { kind, on, ...opts })

export const fleetTillSettings = (c: Client, signal?: AbortSignal) => c.get<FleetTillSettings>('/fleet/till-settings', signal)
export const updateFleetTillSettings = (c: Client, patch: { notice?: NoticeInput | null; config?: ConfigPatch }) =>
  c.put<{ fleet: TillSettingsLevel }>('/fleet/till-settings', patch)

export const shopTillSettings = (c: Client, shopId: string, signal?: AbortSignal) =>
  c.get<{ fleet: TillSettingsLevel; shop: TillSettingsLevel }>(`/fleet/shops/${enc(shopId)}/till-settings`, signal)
export const updateShopTillSettings = (
  c: Client,
  shopId: string,
  patch: { notice?: NoticeInput | null; config?: ConfigPatch; updateHold?: { reason: string | null } | null },
) => c.put<{ shop: TillSettingsLevel }>(`/fleet/shops/${enc(shopId)}/till-settings`, patch)

export const schedules = (c: Client, signal?: AbortSignal) =>
  c.get<{ schedules: Schedule[]; commands: string[] }>('/fleet/schedules', signal)
export const createSchedule = (c: Client, input: ScheduleInput) => c.post<{ schedule: Schedule }>('/fleet/schedules', input)
export const updateSchedule = (
  c: Client,
  id: string,
  patch: Partial<Pick<Schedule, 'label' | 'enabled' | 'every' | 'weekday' | 'atMinute' | 'whenQuiet'>>,
) => c.put<{ schedule: Schedule }>(`/fleet/schedules/${enc(id)}`, patch)
export const deleteSchedule = (c: Client, id: string) => c.del(`/fleet/schedules/${enc(id)}`)
export const runSchedule = async (c: Client, id: string) =>
  (await c.post<{ result: ScheduleResult }>(`/fleet/schedules/${enc(id)}/run`)).result

/** Keep this till checking in every few seconds for the next few minutes. */
export const goLive = (c: Client, deviceId: string) =>
  c.post<{ liveUntil: string; lastReportAt: string }>(`/fleet/devices/${enc(deviceId)}/live`)

export const notes = async (c: Client, deviceId: string, signal?: AbortSignal) =>
  (await c.get<{ notes: Note[] }>(`/fleet/devices/${enc(deviceId)}/notes`, signal)).notes

export const addNote = async (c: Client, deviceId: string, body: string) =>
  (await c.post<{ note: Note }>(`/fleet/devices/${enc(deviceId)}/notes`, { body, pinned: false })).note

export const pinNote = (c: Client, id: string, pinned: boolean) => c.post(`/fleet/notes/${enc(id)}/pin`, { pinned })
export const deleteNote = (c: Client, id: string) => c.del(`/fleet/notes/${enc(id)}`)

/* ------------------------------------------------------------- a till */

export const deviceHistory = (c: Client, id: string, hours = 24 * 14, signal?: AbortSignal) =>
  c.get<DeviceHistory>(`/fleet/devices/${enc(id)}/history${qs({ hours })}`, signal)

export const timeline = async (c: Client, id: string, days = 14, signal?: AbortSignal) =>
  (await c.get<{ events: TimelineEvent[] }>(`/fleet/devices/${enc(id)}/timeline${qs({ days })}`, signal)).events

export const tagCatalogue = async (c: Client, signal?: AbortSignal) =>
  (await c.get<{ tags: TagCount[] }>('/fleet/tags', signal)).tags
export const addTag = (c: Client, deviceId: string, tag: string) =>
  c.post(`/fleet/devices/${enc(deviceId)}/tags`, { tag })
export const removeTag = (c: Client, deviceId: string, tag: string) =>
  c.del(`/fleet/devices/${enc(deviceId)}/tags/${enc(tag)}`)

export const mutes = async (c: Client, all = false, signal?: AbortSignal) =>
  (await c.get<{ mutes: Mute[] }>(`/fleet/mutes${all ? '?all=1' : ''}`, signal)).mutes
export const openMute = (c: Client, input: MuteInput) => c.post<{ mute: Mute }>('/fleet/mutes', input)
export const cancelMute = (c: Client, id: string) => c.post(`/fleet/mutes/${enc(id)}/cancel`)

/* ------------------------------------------------------- app problems */

export const errorGroups = (
  c: Client,
  q: { status?: GroupStatus | 'all'; q?: string; limit?: number; offset?: number },
  signal?: AbortSignal,
) =>
  // The server defaults a missing status to "open", so "all" is sent as-is.
  c.get<GroupPage>(
    `/fleet/errors?${new URLSearchParams(
      Object.entries({ status: q.status ?? 'open', q: q.q, limit: q.limit, offset: q.offset })
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => [k, String(v)]),
    )}`,
    signal,
  )
export const errorGroup = async (c: Client, fp: string, signal?: AbortSignal) =>
  (await c.get<{ group: ErrorGroup }>(`/fleet/errors/${enc(fp)}`, signal)).group
export const groupDevices = async (c: Client, fp: string, signal?: AbortSignal) =>
  (await c.get<{ devices: GroupDevice[] }>(`/fleet/errors/${enc(fp)}/devices`, signal)).devices
export const setGroupStatus = (c: Client, fp: string, status: GroupStatus, resolvedInVersion: string | null = null) =>
  c.post(`/fleet/errors/${enc(fp)}/status`, { status, resolvedInVersion })

/* ------------------------------------------------------------ updates */

export const rollouts = (c: Client, signal?: AbortSignal) =>
  c.get<{ rollouts: Rollout[]; active: Rollout | null }>('/fleet/rollouts', signal)
export const rollout = async (c: Client, id: string, signal?: AbortSignal) =>
  (await c.get<{ rollout: RolloutDetail }>(`/fleet/rollouts/${enc(id)}`, signal)).rollout
export const createRollout = async (c: Client, input: RolloutInput) =>
  (await c.post<{ rollout: RolloutDetail }>('/fleet/rollouts', input)).rollout
export const promoteRollout = (c: Client, id: string) => c.post(`/fleet/rollouts/${enc(id)}/promote`)
export const haltRollout = (c: Client, id: string) => c.post(`/fleet/rollouts/${enc(id)}/halt`)
export const rollbackRollout = (c: Client, id: string) =>
  c.post<{ reverted: number }>(`/fleet/rollouts/${enc(id)}/rollback`)

/** Every till matching a filter, not just one page — for targeting an update. */
export async function allDevices(c: Client, q: DeviceQuery): Promise<Device[]> {
  const out: Device[] = []
  for (let offset = 0; ; offset += 200) {
    const page = await devices(c, { ...q, limit: 200, offset })
    out.push(...page.devices)
    if (out.length >= page.total || page.devices.length === 0) return out
  }
}

/* -------------------------------------------------------- remote fixes */

export const commandHistory = (
  c: Client,
  q: { command?: string; state?: string; shopId?: string; limit?: number; offset?: number },
  signal?: AbortSignal,
) => c.get<CommandHistoryPage>(`/fleet/commands/history${qs(q)}`, signal)

/* ------------------------------------------------------------- history */

export const trends = (c: Client, days: number, signal?: AbortSignal) => c.get<Trends>(`/fleet/trends${qs({ days })}`, signal)
export const slo = (c: Client, days: number, signal?: AbortSignal) =>
  c.get<{ targetBps: number; days: number; shops: ShopSlo[] }>(`/fleet/slo${qs({ days })}`, signal)
export const versionScores = async (c: Client, signal?: AbortSignal) =>
  (await c.get<{ versions: VersionScore[] }>('/fleet/versions', signal)).versions
export const worst = async (c: Client, days: number, signal?: AbortSignal) =>
  (await c.get<{ devices: WorstOffender[] }>(`/fleet/worst${qs({ days, limit: 10 })}`, signal)).devices
export const syncPressure = async (c: Client, signal?: AbortSignal) =>
  (await c.get<{ devices: SyncPressure[] }>('/fleet/sync-pressure', signal)).devices
export const digest = async (c: Client, signal?: AbortSignal) =>
  (await c.get<{ digest: Digest }>('/fleet/digest', signal)).digest
export const sendDigest = (c: Client) => c.post<{ digest: Digest }>('/fleet/digest/send')
export const quality = async (c: Client, signal?: AbortSignal) =>
  (await c.get<{ shops: ShopQuality[] }>('/fleet/quality', signal)).shops
export const backups = async (c: Client, signal?: AbortSignal) =>
  (await c.get<{ terminals: BackupTerminal[] }>('/fleet/backups', signal)).terminals

/* ------------------------------------------------------------ settings */

export const audit = async (c: Client, limit = 200, signal?: AbortSignal) =>
  (await c.get<{ entries: AuditEntry[] }>(`/fleet/audit${qs({ limit })}`, signal)).entries
export const operators = async (c: Client, signal?: AbortSignal) =>
  (await c.get<{ operators: OperatorAccount[] }>('/fleet/operators', signal)).operators
export const createOperator = (c: Client, input: OperatorInput) => c.post<{ operator: Operator }>('/fleet/operators', input)
export const setOperatorActive = (c: Client, id: string, active: boolean) =>
  c.post(`/fleet/operators/${enc(id)}/active`, { active })
export const setOperatorPassword = (c: Client, id: string, password: string) =>
  c.post(`/fleet/operators/${enc(id)}/password`, { password })

export const rules = async (c: Client, signal?: AbortSignal) => (await c.get<{ rules: Rule[] }>('/fleet/rules', signal)).rules
export const updateRule = (
  c: Client,
  key: string,
  patch: { enabled?: boolean; severity?: 'warning' | 'critical' | null; runbookUrl?: string | null; autoFix?: string | null },
) => c.put(`/fleet/rules/${enc(key)}`, patch)
export const resetRule = (c: Client, key: string) => c.del(`/fleet/rules/${enc(key)}`)

export const fleetConfig = (c: Client, signal?: AbortSignal) =>
  c.get<{ config: FleetConfig; defaults: Thresholds }>('/fleet/config', signal)
export const updateThresholds = (c: Client, patch: Partial<Thresholds>) => c.put('/fleet/config', patch)
export const updateSettings = (
  c: Client,
  patch: Partial<
    Pick<FleetSettings, 'quietStartMinute' | 'quietEndMinute' | 'quietTimezone' | 'quietBreakthrough' | 'sloTargetBps' | 'requireCommandApproval'>
  >,
) => c.put('/fleet/settings', patch)

export const channels = async (c: Client, signal?: AbortSignal) =>
  (await c.get<{ channels: Channel[] }>('/fleet/channels', signal)).channels
export const createChannel = (c: Client, input: ChannelInput) => c.post('/fleet/channels', input)
export const updateChannel = (c: Client, id: string, patch: Partial<ChannelInput>) => c.put(`/fleet/channels/${enc(id)}`, patch)
export const deleteChannel = (c: Client, id: string) => c.del(`/fleet/channels/${enc(id)}`)
export const testChannel = (c: Client, id: string) => c.post<{ ok: boolean; error: string | null }>(`/fleet/channels/${enc(id)}/test`)
export const alertDeliveries = async (c: Client, id: string, signal?: AbortSignal) =>
  (await c.get<{ deliveries: Delivery[] }>(`/fleet/alerts/${enc(id)}/deliveries`, signal)).deliveries

export const holidays = (c: Client, signal?: AbortSignal) =>
  c.get<{ holidays: Holiday[]; refresh: HolidayFeed }>('/fleet/holidays', signal)
export const refreshHolidays = (c: Client) => c.post('/fleet/holidays/refresh')
export const setHoliday = (c: Client, season: string, day: string) => c.put(`/fleet/holidays/${enc(season)}`, { day })
export const clearHoliday = (c: Client, season: string, year: number) => c.del(`/fleet/holidays/${enc(season)}/${year}`)

/* ----------------------------------------------------------- assistant */

export const assistant = (c: Client, signal?: AbortSignal) => c.get<AssistantSwitches>('/fleet/assistant', signal)
export const setSystemAssistant = (c: Client, enabled: boolean) => c.put('/fleet/assistant', { enabled })
export const setAssistantKey = (c: Client, apiKey: string) => c.put('/fleet/assistant/key', { apiKey })
export const removeAssistantKey = (c: Client) => c.del('/fleet/assistant/key')
export const setAssistantModel = (c: Client, model: ModelId) => c.put('/fleet/assistant/defaults', { model })
export const setFleetLimits = (c: Client, rules: LimitRule[]) => c.put('/fleet/assistant/limits', { rules })
export const assistantUsage = (c: Client, period: ReportPeriod, signal?: AbortSignal) =>
  c.get<FleetAssistantUsage>(`/fleet/assistant/usage?period=${enc(period)}`, signal)
export const healthBrief = (c: Client, fresh = false) =>
  c.post<AssistantBrief>(`/fleet/assistant/health-brief${fresh ? '?fresh=1' : ''}`)

/* ---------------------------------------------------------------- shops */

const shopPath = (id: string, suffix = '') => `/api/stores/${enc(id)}${suffix}`

/* closing a shop we no longer work with, and deleting its data */
export const shopClosure = (c: Client, shopId: string, signal?: AbortSignal) =>
  c.get<ClosureView>(shopPath(shopId, '/closure'), signal)
export const shopClosures = (c: Client, signal?: AbortSignal) =>
  c.get<{ closures: ShopClosure[]; purgeAfterDays: number }>('/api/stores/closures', signal)
export const closeShop = (c: Client, shopId: string, input: { reason?: string; password: string }) =>
  c.post<ClosureView>(shopPath(shopId, '/close'), input)
export const reopenShop = (c: Client, shopId: string, password: string) =>
  c.post<ClosureView>(shopPath(shopId, '/reopen'), { password })
export const approveShopPurge = (c: Client, shopId: string, password: string) =>
  c.post<ClosureView>(shopPath(shopId, '/purge-approval'), { password })
export const withdrawShopPurge = (c: Client, shopId: string) => c.del<ClosureView>(shopPath(shopId, '/purge-approval'))
/** Everything the shop owns, zipped, for the owner. Takes the operator's password. */
export const shopAllData = (c: Client, shopId: string, password: string) =>
  c.download(shopPath(shopId, '/all-data'), 'shop-data.zip', { password })

export const provisionShop = (c: Client, input: ProvisionInput) => c.post<ProvisionResult>('/api/stores/provision', input)
export const reissueClaimCode = (c: Client, shopId: string) =>
  c.post<{ claimCode: string; expiresAt: string }>(shopPath(shopId, '/claim-code'))
export const reconnectCode = (c: Client, shopId: string) =>
  c.post<{ reconnectCode: string; expiresAt: string }>(shopPath(shopId, '/reconnect-code'))

export const revokeKey = (c: Client, keyId: string) => c.post(`/api/stores/keys/${enc(keyId)}/revoke`)
export const renameMachine = async (c: Client, keyId: string, machineName: string) =>
  (await c.post<{ machineName: string | null }>(`/api/stores/keys/${enc(keyId)}/rename`, { machineName })).machineName
export const removeMachine = (c: Client, keyId: string) => c.post(`/api/stores/keys/${enc(keyId)}/remove`)
export const restoreMachine = (c: Client, keyId: string) => c.post(`/api/stores/keys/${enc(keyId)}/restore`)

export const shopEdition = (c: Client, shopId: string, signal?: AbortSignal) => c.get<ShopEdition>(shopPath(shopId, '/edition'), signal)
export const setShopEdition = (
  c: Client,
  shopId: string,
  change: { businessType?: string; features?: Record<string, boolean>; reason?: string },
) => c.put<ShopEdition>(shopPath(shopId, '/edition'), change)

export const shopAssistant = (c: Client, shopId: string, period: ReportPeriod = 'month', signal?: AbortSignal) =>
  c.get<ShopAssistant>(shopPath(shopId, `/assistant?period=${enc(period)}`), signal)
export const setShopAssistant = (c: Client, shopId: string, enabled: boolean, reason?: string) =>
  c.put(shopPath(shopId, '/assistant'), { enabled, ...(reason?.trim() ? { reason: reason.trim() } : {}) })
export const setShopAssistantSettings = (
  c: Client,
  shopId: string,
  patch: { model?: ModelId | null; briefing?: boolean; invoiceReading?: boolean },
) => c.put(shopPath(shopId, '/assistant/settings'), patch)
export const setShopLimits = (c: Client, shopId: string, rules: LimitRule[]) =>
  c.put(shopPath(shopId, '/assistant/limits'), { rules })
export const supportBrief = (c: Client, shopId: string, fresh = false) =>
  c.post<AssistantBrief>(shopPath(shopId, `/assistant/support-brief${fresh ? '?fresh=1' : ''}`))

export const shopInventory = (c: Client, shopId: string, signal?: AbortSignal) =>
  c.get<ShopInventory>(shopPath(shopId, '/inventory'), signal)
export const shopExport = (c: Client, shopId: string, q: { type: ExportType; format: ExportFormat; from?: string; to?: string }) =>
  c.download(shopPath(shopId, `/export${qs(q)}`), `${q.type}.${q.format}`)
export const importProducts = (c: Client, shopId: string, csv: string) =>
  c.postText<ImportResult>(shopPath(shopId, '/import/products'), csv, 'text/csv')
export const importBatches = (c: Client, shopId: string, csv: string) =>
  c.postText<ImportResult>(shopPath(shopId, '/import/batches'), csv, 'text/csv')
export const createProduct = (c: Client, shopId: string, input: NewProductInput) =>
  c.post<ShopProduct>(shopPath(shopId, '/products'), input)
export const receiveStock = (c: Client, shopId: string, input: ReceiveStockInput) => c.post(shopPath(shopId, '/batches'), input)

/** Every problem matching a search, all pages — for bulk triage and export. */
export async function allErrorGroups(c: Client, q: { status?: GroupStatus | 'all'; q?: string }): Promise<ErrorGroup[]> {
  const out: ErrorGroup[] = []
  for (let offset = 0; ; offset += 200) {
    const page = await errorGroups(c, { ...q, limit: 200, offset })
    out.push(...page.groups)
    if (out.length >= page.total || page.groups.length === 0) return out
  }
}

/** Every fix matching a filter, all pages — for export. */
export async function allCommandHistory(
  c: Client,
  q: { command?: string; state?: string; shopId?: string },
): Promise<CommandHistoryPage['commands']> {
  const out: CommandHistoryPage['commands'] = []
  for (let offset = 0; ; offset += 200) {
    const page = await commandHistory(c, { ...q, limit: 200, offset })
    out.push(...page.commands)
    if (out.length >= page.total || page.commands.length === 0) return out
  }
}
