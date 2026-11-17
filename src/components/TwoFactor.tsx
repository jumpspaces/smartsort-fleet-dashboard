import QRCode from 'qrcode'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import * as api from '../api/endpoints.ts'
import { useApi } from '../data.ts'
import { saveFile } from '../lib/csv.ts'
import { date, plural } from '../lib/format.ts'
import { invalidate, useAction } from '../lib/query.ts'
import { useSession } from '../lib/session.tsx'
import { Dialog, Field } from './forms.tsx'
import { StepUpDialog } from './StepUpDialog.tsx'
import { Card, ErrorNote, Loadable } from './ui.tsx'

/**
 * Sign-in codes from an authenticator app: setting them up, the recovery codes
 * that stand in for a lost phone, and — when the fleet requires them — the
 * screen a session without one sees instead of the console.
 */

/** The otpauth link as a QR code, drawn by the browser from an SVG — nothing leaves the page. */
function QrCode({ text }: { text: string }) {
  const [svg, setSvg] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then((s) => live && setSvg(s))
    return () => {
      live = false
    }
  }, [text])
  return svg ? (
    <img
      src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`}
      alt="QR code to scan with your authenticator app"
      width={184}
      height={184}
      style={{ background: '#fff', padding: 8, borderRadius: 8 }}
    />
  ) : (
    <div style={{ width: 184, height: 184 }} />
  )
}

/** Four-letter groups, so the key can be typed by hand. */
const grouped = (secret: string) => secret.match(/.{1,4}/g)?.join(' ') ?? secret

export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone?: () => void }) {
  const [saved, setSaved] = useState(false)
  const text = ['SmartSort Fleet — recovery codes', 'Each works once, in place of a code from your app.', '', ...codes, ''].join('\n')
  return (
    <div className="stack" style={{ gap: 10 }}>
      <p className="small" style={{ margin: 0 }}>
        If you lose your phone, each of these signs you in once instead of a code. Keep them somewhere safe and apart from your
        password — they won't be shown again.
      </p>
      <ol className="mono" style={{ columns: 2, margin: 0, paddingLeft: 22 }} aria-label="Recovery codes">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ol>
      <div className="row">
        <button className="btn sm" type="button" onClick={() => saveFile('smartsort-fleet-recovery-codes.txt', new Blob([text], { type: 'text/plain' }))}>
          Download
        </button>
        <button className="btn sm" type="button" onClick={() => void navigator.clipboard?.writeText(codes.join('\n'))}>
          Copy
        </button>
      </div>
      {onDone && (
        <>
          <label className="row small" style={{ gap: 8 }}>
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I've saved them
          </label>
          <div className="form-actions">
            <button className="btn primary" type="button" disabled={!saved} onClick={onDone}>
              Done
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Password → scan → first code → recovery codes. The session is swapped for the
 * one the server issues on success, since turning codes on ends every session
 * that began without one — this one included.
 */
export function SetupTwoFactor({ onDone }: { onDone: () => void }) {
  const { client } = useSession()
  const [password, setPassword] = useState('')
  const [secret, setSecret] = useState<{ secret: string; otpauthUrl: string } | null>(null)
  const [code, setCode] = useState('')
  const [codes, setCodes] = useState<string[] | null>(null)
  const start = useAction(async () => {
    setSecret(await api.startTwoFactor(client, password))
    setPassword('')
  })
  const enable = useAction(async () => {
    const res = await api.enableTwoFactor(client, code.trim())
    client.adopt(res.session)
    setCodes(res.recoveryCodes)
    invalidate('twofactor')
    invalidate('operators')
  })

  if (codes) return <RecoveryCodes codes={codes} onDone={onDone} />
  if (!secret) {
    return (
      <form
        className="stack"
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          if (password) void start.run()
        }}
      >
        <p className="small" style={{ margin: 0 }}>
          You'll need an authenticator app on your phone — Google Authenticator, Microsoft Authenticator or 1Password all work.
        </p>
        <Field label="Your password" id="tf-password">
          <input
            id="tf-password"
            className="input"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {start.error && <ErrorNote error={start.error} />}
        <div className="form-actions">
          <button className="btn primary" type="submit" disabled={!password || start.pending}>
            Continue
          </button>
        </div>
      </form>
    )
  }
  return (
    <form
      className="stack"
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        if (code.trim()) void enable.run()
      }}
    >
      <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
        <QrCode text={secret.otpauthUrl} />
        <div className="stack small" style={{ gap: 6, flex: 1, minWidth: 180 }}>
          <div>In your app, add an account and scan this code.</div>
          <div className="muted">Can't scan? Enter this key instead:</div>
          <code className="mono" style={{ wordBreak: 'break-all' }}>
            {grouped(secret.secret)}
          </code>
        </div>
      </div>
      <Field label="The 6-digit code your app shows" id="tf-code">
        <input
          id="tf-code"
          className="input"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))}
        />
      </Field>
      {enable.error && <ErrorNote error={enable.error} />}
      <div className="form-actions">
        <button className="btn primary" type="submit" disabled={code.replace(/\D/g, '').length !== 6 || enable.pending}>
          Turn on
        </button>
      </div>
    </form>
  )
}

/** A password and a current code: what turning codes off or renewing recovery codes takes. */
function CodeConfirm({
  open,
  title,
  confirm,
  danger,
  onClose,
  onConfirm,
  children,
}: {
  open: boolean
  title: string
  confirm: string
  danger?: boolean
  onClose: () => void
  onConfirm: (password: string, code: string) => Promise<unknown>
  children?: ReactNode
}) {
  const [code, setCode] = useState('')
  return (
    <StepUpDialog
      open={open}
      title={title}
      confirm={confirm}
      danger={danger}
      hint="And a code from your app, or a recovery code."
      onClose={() => {
        setCode('')
        onClose()
      }}
      onConfirm={async (password) => {
        await onConfirm(password, code.trim())
        setCode('')
      }}
    >
      {children}
      <Field label="Code from your app" id="tf-confirm-code">
        <input id="tf-confirm-code" className="input" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
      </Field>
    </StepUpDialog>
  )
}

/** Settings → Team: the signed-in operator's own codes. */
export function TwoFactorCard() {
  const { client } = useSession()
  const q = useApi('twofactor', (c, s) => api.twoFactorStatus(c, s))
  const [dialog, setDialog] = useState<'setup' | 'off' | 'renew' | null>(null)
  const [renewed, setRenewed] = useState<string[] | null>(null)
  return (
    <Card title="Your sign-in codes" sub="A code from an app on your phone, asked for at sign-in after your password.">
      <Loadable q={q} rows={2}>
        {(s) => (
          <div className="stack" style={{ gap: 10 }}>
            {s.enabled ? (
              <>
                <div>
                  <strong>On</strong> since {date(s.enabledAt)} · {plural(s.recoveryCodesLeft, 'recovery code')} left
                </div>
                {s.recoveryCodesLeft <= 3 && <div className="small warn">Running low on recovery codes — make new ones.</div>}
                <div className="row">
                  <button className="btn sm" onClick={() => setDialog('renew')}>
                    New recovery codes…
                  </button>
                  {!s.required && (
                    <button className="btn sm ghost" onClick={() => setDialog('off')}>
                      Turn off…
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                <div>
                  <strong>Off.</strong> {s.required ? 'Every operator must use them.' : 'Anyone with your password can sign in as you.'}
                </div>
                <div>
                  <button className="btn sm primary" onClick={() => setDialog('setup')}>
                    Set up…
                  </button>
                </div>
              </>
            )}
            {renewed && (
              <div className="notice info" style={{ display: 'block' }}>
                <RecoveryCodes codes={renewed} onDone={() => setRenewed(null)} />
              </div>
            )}
          </div>
        )}
      </Loadable>
      <Dialog
        open={dialog === 'setup'}
        title="Set up sign-in codes"
        onClose={() => {
          setDialog(null)
          invalidate('twofactor')
        }}
      >
        <SetupTwoFactor
          onDone={() => {
            setDialog(null)
            invalidate('twofactor')
          }}
        />
      </Dialog>
      <CodeConfirm
        open={dialog === 'off'}
        title="Turn off sign-in codes"
        confirm="Turn off"
        danger
        onClose={() => setDialog(null)}
        onConfirm={async (password, code) => {
          await api.disableTwoFactor(client, password, code)
          invalidate('twofactor')
          invalidate('operators')
        }}
      />
      <CodeConfirm
        open={dialog === 'renew'}
        title="New recovery codes"
        confirm="Make new codes"
        onClose={() => setDialog(null)}
        onConfirm={async (password, code) => {
          setRenewed((await api.renewRecoveryCodes(client, password, code)).recoveryCodes)
          invalidate('twofactor')
        }}
      >
        <p className="small" style={{ margin: 0 }}>
          Your old recovery codes stop working.
        </p>
      </CodeConfirm>
    </Card>
  )
}

/**
 * When the fleet requires codes, a session that began without one sees only
 * this — the server would refuse everything else anyway.
 */
export function TwoFactorGate({ children }: { children: ReactNode }) {
  const { session, signOut } = useSession()
  const q = useApi('twofactor', (c, s) => api.twoFactorStatus(c, s), { every: 60_000 })
  const [done, setDone] = useState(false)
  const blocked = q.data?.required && !session.operator.mfa && !done
  if (!blocked) return <>{children}</>
  return (
    <main className="login">
      <section className="login-panel" style={{ margin: '0 auto' }}>
        <div className="login-form stack">
          <header>
            <h1>Set up sign-in codes</h1>
            <p className="sub">
              Every operator now signs in with a code from an app on their phone as well as their password. Set yours up to carry on.
            </p>
          </header>
          {q.data!.enabled ? (
            <div className="notice info">
              <span style={{ flex: 1 }}>Yours are already on. Sign in again with a code to carry on.</span>
              <button className="btn sm" onClick={signOut}>
                Sign in again
              </button>
            </div>
          ) : (
            <SetupTwoFactor onDone={() => setDone(true)} />
          )}
          <button className="link-btn small" type="button" onClick={signOut}>
            Sign out
          </button>
        </div>
      </section>
    </main>
  )
}
