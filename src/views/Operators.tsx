import { useCallback, useEffect, useState } from 'react'
import { Forbidden, Unauthorized, type Api, type CreateOperatorInput, type OperatorAccount } from '../api.ts'
import { Button, Chip, Empty, Notice, Status, TableSkeleton } from '../components/ui.tsx'
import { exact, timeAgo } from '../lib/format.ts'

const ROLES: CreateOperatorInput['role'][] = ['viewer', 'operator', 'admin']

/**
 * Who may use this console, and what they may do in it.
 *
 * Admin-only: the routes behind this view (`/fleet/operators/*`) are gated to
 * the `admin` role on the server, so a non-admin who lands here anyway (a
 * stale link, a hand-edited hash) gets the server's own 403 rather than a
 * page that lets them try.
 */
export function Operators({ api, onUnauthorized }: { api: Api; onUnauthorized: () => void }) {
  const [rows, setRows] = useState<OperatorAccount[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    try {
      setRows(await api.operators())
      setError(null)
    } catch (err) {
      if (err instanceof Unauthorized) return onUnauthorized()
      if (err instanceof Forbidden) return setForbidden(true)
      setError(err instanceof Error ? err.message : 'Could not load operators')
    }
  }, [api, onUnauthorized])

  useEffect(() => {
    void load()
  }, [load])

  async function run(id: string, fn: () => Promise<unknown>) {
    setBusyId(id)
    setError(null)
    try {
      await fn()
      await load()
    } catch (err) {
      if (err instanceof Unauthorized) return onUnauthorized()
      setError(err instanceof Error ? err.message : 'That action failed')
    } finally {
      setBusyId(null)
    }
  }

  if (forbidden) {
    return (
      <>
        <div className="view-head">
          <div>
            <h1 className="view-title">Operators</h1>
          </div>
        </div>
        <Notice>Your role can't manage operator accounts — ask an admin.</Notice>
      </>
    )
  }

  return (
    <>
      <div className="view-head">
        <div>
          <h1 className="view-title">Operators</h1>
          <p className="view-sub">
            Named accounts with access to this console. Disabling one signs it out of every
            session immediately; resetting a password does the same.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreating((v) => !v)}>
          {creating ? 'Cancel' : 'Add operator'}
        </Button>
      </div>

      {error && <Notice>{error}</Notice>}

      {creating && (
        <CreateForm
          api={api}
          onCreated={() => {
            setCreating(false)
            void load()
          }}
          onUnauthorized={onUnauthorized}
        />
      )}

      <section className="panel">
        {rows == null ? (
          <TableSkeleton rows={4} />
        ) : rows.length === 0 ? (
          <Empty icon="users" title="No operators yet">
            Add the first account to sign in to this console.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">
                    <span className="th-label">Operator</span>
                  </th>
                  <th scope="col">
                    <span className="th-label">Role</span>
                  </th>
                  <th scope="col">
                    <span className="th-label">Status</span>
                  </th>
                  <th scope="col">
                    <span className="th-label">Last sign-in</span>
                  </th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((op) => (
                  <OperatorRow
                    key={op.id}
                    op={op}
                    self={op.id === api.operator.id}
                    busy={busyId === op.id}
                    onDisable={() => void run(op.id, () => api.setOperatorActive(op.id, false))}
                    onEnable={() => void run(op.id, () => api.setOperatorActive(op.id, true))}
                    onResetPassword={(password) =>
                      run(op.id, () => api.setOperatorPassword(op.id, password))
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}

/* -------------------------------------------------------------------- row */

function OperatorRow({
  op,
  self,
  busy,
  onDisable,
  onEnable,
  onResetPassword,
}: {
  op: OperatorAccount
  self: boolean
  busy: boolean
  onDisable: () => void
  onEnable: () => void
  onResetPassword: (password: string) => void
}) {
  const [resetting, setResetting] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmingDisable, setConfirmingDisable] = useState(false)

  return (
    <tr>
      <td>
        <span className="strong">{op.name}</span>
        <div className="row-sub">
          {op.email}
          {self && <span className="tag-warn">you</span>}
        </div>
      </td>
      <td className="mono small">{op.role}</td>
      <td>
        <Status tone={op.active ? 'ok' : 'idle'} label={op.active ? 'Active' : 'Disabled'} />
      </td>
      <td className="muted" title={exact(op.lastLoginAt)}>
        {op.lastLoginAt ? timeAgo(op.lastLoginAt) : 'Never'}
      </td>
      <td>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {resetting ? (
            <div className="action-confirm">
              <input
                className="input"
                type="password"
                style={{ width: 140 }}
                value={password}
                placeholder="New password (12+ chars)"
                aria-label={`New password for ${op.email}`}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Button
                size="sm"
                busy={busy}
                disabled={password.length < 12}
                onClick={() => {
                  onResetPassword(password)
                  setPassword('')
                  setResetting(false)
                }}
              >
                Set
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setResetting(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setResetting(true)}>
              Reset password
            </Button>
          )}

          {op.active &&
            (confirmingDisable ? (
              <>
                <Button size="sm" variant="danger" busy={busy} onClick={onDisable}>
                  Confirm
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmingDisable(false)}>
                  Keep
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="danger"
                disabled={self}
                title={self ? 'You cannot disable your own account' : undefined}
                onClick={() => setConfirmingDisable(true)}
              >
                Disable
              </Button>
            ))}
          {!op.active && (
            <Button size="sm" busy={busy} onClick={onEnable}>
              Enable
            </Button>
          )}
        </div>
      </td>
    </tr>
  )
}

/* --------------------------------------------------------------- creation */

function CreateForm({
  api,
  onCreated,
  onUnauthorized,
}: {
  api: Api
  onCreated: () => void
  onUnauthorized: () => void
}) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<CreateOperatorInput['role']>('operator')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const valid = email.trim() !== '' && name.trim() !== '' && password.length >= 12

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await api.createOperator({ email: email.trim(), name: name.trim(), password, role })
      onCreated()
    } catch (err) {
      if (err instanceof Unauthorized) return onUnauthorized()
      setError(err instanceof Error ? err.message : 'Could not create that operator')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel" style={{ padding: 16, marginBottom: 16 }}>
      {error && <Notice>{error}</Notice>}
      <div className="toolbar" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input
          className="input"
          value={name}
          placeholder="Name"
          aria-label="Name"
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="input"
          type="email"
          value={email}
          placeholder="Email"
          aria-label="Email"
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="input"
          type="password"
          value={password}
          placeholder="Password (12+ chars)"
          aria-label="Password"
          onChange={(e) => setPassword(e.target.value)}
        />
        <div className="filters" role="group" aria-label="Role">
          {ROLES.map((r) => (
            <button
              key={r}
              type="button"
              className="key"
              aria-pressed={role === r}
              onClick={() => setRole(r)}
            >
              {r}
            </button>
          ))}
        </div>
        <Button busy={busy} disabled={!valid} onClick={() => void submit()}>
          Create
        </Button>
      </div>
      <p className="hint" style={{ marginTop: 8 }}>
        <Chip tone="idle">viewer</Chip> reads only ·{' '}
        <Chip tone="idle">operator</Chip> can act on terminals ·{' '}
        <Chip tone="idle">admin</Chip> can also manage other operators
      </p>
    </div>
  )
}
