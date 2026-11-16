import { useRef, useState, type FormEvent } from 'react'
import * as api from '../../api/endpoints.ts'
import type { ExportFormat, ExportType, ImportResult, Shop, ShopProduct, StockStatus } from '../../api/types.ts'
import { ActionError, Dialog, Field } from '../../components/forms.tsx'
import { Card, Empty, Loadable, Search, Segmented } from '../../components/ui.tsx'
import { useApi } from '../../data.ts'
import { count } from '../../lib/format.ts'
import { invalidate, useAction } from '../../lib/query.ts'
import { useSession } from '../../lib/session.tsx'

/** Prices here are major units as the server renders them: display only, never summed. */
const price = (n: number, currency: string) => `${currency} ${n.toFixed(2)}`

const STATUS: Record<StockStatus, { label: string; tone: string }> = {
  ok: { label: 'In stock', tone: 'healthy' },
  low: { label: 'Low', tone: 'attention' },
  out: { label: 'Out', tone: 'offline' },
  oversold: { label: 'Oversold', tone: 'offline' },
}

/**
 * A quantity as the shelf reads it. Weighed products keep thousandths (2500 =
 * 2.5 kg), so they're scaled back; pieces are whole numbers.
 */
export function qty(n: number, soldBy?: string | null): string {
  if (!soldBy) return count(n)
  const abs = Math.abs(n)
  const whole = Math.floor(abs / 1000)
  const frac = String(abs % 1000).padStart(3, '0').replace(/0+$/, '')
  return `${n < 0 ? '-' : ''}${whole.toLocaleString('en-US')}${frac ? `.${frac}` : ''} ${soldBy}`
}

