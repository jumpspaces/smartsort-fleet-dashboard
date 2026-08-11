/**
 * The one-time code panel, shared by the two places a code is minted:
 * onboarding a shop (Shops) and re-issuing for an existing one (Shop).
 */
import type { ProvisionResult } from '../api.ts'
import { Button, CopyButton } from '../components/ui.tsx'
import { timeUntil } from '../lib/format.ts'

/** Provisioning + the one-time code, kept together so the panel can show both. */
export type ClaimResult = ProvisionResult & { shopName: string }

/**
 * Which kind of one-time code is on screen.
 *
 *   claim      activation — redeeming it sets the owner's password
 *   reconnect  attaches another machine to a live shop and grants nothing else
 */
export type CodeKind = 'claim' | 'reconnect'

/**
 * Shown once, right after provisioning or issuing a code. It is read down a
 * phone line or written on an invoice and cannot be recovered, so it gets
 * display size, a copy button, and copy that says plainly this is the only
 * showing.
 *
 * The two kinds are worded apart on purpose. An operator reading one of these
 * out is about to tell a shop what it does, and the difference is the whole
 * safety story: a claim code hands over the owner's password, a reconnect code
 * hands over nothing but the machine.
 */
export function ClaimPanel({
  result,
  onDismiss,
}: {
  result: ClaimResult & { kind: CodeKind }
  onDismiss: () => void
}) {
  const reconnect = result.kind === 'reconnect'
  return (
    <div className="claim">
      <div className="muted small">
        {reconnect ? 'One-time connect code for ' : 'One-time claim code for '}
        <span className="strong">{result.shopName}</span>
      </div>
      <div className="claim-row">
        <span className="claim-code">{result.claimCode}</span>
        <CopyButton value={result.claimCode} label="Copy code" size="md" />
        <Button variant="ghost" onClick={onDismiss}>
          Done
        </Button>
      </div>
      <p className="hint">
        {reconnect ? (
          <>
            Give this to the shop — on the desktop app they choose{' '}
            <span className="strong">Owner not available?</span> and enter it. It connects the
            machine only: it sets no password and signs nobody in, so staff still need their own
            login afterwards. It works once and expires{' '}
            <span className="strong">{timeUntil(result.expiresAt)}</span>. You won’t be able to see
            it again.
          </>
        ) : (
          <>
            Give this to the shop — they enter it on the desktop app to connect the machine and set
            the owner’s password. It works once and expires{' '}
            <span className="strong">{timeUntil(result.expiresAt)}</span>. You won’t be able to see
            it again.
          </>
        )}
      </p>
      {result.shopCode && !reconnect && (
        <p className="hint" style={{ marginTop: 8 }}>
          Their <span className="strong">shop code</span> is{' '}
          <span className="mono strong">{result.shopCode}</span> — the owner types this with their
          staff ID to sign in to the mobile app. It doesn’t expire, and it stays on the shop’s page.
        </p>
      )}
    </div>
  )
}
