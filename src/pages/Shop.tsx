import type { Shop as ShopRow } from '../api/types.ts'
import { TillsTable } from '../components/TillsTable.tsx'
import { Card, Empty, ErrorNote, Live, Loadable, PageHeader, Skeleton } from '../components/ui.tsx'
import { useAssistantOn, useDevices, useShops } from '../data.ts'
import { date, exact, until } from '../lib/format.ts'
import { href } from '../lib/router.ts'
import { Inventory } from './shop/Inventory.tsx'
import { ShopAssistant } from './shop/ShopAssistant.tsx'
import { Edition, Machines, ShopActions } from './shop/ShopTools.tsx'
import { TillHealth } from './Shops.tsx'

const TABS = ['overview', 'stock', 'features', 'assistant'] as const
type Tab = (typeof TABS)[number]
const TAB_LABEL: Record<Tab, string> = { overview: 'Overview', stock: 'Stock', features: 'Features', assistant: 'Assistant' }

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
          {!shop.activated && (
            <div className="notice warn">
              {shop.hasLiveClaimCode
                ? `Not set up yet — the setup code expires ${until(shop.claimCodeExpiresAt)}.`
                : 'Not set up yet, and there’s no live setup code. Make a new one to give the owner.'}
            </div>
          )}
          <ShopTills shop={shop} />
          <div className="grid-2">
            <Machines machines={shop.machines} />
            <About shop={shop} />
          </div>
        </>
      )}
      {tab === 'stock' && <Inventory shop={shop} />}
      {tab === 'features' && <Edition shopId={shop.id} />}
      {tab === 'assistant' && <ShopAssistant shopId={shop.id} />}
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
