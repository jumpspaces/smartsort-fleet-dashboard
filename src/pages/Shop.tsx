import { useState } from 'react'
import * as api from '../api/endpoints.ts'
import type { Shop as ShopRow } from '../api/types.ts'
import { TillsTable } from '../components/TillsTable.tsx'
import { Card, Empty, ErrorNote, Live, Loadable, PageHeader, Skeleton, When } from '../components/ui.tsx'
import { useApi, useAssistantOn, useDevices, useShops } from '../data.ts'
import { date, exact, until } from '../lib/format.ts'
import { helpHref, href, receiptsHref } from '../lib/router.ts'
import { Phones } from './Phones.tsx'
import { Inventory } from './shop/Inventory.tsx'
import { ShopAssistant } from './shop/ShopAssistant.tsx'
import { Edition, Machines, ShopActions } from './shop/ShopTools.tsx'
import { ClosedBanner, ShopClosure } from './shop/ShopClosure.tsx'
import { ShopAccount } from './shop/ShopAccount.tsx'
import { ShopContacts } from './shop/ShopContacts.tsx'
import { ShopTillSettings } from './shop/ShopTillSettings.tsx'
import { TillHealth } from './Shops.tsx'

const TABS = ['overview', 'contacts', 'account', 'stock', 'features', 'tills', 'assistant', 'closing'] as const
type Tab = (typeof TABS)[number]
const TAB_LABEL: Record<Tab, string> = {
  overview: 'Overview',
  contacts: 'Contact log',
  account: 'Account',
  stock: 'Stock',
  features: 'Features',
  tills: 'Till settings',
  assistant: 'Assistant',
  closing: 'Data & closing',
}

export function Shop({ id, params }: { id: string; params: URLSearchParams }) {
  const shops = useShops()
  const aiOn = useAssistantOn()
  const back = { href: href('/shops'), label: 'Shops' }
  const shop = shops.data?.find((s) => s.id === id)
  const raw = params.get('tab')
  const tabs = TABS.filter((t) => t !== 'assistant' || aiOn)
  const tab: Tab = (tabs as readonly string[]).includes(raw ?? '') ? (raw as Tab) : 'overview'

  if (!shops.data) {
    return (
      <>
        <PageHeader title="Shop" back={back} />
        <Card flush>
          {shops.error ? (
            <div style={{ padding: 16 }}>
              <ErrorNote error={shops.error} onRetry={shops.reload} />
            </div>
          ) : (
            <Skeleton rows={6} />
          )}
        </Card>
      </>
    )
  }
  if (!shop) {
    return (
      <>
        <PageHeader title="Shop not found" back={back} />
        <Card>
          <Empty title="No shop with this id">The link may be wrong.</Empty>
        </Card>
      </>
    )
  }

  const base = `/shops/${encodeURIComponent(shop.id)}`
  return (
    <div className="stack">
      <PageHeader
        back={back}
        title={shop.name}
        sub={[shop.code && `Code ${shop.code}`, shop.location, shop.owner?.name].filter(Boolean).join(' · ') || undefined}
        actions={
          <>
            <Live updatedAt={shops.updatedAt} busy={shops.refreshing} />
            <ShopActions shop={shop} />
          </>
        }
      />
      <nav className="tabs" aria-label="Shop sections">
        {tabs.map((t) => (
          <a key={t} href={href(base, { tab: t === 'overview' ? null : t })} aria-current={t === tab ? 'page' : undefined}>
            {TAB_LABEL[t]}
          </a>
        ))}
      </nav>
      {tab === 'overview' && (
        <>
          <ClosedBanner shop={shop} href={href(base, { tab: 'closing' })} />
          {!shop.activated && !shop.closure && (
            <div className="notice warn">
              {shop.hasLiveClaimCode
                ? `Not set up yet — the setup code expires ${until(shop.claimCodeExpiresAt)}.`
                : 'Not set up yet, and there’s no live setup code. Make a new one to give the owner.'}
            </div>
          )}
          <ShopTills shop={shop} />
          <div className="grid-2">
            <Machines machines={shop.machines} shopId={shop.id} />
            <About shop={shop} />
          </div>
          <div className="grid-2">
            <ShopHelp shopId={shop.id} />
            <FindSale shopId={shop.id} />
          </div>
          <Phones shopId={shop.id} />
        </>
      )}
      {tab === 'stock' && <Inventory shop={shop} />}
      {tab === 'features' && <Edition shopId={shop.id} />}
      {tab === 'tills' && <ShopTillSettings shopId={shop.id} />}
      {tab === 'assistant' && <ShopAssistant shopId={shop.id} />}
      {tab === 'closing' && <ShopClosure shop={shop} />}
      {tab === 'contacts' && <ShopContacts shopId={shop.id} />}
      {tab === 'account' && <ShopAccount shop={shop} />}
    </div>
  )
}

