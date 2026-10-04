import { useCallback, useEffect, useState } from 'react'
import { Forbidden, Unauthorized, type Api, type WhatsAppPatch, type WhatsAppSettings as Settings } from '../api.ts'
import { Button, Card, CopyButton, KV, Notice } from '../components/ui.tsx'
import { exact, timeAgo } from '../lib/format.ts'

/**
 * The WhatsApp Business account the shop assistant talks through (Meta's
 * Cloud API). Owners link their own number from the mobile app; this is the
 * account they link to. The access token and app secret are stored sealed and
 * never shown again — leave them blank to keep the saved ones. Admin-only to
 * change.
 */
export function WhatsAppSettingsCard({ api, onUnauthorized }: { api: Api; onUnauthorized: () => void }) {
  const [s, setS] = useState<Settings | null>(null)
  const [draft, setDraft] = useState<WhatsAppPatch>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setS(await api.whatsappSettings())
    } catch (err) {
      if (err instanceof Unauthorized) return onUnauthorized()
      setError(err instanceof Error ? err.message : 'Could not load WhatsApp settings')
    }
  }, [api, onUnauthorized])

  useEffect(() => {
    void load()
  }, [load])

  async function save() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      // Blank secret fields mean "keep the saved one".
      const patch = Object.fromEntries(Object.entries(draft).filter(([k, v]) => !((k === 'accessToken' || k === 'appSecret') && !v))) as WhatsAppPatch
      setS(await api.setWhatsappSettings(patch))
      setDraft({})
      setNotice('Saved.')
    } catch (err) {
      if (err instanceof Unauthorized) return onUnauthorized()
      setError(err instanceof Forbidden ? 'Only admins can change WhatsApp settings.' : err instanceof Error ? err.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  if (!s) return error ? <Card title="WhatsApp"><Notice>{error}</Notice></Card> : null
  // The server the console talks to is the one Meta must call.
  const webhook = `${(api.apiBase || window.location.origin).replace(/\/+$/, '')}/api/whatsapp/webhook`
  const field = (key: keyof WhatsAppPatch, label: string, hint?: string, secret = false) => (
    <label className="field" style={{ marginBottom: 10 }}>
      <span>{label}</span>
      <input
        className="input"
        type={secret ? 'password' : 'text'}
        autoComplete="off"
        placeholder={secret ? ((key === 'accessToken' ? s.hasAccessToken : s.hasAppSecret) ? 'Saved — leave blank to keep' : '') : ''}
        value={(draft[key] as string | undefined) ?? (secret ? '' : ((s[key as keyof Settings] as string | null) ?? ''))}
        onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
      />
      {hint && <span className="hint">{hint}</span>}
    </label>
  )

  return (
    <Card title="WhatsApp" actions={<span className={s.configured ? 'strong' : 'muted'}>{s.configured ? 'Connected' : 'Not set up'}</span>}>
      {error && <Notice>{error}</Notice>}
      <p className="hint" style={{ marginBottom: 12 }}>
        Owners ask the assistant, approve suggestions and get their briefings on WhatsApp. Create a WhatsApp Business app in Meta's
        developer console, then enter its details here and register the webhook below with the same verify token.
      </p>
      <dl className="kv-list" style={{ marginBottom: 12 }}>
        <KV k="Webhook URL" v={<span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>{webhook}<CopyButton value={webhook} /></span>} />
      </dl>
      {field('phoneNumberId', 'Phone number ID', 'From the WhatsApp → API setup page.')}
      {field('displayNumber', 'Business number', 'As owners should see it, e.g. +233 30 000 0000.')}
      {field('accessToken', 'Access token', 'A permanent system-user token.', true)}
      {field('appSecret', 'App secret', 'Used to check every webhook really comes from Meta.', true)}
      {field('verifyToken', 'Verify token', 'Any long random string; enter the same one in Meta.')}
      {field('digestTemplate', 'Briefing template', 'Approved template with one body parameter, for briefings sent outside the 24-hour window.')}
      {field('orderTemplate', 'Order template', 'Approved template with two body parameters (shop, order), to send orders to suppliers. Optional.')}
      {field('templateLanguage', 'Template language', 'e.g. en, en_GB.')}
      <Button variant="primary" busy={busy} busyLabel="Saving…" disabled={Object.keys(draft).length === 0} onClick={() => void save()}>
        Save
      </Button>
      {notice && <p className="hint" style={{ marginTop: 8 }}>{notice}</p>}
      {s.updatedAt && (
        <p className="hint" style={{ marginTop: 8 }} title={exact(s.updatedAt)}>
          Last changed {timeAgo(s.updatedAt)}{s.updatedBy ? ` by ${s.updatedBy}` : ''}.
        </p>
      )}
    </Card>
  )
}
