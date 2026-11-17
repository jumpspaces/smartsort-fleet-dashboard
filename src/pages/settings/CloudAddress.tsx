import { useState } from 'react'
import * as api from '../../api/endpoints.ts'
import { Field } from '../../components/forms.tsx'
import { StepUpDialog } from '../../components/StepUpDialog.tsx'
import { Card, Loadable } from '../../components/ui.tsx'
import { useApi } from '../../data.ts'
import { date } from '../../lib/format.ts'
import { invalidate } from '../../lib/query.ts'
import { useSession } from '../../lib/session.tsx'

/** Read what the signing workflow printed; null if it isn't that. */
function parseSigned(text: string): { statement: string; signature: string } | null {
  try {
    const v = JSON.parse(text.trim()) as { statement?: unknown; signature?: unknown }
    return typeof v.statement === 'string' && typeof v.signature === 'string' ? { statement: v.statement, signature: v.signature } : null
  } catch {
    return null
  }
}

/**
 * Where the tills' cloud is, and moving it. A move is signed on GitHub with the
 * release key — this server can hand one out but never make one — and each till
 * checks it, and that the new address knows it, before it goes.
 */
export function CloudAddress() {
  const { client, session } = useSession()
  const isAdmin = session.operator.role === 'admin'
  const q = useApi('cloudaddress', (c, s) => api.cloudAddress(c, s))
  const [pasted, setPasted] = useState('')
  const [dialog, setDialog] = useState<'set' | 'clear' | null>(null)
  const signed = parseSigned(pasted)

  return (
    <Card
      title="Cloud address"
      sub="Where the tills sync, check in and get updates. Each was built knowing one address; a move sends them all somewhere new without a new installer."
    >
      <Loadable q={q} rows={3}>
        {(view) =>
          view.move ? (
            <div className="stack" style={{ gap: 10 }}>
              <div>
                Tills are being moved to <strong className="mono">{view.move.apiUrl}</strong>
                <div className="small sub">
                  Check-ins: <span className="mono">{view.move.fleetUrl}</span> · Updates: <span className="mono">{view.move.feedUrl}</span> · signed{' '}
                  {date(view.move.issuedAt)}
                </div>
              </div>
              <div className={`notice ${view.verified === false ? 'warn' : 'info'}`}>
                {view.verified === true
                  ? 'Signed with the release key the tills were built with.'
                  : view.verified === false
                    ? "Not signed with the release key — no till will act on it."
                    : "This server can't check the signature (UPDATE_PUBLIC_KEY isn't set); each till checks it before moving."}
              </div>
              <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                <li>Each till moves at a check-in, once the new address answers and recognises its key — so the new server must already hold this database.</li>
                <li>A till that then hears nothing at the new address for a day goes back to the address it was built with.</li>
                <li>Tills check in here until they move: this list empties as they go.</li>
              </ul>
              {isAdmin && (
                <div>
                  <button className="btn sm" onClick={() => setDialog('clear')}>
                    Stop handing it out…
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="stack" style={{ gap: 10 }}>
              <div>Every till uses the address it was built with.</div>
              {isAdmin ? (
                <>
                  <Field
                    label="A signed move"
                    id="cloud-move"
                    hint={
                      <>
                        Run <strong>Move tills to a new cloud address</strong> under Actions on GitHub, then paste what it prints. Only the release key, which
                        lives there, can sign one.
                      </>
                    }
                  >
                    <textarea
                      id="cloud-move"
                      className="textarea mono"
                      rows={3}
                      placeholder='{"statement":"…","signature":"…"}'
                      value={pasted}
                      onChange={(e) => setPasted(e.target.value)}
                    />
                  </Field>
                  {pasted.trim() && !signed && <div className="small warn">That isn't what the workflow prints — paste the whole line.</div>}
                  <div>
                    <button className="btn sm primary" disabled={!signed} onClick={() => setDialog('set')}>
                      Hand it to the tills…
                    </button>
                  </div>
                </>
              ) : (
                <div className="notice info">Only admins can change this.</div>
              )}
            </div>
          )
        }
      </Loadable>
      <StepUpDialog
        open={dialog === 'set'}
        title="Move the tills"
        confirm="Hand it out"
        danger
        hint="Asked again because this sends every till somewhere new."
        onClose={() => setDialog(null)}
        onConfirm={async (password) => {
          await api.setCloudAddress(client, signed!, password)
          setPasted('')
          invalidate('cloudaddress')
        }}
      >
        <p className="small" style={{ margin: 0 }}>
          Every till gets it at its next check-in, and moves once the new address recognises it.
        </p>
      </StepUpDialog>
      <StepUpDialog
        open={dialog === 'clear'}
        title="Stop handing out the move"
        confirm="Stop"
        onClose={() => setDialog(null)}
        onConfirm={async (password) => {
          await api.clearCloudAddress(client, password)
          invalidate('cloudaddress')
        }}
      >
        <p className="small" style={{ margin: 0 }}>
          Tills that already moved stay where they are; the rest stay here.
        </p>
      </StepUpDialog>
    </Card>
  )
}