function ShopTills({ shop }: { shop: ShopRow }) {
  const devices = useDevices({ shopId: shop.id, sort: 'shop', dir: 'asc', limit: 200 })
  return (
    <Card title="Tills" sub={<TillHealth s={shop} />} flush>
      <Loadable q={devices} rows={3}>
        {(p) =>
          p.devices.length === 0 ? (
            <Empty title="No tills reporting">
              {shop.activated ? 'None of this shop’s machines has checked in yet.' : 'The shop hasn’t been set up yet.'}
            </Empty>
          ) : (
            <TillsTable devices={p.devices} hideShop />
          )
        }
      </Loadable>
    </Card>
  )
}

function About({ shop }: { shop: ShopRow }) {
  return (
    <Card title="About" flush>
      <dl className="kv" style={{ margin: 0, gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
        <div>
          <dt>Owner</dt>
          <dd>
            {shop.owner?.name ?? '—'}
            {shop.owner && <div className="small muted">Staff ID {shop.owner.staffId}</div>}
          </dd>
        </div>
        <div>
          <dt>Phone</dt>
          <dd>{shop.phone ? <a href={`tel:${shop.phone}`}>{shop.phone}</a> : '—'}</dd>
        </div>
        <div>
          <dt>Shop code</dt>
          <dd className="mono">{shop.code ?? '—'}</dd>
        </div>
        <div>
          <dt>Currency</dt>
          <dd>{shop.currency}</dd>
        </div>
        <div>
          <dt>Set up</dt>
          <dd className={shop.activated ? undefined : 'warn'}>
            {shop.activated ? 'Yes' : shop.hasLiveClaimCode ? `Code expires ${until(shop.claimCodeExpiresAt)}` : 'Waiting — no live code'}
          </dd>
        </div>
        <div>
          <dt>Joined</dt>
          <dd title={exact(shop.createdAt)}>{date(shop.createdAt)}</dd>
        </div>
      </dl>
    </Card>
  )
}

/** What this shop has asked us lately, waiting first. */
function ShopHelp({ shopId }: { shopId: string }) {
  const q = useApi(`help:shop:${shopId}`, (c, s) => api.helpRequests(c, { status: 'all', shopId }, s), { every: 60_000 })
  return (
    <Card
      title="Help requests"
      sub={q.data?.counts.open ? `${q.data.counts.open} waiting on us` : 'Sent from their till or phone'}
      actions={
        <a className="btn sm ghost" href={href('/help', { shopId, status: 'all' })}>
          All
        </a>
      }
      flush
    >
      <Loadable q={q} rows={3}>
        {({ requests }) =>
          requests.length === 0 ? (
            <Empty title="They haven’t asked for help from the app" />
          ) : (
            <ul className="list">
              {requests.slice(0, 5).map((r) => (
                <li key={r.id} className="row" style={{ padding: '8px 16px', gap: 10, alignItems: 'flex-start' }}>
                  <span className={`badge ${r.status === 'open' ? 'attention' : r.status === 'answered' ? 'healthy' : 'neutral'}`} style={{ flex: 'none' }}>
                    {r.status === 'open' ? 'Waiting' : r.status === 'answered' ? 'Answered' : 'Closed'}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <a href={helpHref(r.id)} style={{ overflowWrap: 'anywhere' }}>
                      {r.message.length > 90 ? `${r.message.slice(0, 87)}…` : r.message}
                    </a>
                    <div className="small muted">
                      {r.requesterName ?? 'Someone'} · <When iso={r.createdAt} />
                    </div>
                  </span>
                </li>
              ))}
            </ul>
          )
        }
      </Loadable>
    </Card>
  )
}

/** A receipt number read out on the phone, looked up in this shop only. */
function FindSale({ shopId }: { shopId: string }) {
  const [text, setText] = useState('')
  return (
    <Card title="Find a sale" sub="Receipt number or MoMo reference, in this shop only.">
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault()
          if (text.trim()) location.hash = receiptsHref(text.trim(), shopId)
        }}
      >
        <input
          className="input"
          aria-label="Receipt number or MoMo reference"
          placeholder="e.g. T2 451"
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{ flex: 1 }}
        />
        <button className="btn" disabled={!text.trim()}>
          Find
        </button>
      </form>
    </Card>
  )
}