/** dd/mm/yyyy, the format the shop's own forms and importer use. */
const ddmmyyyy = (iso: string) => {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export function Inventory({ shop }: { shop: Shop }) {
  const inv = useApi(`inventory:${shop.id}`, (c, s) => api.shopInventory(c, shop.id, s))
  const { canAct } = useSession()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'all' | 'attention' | 'hidden'>('all')
  const [receiving, setReceiving] = useState<ShopProduct | null>(null)
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)

  return (
    <Card
      title="Stock"
      sub="The shop's catalogue as the cloud has it — everything its tills have synced."
      flush
      actions={
        canAct && (
          <>
            <button className="btn sm" onClick={() => setImporting(true)}>
              Import a spreadsheet
            </button>
            <button className="btn sm primary" onClick={() => setAdding(true)}>
              Add a product
            </button>
          </>
        )
      }
    >
      <Loadable q={inv} rows={6}>
        {(d) => {
          const s = d.summary
          const n = q.trim().toLowerCase()
          const list = d.products
            .filter((p) =>
              filter === 'attention' ? p.status !== 'ok' && !p.hidden : filter === 'hidden' ? p.hidden : true,
            )
            .filter((p) => !n || p.name.toLowerCase().includes(n) || p.barcode?.includes(n) || p.category.toLowerCase().includes(n))
          return (
            <>
              <div className="kv" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))' }}>
                <div>
                  <dt>Products</dt>
                  <dd>{count(s.products)}</dd>
                </div>
                <div>
                  <dt>Units on hand</dt>
                  <dd>{count(s.unitsOnHand)}</dd>
                </div>
                <div>
                  <dt>Low</dt>
                  <dd className={s.lowStock ? 'warn' : undefined}>{count(s.lowStock)}</dd>
                </div>
                <div>
                  <dt>Out</dt>
                  <dd className={s.outOfStock ? 'bad' : undefined}>{count(s.outOfStock)}</dd>
                </div>
                <div>
                  <dt>Oversold</dt>
                  <dd className={s.oversold ? 'bad' : undefined}>{count(s.oversold)}</dd>
                </div>
                <div>
                  <dt>Expired units</dt>
                  <dd className={s.expiredUnits ? 'warn' : undefined}>{count(s.expiredUnits)}</dd>
                </div>
              </div>
              <div className="spread" style={{ padding: '12px 16px' }}>
                <Segmented
                  label="Show"
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { value: 'all', label: 'All' },
                    { value: 'attention', label: 'Low, out or oversold' },
                    { value: 'hidden', label: 'Hidden', n: s.hidden },
                  ]}
                />
                <Search value={q} onChange={setQ} placeholder="Search name, barcode or category" />
              </div>
              {list.length === 0 ? (
                <Empty title={d.products.length ? 'No products match' : 'No products yet'}>
                  {d.products.length ? undefined : 'Import the shop’s stock list, or add products one by one.'}
                </Empty>
              ) : (
                <div className="table-wrap" style={{ maxHeight: 520, overflowY: 'auto' }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th className="r">On hand</th>
                        <th className="r">Cost</th>
                        <th className="r">Price</th>
                        <th>Next expiry</th>
                        <th>Status</th>
                        {canAct && <th />}
                      </tr>
                    </thead>
                    <tbody>
                      {list.slice(0, 300).map((p) => (
                        <tr key={p.id} style={p.hidden ? { opacity: 0.6 } : undefined}>
                          <td>
                            <div style={{ fontWeight: 550 }}>{p.name}</div>
                            <div className="small muted">
                              {p.category}
                              {p.barcode && ` · ${p.barcode}`}
                              {p.hidden && ' · hidden'}
                              {p.trackSerials && ' · serial numbers'}
                              {p.soldBy && ` · by the ${p.soldBy}`}
                            </div>
                          </td>
                          <td className="r num">
                            {qty(p.stock, p.soldBy)}
                            {p.expiredStock > 0 && (
                              <div className="small" style={{ color: 'var(--warn)' }}>+{qty(p.expiredStock, p.soldBy)} expired</div>
                            )}
                          </td>
                          <td className="r num nowrap">{price(p.costPrice, shop.currency)}</td>
                          <td className="r num nowrap">{price(p.sellingPrice, shop.currency)}</td>
                          <td className="sub">{p.expiryDate || '—'}</td>
                          <td>
                            <span className={`badge ${STATUS[p.status].tone}`}>{STATUS[p.status].label}</span>
                          </td>
                          {canAct && (
                            <td className="r">
                              <button className="btn sm ghost" onClick={() => setReceiving(p)}>
                                Receive
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {list.length > 300 && <div className="pager">Showing the first 300 of {count(list.length)}. Search to narrow it down.</div>}
                </div>
              )}
              <Downloads shop={shop} />
            </>
          )
        }}
      </Loadable>
      {canAct && (
        <>
          <ReceiveDialog shop={shop} product={receiving} onClose={() => setReceiving(null)} />
          <AddProductDialog shop={shop} open={adding} onClose={() => setAdding(false)} categories={inv.data?.categories ?? []} />
          <ImportDialog shop={shop} open={importing} onClose={() => setImporting(false)} hasProducts={(inv.data?.products.length ?? 0) > 0} />
        </>
      )}
    </Card>
  )
}

/* -------------------------------------------------------------- downloads */

const DATASETS: { type: ExportType; label: string; ranged: boolean; csvOnly?: boolean }[] = [
  { type: 'products', label: 'Products & stock', ranged: false, csvOnly: true },
  { type: 'sales', label: 'Sales (line items)', ranged: true },
  { type: 'profit', label: 'Profit', ranged: true },
  { type: 'tax', label: 'Tax (GRA)', ranged: true },
  { type: 'wastage', label: 'Wastage', ranged: false },
  { type: 'deadstock', label: 'Dead stock', ranged: true },
]

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function Downloads({ shop }: { shop: Shop }) {
  const { client } = useSession()
  const today = new Date()
  const [type, setType] = useState<ExportType>('sales')
  const [format, setFormat] = useState<ExportFormat>('csv')
  const [from, setFrom] = useState(isoDay(new Date(today.getFullYear(), today.getMonth(), 1)))
  const [to, setTo] = useState(isoDay(today))
  const ds = DATASETS.find((d) => d.type === type)!
  const fmt = ds.csvOnly ? 'csv' : format
  const dl = useAction(async () => {
    const file = await api.shopExport(client, shop.id, { type, format: fmt, ...(ds.ranged ? { from, to } : {}) })
    const url = URL.createObjectURL(file.blob)
    const a = document.createElement('a')
    a.href = url
    a.download = file.filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  })
  return (
    <div style={{ padding: 16, borderTop: '1px solid var(--line)' }} className="stack">
      <div style={{ fontWeight: 550 }}>Download the shop’s books</div>
      <div className="row">
        <select className="select" aria-label="What to download" value={type} onChange={(e) => setType(e.target.value as ExportType)}>
          {DATASETS.map((d) => (
            <option key={d.type} value={d.type}>
              {d.label}
            </option>
          ))}
        </select>
        {!ds.csvOnly && (
          <select className="select" aria-label="Format" value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
            <option value="csv">Spreadsheet (CSV)</option>
            <option value="pdf">PDF</option>
          </select>
        )}
        {ds.ranged && (
          <>
            <input className="input" type="date" aria-label="From" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            <span className="muted">to</span>
            <input className="input" type="date" aria-label="To" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </>
        )}
        <button className="btn sm" disabled={dl.pending} onClick={() => void dl.run()}>
          {dl.pending ? 'Preparing…' : 'Download'}
        </button>
      </div>
      {type === 'products' && (
        <div className="notice warn">
          Clear the Stock Quantity column before importing this file back. On a product that already exists those units are added to the
          shelf, so sending it back untouched doubles the shop’s stock.
        </div>
      )}
      <ActionError error={dl.error} />
    </div>
  )
}

/* ---------------------------------------------------------------- import */

const TEMPLATES = {
  products: ['Product Name', 'Category', 'Barcode', 'Cost Price', 'Selling Price', 'Stock Quantity', 'Expiry Date', 'Reorder Level', 'Pack Name', 'Units Per Pack', 'Sold By'],
  batches: ['Product Name', 'Quantity Received', 'Batch Cost', 'Expiry Date', 'Supplier', 'Unit'],
}

function ImportDialog({ shop, open, onClose, hasProducts }: { shop: Shop; open: boolean; onClose: () => void; hasProducts: boolean }) {
  const { client } = useSession()
  const [kind, setKind] = useState<'products' | 'batches'>('products')
  const [csv, setCsv] = useState('')
  const [filename, setFilename] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const rows = csv.trim() ? csv.trim().split(/\r?\n/).length - 1 : 0
  const run = useAction(async () => {
    const r = kind === 'products' ? await api.importProducts(client, shop.id, csv) : await api.importBatches(client, shop.id, csv)
    setResult(r)
    invalidate(`inventory:${shop.id}`)
  })
  const template = () => {
    const blob = new Blob([TEMPLATES[kind].join(',') + '\n'], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${kind}-template.csv`
    a.click()
  }
  const close = () => {
    setCsv('')
    setFilename(null)
    setResult(null)
    onClose()
  }
  return (
    <Dialog open={open} onClose={close} title={`Import into ${shop.name}`} wide>
      <div className="form">
        <Field label="What the sheet contains" id="ik">
          <select
            id="ik"
            className="select"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as 'products' | 'batches')
              setResult(null)
            }}
          >
            <option value="products">Products — create or update the catalogue</option>
            <option value="batches">Stock received — add units to products it already has</option>
          </select>
        </Field>
        <div className="hint">
          {kind === 'products'
            ? 'Rows are matched by barcode, then name: a match updates that product, anything else creates one. Stock Quantity is opening stock on a new product and units RECEIVED on an existing one — leave it blank to change names and prices without moving stock.'
            : 'Every row must name a product the shop already has. Batch Cost is the total for the line, not one unit.'}
        </div>
        {kind === 'batches' && !hasProducts && <div className="notice warn">This shop has no products yet. Import the catalogue first.</div>}
        <div className="row">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (!f) return
              setFilename(f.name)
              setCsv(await f.text())
              setResult(null)
              e.target.value = ''
            }}
          />
          <button type="button" className="btn sm" onClick={() => fileRef.current?.click()}>
            Choose a CSV
          </button>
          <button type="button" className="btn sm ghost" onClick={template}>
            Download a blank template
          </button>
          {filename && (
            <span className="small sub">
              {filename} · {count(rows)} rows
            </span>
          )}
        </div>
        <ActionError error={run.error} />
        {result && (
          <div className={`notice ${result.failed ? 'warn' : 'info'}`} style={{ display: 'block' }}>
            {count(result.imported)} added · {count(result.updated)} updated · {count(result.failed)} refused, of {count(result.total)} rows.
            {result.errors.length > 0 && (
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {result.errors.slice(0, 20).map((e, i) => (
                  <li key={i}>
                    Row {e.row}: {e.message}
                  </li>
                ))}
                {result.errors.length > 20 && <li>…and {result.errors.length - 20} more</li>}
              </ul>
            )}
          </div>
        )}
        <div className="small muted">Changes reach the shop’s tills by themselves within about a minute.</div>
        <div className="form-actions">
          <button type="button" className="btn" onClick={close}>
            {result ? 'Done' : 'Cancel'}
          </button>
          {!result && (
            <button type="button" className="btn primary" disabled={!rows || run.pending} onClick={() => void run.run()}>
              {run.pending ? 'Importing…' : `Import ${count(rows)} rows`}
            </button>
          )}
        </div>
      </div>
    </Dialog>
  )
}

/* ----------------------------------------------------------- add / receive */

function AddProductDialog({ shop, open, onClose, categories }: { shop: Shop; open: boolean; onClose: () => void; categories: string[] }) {
  const { client } = useSession()
  const blank = { name: '', category: '', barcode: '', cost: '', price: '', stock: '', expiry: '', reorder: '' }
  const [f, setF] = useState(blank)
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setF((v) => ({ ...v, [k]: e.target.value }))
  const save = useAction(async () => {
    await api.createProduct(client, shop.id, {
      name: f.name.trim(),
      category: f.category.trim() || undefined,
      barcode: f.barcode.trim() || null,
      costPrice: Number(f.cost) || 0,
      sellingPrice: Number(f.price) || 0,
      openingStock: f.stock ? Number(f.stock) : undefined,
      expiryDate: f.expiry ? ddmmyyyy(f.expiry) : undefined,
      reorderLevel: f.reorder ? Number(f.reorder) : null,
    })
    invalidate(`inventory:${shop.id}`)
    setF(blank)
    onClose()
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void save.run()
  }
  return (
    <Dialog open={open} onClose={onClose} title={`Add a product to ${shop.name}`}>
      <form className="form" onSubmit={submit}>
        <Field label="Name" id="pn">
          <input id="pn" className="input" required value={f.name} onChange={set('name')} />
        </Field>
        <div className="form-grid">
          <Field label="Category" id="pc">
            <input id="pc" className="input" list="cats" value={f.category} onChange={set('category')} />
            <datalist id="cats">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label="Barcode" id="pb">
            <input id="pb" className="input" value={f.barcode} onChange={set('barcode')} />
          </Field>
          <Field label={`Cost each (${shop.currency})`} id="pco">
            <input id="pco" className="input" type="number" min={0} step="0.01" value={f.cost} onChange={set('cost')} />
          </Field>
          <Field label={`Selling price (${shop.currency})`} id="pp">
            <input id="pp" className="input" type="number" min={0} step="0.01" required value={f.price} onChange={set('price')} />
          </Field>
          <Field label="Opening stock" id="ps">
            <input id="ps" className="input" type="number" min={0} step={1} value={f.stock} onChange={set('stock')} />
          </Field>
          <Field label="Expiry (optional)" id="pe">
            <input id="pe" className="input" type="date" value={f.expiry} onChange={set('expiry')} />
          </Field>
          <Field label="Warn when down to" id="pr">
            <input id="pr" className="input" type="number" min={0} step={1} value={f.reorder} onChange={set('reorder')} />
          </Field>
        </div>
        <div className="small muted">The shop’s own stock log will show the owner as having added it; this console records that it was you.</div>
        <ActionError error={save.error} />
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" type="submit" disabled={save.pending}>
            Add
          </button>
        </div>
      </form>
    </Dialog>
  )
}

function ReceiveDialog({ shop, product, onClose }: { shop: Shop; product: ShopProduct | null; onClose: () => void }) {
  return (
    <Dialog open={!!product} onClose={onClose} title={product ? `Receive ${product.name}` : 'Receive'}>
      {product && <ReceiveForm key={product.id} shop={shop} product={product} onDone={onClose} />}
    </Dialog>
  )
}

function ReceiveForm({ shop, product, onDone }: { shop: Shop; product: ShopProduct; onDone: () => void }) {
  const { client } = useSession()
  const packs = (product.unitsPerPack ?? 0) > 1
  const [qtyText, setQty] = useState('')
  const [unit, setUnit] = useState<'piece' | 'pack'>('piece')
  const [cost, setCost] = useState(product.costPrice ? String(product.costPrice) : '')
  const [expiry, setExpiry] = useState('')
  const [supplier, setSupplier] = useState('')
  const [serialText, setSerialText] = useState('')
  const serials = serialText.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean)
  const weighed = !!product.soldBy
  const save = useAction(async () => {
    const amount = Number(qtyText)
    let n: number
    if (weighed) {
      // Thousandths on the wire: 2.5 kg is 2500.
      n = Math.round(amount * 1000)
      if (!Number.isFinite(amount) || n <= 0) throw new Error(`Enter how much arrived, in ${product.soldBy}.`)
    } else {
      n = amount
      if (!Number.isInteger(n) || n <= 0) throw new Error('Enter how many arrived — a whole number above zero.')
    }
    if (product.trackSerials) {
      const pieces = unit === 'pack' ? n * (product.unitsPerPack ?? 1) : n
      if (serials.length !== pieces) throw new Error(`Enter one serial number per piece: ${pieces} needed, ${serials.length} entered.`)
      if (new Set(serials).size !== serials.length) throw new Error('The same serial number is entered twice.')
    }
    await api.receiveStock(client, shop.id, {
      supplier: supplier.trim() || undefined,
      lines: [
        {
          productId: product.id,
          stock: n,
          unit: weighed ? undefined : unit,
          serials: product.trackSerials ? serials : undefined,
          // Per piece, or per pack when receiving packs: the server divides it down.
          costPrice: Number(cost) || 0,
          sellingPrice: product.sellingPrice,
          expiryDate: expiry ? ddmmyyyy(expiry) : undefined,
        },
      ],
    })
    invalidate(`inventory:${shop.id}`)
    onDone()
  })
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault()
        void save.run()
      }}
    >
      <div className="small sub">
        On hand now: {qty(product.stock, product.soldBy)}
        {packs && ` · ${product.packLabel ?? 'pack'} of ${product.unitsPerPack}`}
      </div>
      <div className="form-grid">
        <Field label={weighed ? `How much arrived (${product.soldBy})` : 'How many arrived'} id="rq">
          <input
            id="rq"
            className="input"
            type="number"
            min={weighed ? 0.001 : 1}
            step={weighed ? 0.001 : 1}
            required
            autoFocus
            value={qtyText}
            onChange={(e) => setQty(e.target.value)}
          />
        </Field>
        {packs && !weighed && (
          <Field label="Counted in" id="ru">
            <select id="ru" className="select" value={unit} onChange={(e) => setUnit(e.target.value as 'piece' | 'pack')}>
              <option value="piece">Pieces</option>
              <option value="pack">{product.packLabel ?? 'Packs'}</option>
            </select>
          </Field>
        )}
        <Field label={`Cost per ${weighed ? product.soldBy : unit === 'pack' ? 'pack' : 'piece'} (${shop.currency})`} id="rc">
          <input id="rc" className="input" type="number" min={0} step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} />
        </Field>
        <Field label="Expiry (optional)" id="re">
          <input id="re" className="input" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        </Field>
        <Field label="Supplier (optional)" id="rs">
          <input id="rs" className="input" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
        </Field>
      </div>
      {product.trackSerials && (
        <Field
          label="Serial numbers"
          id="rsn"
          hint={`One per piece, one per line (or comma-separated). ${serials.length} entered.`}
        >
          <textarea id="rsn" className="textarea mono" rows={4} value={serialText} onChange={(e) => setSerialText(e.target.value)} />
        </Field>
      )}
      <ActionError error={save.error} />
      <div className="form-actions">
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
        <button className="btn primary" type="submit" disabled={save.pending}>
          Receive
        </button>
      </div>
    </form>
  )
}
