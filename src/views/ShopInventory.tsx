/**
 * A shop's inventory, from the vendor's side of the glass.
 *
 * Two jobs, and they are the same job from opposite directions: get the shop's
 * catalogue OUT (as a file an operator can read, mail, or fix in a spreadsheet)
 * and get stock IN on their behalf. Most of these shops are one person with a
 * phone, and "send us your stock list and we'll load it" is part of what they
 * bought — until now the only way to honour it was to talk someone through the
 * admin app line by line.
 *
 * Two things this surface must keep saying out loud, because both are easy to
 * assume wrongly and expensive to get wrong:
 *
 *   - A write here lands on the CLOUD, and reaches the shop's tills on their
 *     next sync. It is not instant, and it is not a remote-control of the till.
 *   - Stock movements are recorded in the shop's own books against the OWNER
 *     (the ledger's actor is a foreign key into the shop's staff, and an
 *     operator is not one of them). Who really did it lives in the fleet audit
 *     log. The operator should know that before they press the button, not
 *     after the owner asks why they adjusted their own stock at 2am.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Unauthorized,
  type Api,
  type ExportFormat,
  type ExportType,
  type ImportResult,
  type ShopInventory as Inventory,
  type ShopProduct,
  type ShopRow,
  type StockStatus,
} from '../api.ts'
import { Icon } from '../components/Icon.tsx'
import { Button, Card, Chip, Empty, Notice, type Tone } from '../components/ui.tsx'
import { downloadCsv } from '../lib/csv.ts'
import { downloadBlob } from '../lib/download.ts'
import { useDebounced } from '../lib/useDebounced.ts'

/* ------------------------------------------------------------------ shared */

const STATUS_LABEL: Record<StockStatus, string> = {
  ok: 'In stock',
  low: 'Low',
  out: 'Out',
  oversold: 'Oversold',
}

const STATUS_TONE: Record<StockStatus, Tone> = {
  ok: 'ok',
  low: 'warn',
  out: 'warn',
  // Below zero is not "nearly out" — it means the books and the shelf disagree,
  // which is a correction to make, not stock to order.
  oversold: 'bad',
}

const money = (cedis: number): string =>
  `GHS ${cedis.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** `<input type="date">` gives YYYY-MM-DD; every inventory service wants dd/mm/yyyy. */
function toDdMmYyyy(isoDay: string): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDay.trim())
  return m ? `${m[3]}/${m[2]}/${m[1]}` : undefined
}

/** Anything the panel does: run it, surface the failure, hand back success. */
type Run = (id: string, fn: () => Promise<unknown>) => Promise<void>

/* ================================================================== panel == */

export function ShopInventoryPanels({
  api,
  shop,
  onUnauthorized,
}: {
  api: Api
  shop: ShopRow
  onUnauthorized: () => void
}) {
  const [inventory, setInventory] = useState<Inventory | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setInventory(await api.shopInventory(shop.id))
      setLoadError(null)
    } catch (err) {
      if (err instanceof Unauthorized) return onUnauthorized()
      setLoadError(err instanceof Error ? err.message : 'Could not read this shop’s inventory')
    }
  }, [api, shop.id, onUnauthorized])

  useEffect(() => {
    void load()
  }, [load])

  const run: Run = useCallback(
    async (id, fn) => {
      setBusy(id)
      setError(null)
      try {
        await fn()
      } catch (err) {
        if (err instanceof Unauthorized) return onUnauthorized()
        setError(err instanceof Error ? err.message : 'That didn’t work')
      } finally {
        setBusy(null)
      }
    },
    [onUnauthorized],
  )

  return (
    <>
      {error && <Notice>{error}</Notice>}

      <Card title="Inventory">
        {loadError ? (
          <p className="muted small">{loadError}</p>
        ) : inventory == null ? (
          <div className="skeleton" style={{ width: '60%' }} />
        ) : (
          <Catalogue
            api={api}
            shop={shop}
            inventory={inventory}
            busy={busy}
            run={run}
            onChanged={load}
          />
        )}
      </Card>

      <Card title="Download">
        <Downloads api={api} shop={shop} busy={busy} run={run} />
      </Card>

      {/* Reading a shop's books and writing to them are different permissions,
          and the difference should be visible before the button, not delivered
          as a 403 after it. */}
      {api.operator.role !== 'viewer' && (
        <Card title="Add inventory">
          <AddInventory
            api={api}
            shop={shop}
            hasProducts={(inventory?.products.length ?? 0) > 0}
            categories={inventory?.categories ?? []}
            busy={busy}
            run={run}
            onChanged={load}
          />
        </Card>
      )}
    </>
  )
}

/* ============================================================== catalogue == */

/** How many rows the page shows before asking you to search instead. */
const VISIBLE_ROWS = 25

function Catalogue({
  api,
  shop,
  inventory,
  busy,
  run,
  onChanged,
}: {
  api: Api
  shop: ShopRow
  inventory: Inventory
  busy: string | null
  run: Run
  onChanged: () => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const search = useDebounced(query, 150)
  const [receiving, setReceiving] = useState<ShopProduct | null>(null)
  const { summary, products } = inventory
  const canAct = api.operator.role !== 'viewer'

  if (products.length === 0) {
    return (
      <Empty icon="inbox" title="No products yet">
        This shop’s catalogue is empty. Load it from a spreadsheet below — it works
        before their first till is even connected, and lands when they claim it.
      </Empty>
    )
  }

  const q = search.trim().toLowerCase()
  const matched = q
    ? products.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q) ||
          (p.barcode ?? '').toLowerCase().includes(q),
      )
    : products
  const shown = matched.slice(0, VISIBLE_ROWS)

  return (
    <>
      <div className="chip-row">
        <Chip tone="idle">
          {summary.products} {summary.products === 1 ? 'product' : 'products'}
        </Chip>
        <Chip tone="idle">{summary.unitsOnHand.toLocaleString()} units on hand</Chip>
        {summary.lowStock > 0 && <Chip tone="warn">{summary.lowStock} low</Chip>}
        {summary.outOfStock > 0 && <Chip tone="warn">{summary.outOfStock} out</Chip>}
        {summary.oversold > 0 && <Chip tone="bad">{summary.oversold} oversold</Chip>}
        {summary.expiredUnits > 0 && (
          <Chip tone="bad">{summary.expiredUnits.toLocaleString()} expired units</Chip>
        )}
        {summary.hidden > 0 && <Chip tone="idle">{summary.hidden} hidden</Chip>}
      </div>

      <div className="search" style={{ margin: '12px 0' }}>
        <Icon name="search" size={15} />
        <input
          className="input"
          type="search"
          value={query}
          placeholder="Find a product…"
          aria-label="Search this shop’s products"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {matched.length === 0 ? (
        <p className="muted small">Nothing in this shop matches “{search.trim()}”.</p>
      ) : (
        <ul className="stock-list">
          {shown.map((p) => (
            <li key={p.id}>
              <div className="stock-main">
                <div className="strong">{p.name}</div>
                <div className="row-sub">
                  {p.category || 'Uncategorised'} · {money(p.sellingPrice)}
                  {p.expiryDate ? ` · expires ${p.expiryDate}` : ''}
                  {p.expiredStock > 0 ? ` · ${p.expiredStock} expired` : ''}
                </div>
              </div>
              <div className="stock-qty">
                <span className="num strong">{p.stock.toLocaleString()}</span>
                <Chip tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Chip>
              </div>
              {canAct ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setReceiving((cur) => (cur?.id === p.id ? null : p))}
                  aria-expanded={receiving?.id === p.id}
                >
                  {receiving?.id === p.id ? 'Cancel' : 'Add stock'}
                </Button>
              ) : (
                <span />
              )}
              {canAct && receiving?.id === p.id && (
                <ReceiveStockForm
                  api={api}
                  shop={shop}
                  product={p}
                  busy={busy}
                  run={run}
                  onDone={async () => {
                    setReceiving(null)
                    await onChanged()
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {matched.length > shown.length && (
        <p className="hint" style={{ marginTop: 8 }}>
          Showing {shown.length} of {matched.length}. Search to narrow it, or download the
          full catalogue below.
        </p>
      )}
    </>
  )
}

/**
 * Receive stock for one product the shop already sells — the single-item case
 * the phone call actually produces ("we got 40 more crates in").
 *
 * The lot inherits the product's current shelf price rather than asking for one:
 * this form receives stock, it does not re-price the shelf, and quietly changing
 * what a shop charges because a support call touched the product would be the
 * worst possible side effect.
 */
function ReceiveStockForm({
  api,
  shop,
  product,
  busy,
  run,
  onDone,
}: {
  api: Api
  shop: ShopRow
  product: ShopProduct
  busy: string | null
  run: Run
  onDone: () => Promise<void>
}) {
  const [qty, setQty] = useState('')
  const [cost, setCost] = useState(String(product.costPrice || ''))
  const [expiry, setExpiry] = useState('')
  const packs = (product.unitsPerPack ?? 0) > 1
  const [unit, setUnit] = useState<'piece' | 'pack'>('piece')
  const id = `receive-${product.id}`

  return (
    <form
      className="stock-form"
      onSubmit={(e) => {
        e.preventDefault()
        void run(id, async () => {
          await api.receiveShopStock(shop.id, {
            lines: [
              {
                productId: product.id,
                stock: Number(qty),
                unit,
                // Per piece, or per pack when receiving packs — the server
                // divides it back down using the product's pack size.
                costPrice: Number(cost) || 0,
                sellingPrice: product.sellingPrice,
                expiryDate: expiry ? toDdMmYyyy(expiry) : undefined,
              },
            ],
          })
          await onDone()
        })
      }}
    >
      <label className="field">
        <span>Quantity</span>
        <input
          className="input"
          type="number"
          min="1"
          step="1"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          required
          autoFocus
        />
      </label>
      {packs && (
        <label className="field">
          <span>Unit</span>
          <select
            className="input"
            value={unit}
            onChange={(e) => setUnit(e.target.value === 'pack' ? 'pack' : 'piece')}
          >
            <option value="piece">Pieces</option>
            <option value="pack">
              {product.packLabel ?? 'Packs'} of {product.unitsPerPack}
            </option>
          </select>
        </label>
      )}
      <label className="field">
        <span>Cost each (GHS)</span>
        <input
          className="input"
          type="number"
          min="0"
          step="0.01"
          value={cost}
          onChange={(e) => setCost(e.target.value)}
        />
      </label>
      <label className="field">
        <span>Expiry (optional)</span>
        <input
          className="input"
          type="date"
          value={expiry}
          onChange={(e) => setExpiry(e.target.value)}
        />
      </label>
      <div className="form-actions">
        <Button type="submit" size="sm" variant="primary" busy={busy === id} busyLabel="Adding…">
          Add {qty || '0'} to stock
        </Button>
        <span className="hint">Sells at {money(product.sellingPrice)} — unchanged.</span>
      </div>
    </form>
  )
}

/* ============================================================== downloads == */

interface Dataset {
  type: ExportType
  label: string
  hint: string
  /** Range-bound datasets get the date fields; snapshots are "as of now". */
  ranged: boolean
  /** Products is CSV-only: it's a spreadsheet to edit, not a document to read. */
  csvOnly?: boolean
  /** Shown as a notice beside the button — a trap in what happens next. */
  warning?: string
}

const DATASETS: Dataset[] = [
  {
    type: 'products',
    label: 'Products & stock',
    hint: 'The whole catalogue with on-hand quantities, in the products import’s own columns — fix names, prices or categories in a spreadsheet and send it back.',
    ranged: false,
    csvOnly: true,
    // The one genuinely surprising thing about the round trip, said where the
    // file is handed over rather than after a shop's stock has doubled.
    warning:
      'Clear the Stock Quantity column before re-importing. On a product that already exists those units are ADDED to the shelf, so sending the sheet back untouched doubles this shop’s stock.',
  },
  {
    type: 'sales',
    label: 'Sales (line items)',
    hint: 'Every receipt in the range, with tax split out.',
    ranged: true,
  },
  {
    type: 'profit',
    label: 'Profit',
    hint: 'Revenue against the actual cost of the units sold.',
    ranged: true,
  },
  {
    type: 'tax',
    label: 'Tax (GRA)',
    hint: 'VAT and levies for the range, as filed.',
    ranged: true,
  },
  {
    type: 'wastage',
    label: 'Wastage',
    hint: 'Expired and written-off stock, as it stands now.',
    ranged: false,
  },
  {
    type: 'deadstock',
    label: 'Dead stock',
    hint: 'What hasn’t moved in the range — the money sitting on the shelf.',
    ranged: true,
  },
]

function Downloads({
  api,
  shop,
  busy,
  run,
}: {
  api: Api
  shop: ShopRow
  busy: string | null
  run: Run
}) {
  const [type, setType] = useState<ExportType>('products')
  const [format, setFormat] = useState<ExportFormat>('csv')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const dataset = DATASETS.find((d) => d.type === type)!
  const effectiveFormat: ExportFormat = dataset.csvOnly ? 'csv' : format

  return (
    <>
      <div className="form-grid inset">
        <label className="field">
          <span>What to download</span>
          <select
            className="input"
            value={type}
            onChange={(e) => setType(e.target.value as ExportType)}
          >
            {DATASETS.map((d) => (
              <option key={d.type} value={d.type}>
                {d.label}
              </option>
            ))}
          </select>
          <span className="hint">{dataset.hint}</span>
        </label>

        {!dataset.csvOnly && (
          <label className="field">
            <span>Format</span>
            <select
              className="input"
              value={format}
              onChange={(e) => setFormat(e.target.value === 'pdf' ? 'pdf' : 'csv')}
            >
              <option value="csv">CSV (spreadsheet)</option>
              <option value="pdf">PDF (to send on)</option>
            </select>
          </label>
        )}

        {dataset.ranged && (
          <>
            <label className="field">
              <span>From</span>
              <input
                className="input"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label className="field">
              <span>To</span>
              <input
                className="input"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
              <span className="hint">Leave both blank for the last 30 days.</span>
            </label>
          </>
        )}
      </div>

      {dataset.warning && <Notice>{dataset.warning}</Notice>}

      <div className="form-actions" style={{ marginTop: 4 }}>
        <Button
          variant="primary"
          busy={busy === 'download'}
          busyLabel="Preparing…"
          onClick={() =>
            void run('download', async () => {
              const file = await api.shopExport(shop.id, {
                type,
                format: effectiveFormat,
                from: dataset.ranged && from ? from : undefined,
                to: dataset.ranged && to ? to : undefined,
              })
              downloadBlob(file.filename, file.blob)
            })
          }
        >
          <Icon name="download" size={14} />
          Download {dataset.label.toLowerCase()}
        </Button>
      </div>

      <p className="hint" style={{ marginTop: 10 }}>
        These are this shop’s own numbers, read from the cloud copy — so they cover
        everything their tills have synced, and nothing a till is still holding offline.
        Every download is recorded in the audit log against your name.
      </p>
    </>
  )
}

/* =========================================================== add inventory == */

type AddMode = 'sheet' | 'single'

function AddInventory({
  api,
  shop,
  hasProducts,
  categories,
  busy,
  run,
  onChanged,
}: {
  api: Api
  shop: ShopRow
  hasProducts: boolean
  categories: string[]
  busy: string | null
  run: Run
  onChanged: () => Promise<void>
}) {
  const [mode, setMode] = useState<AddMode>('sheet')

  return (
    <>
      <div className="segmented" role="group" aria-label="How to add inventory">
        <button type="button" aria-pressed={mode === 'sheet'} onClick={() => setMode('sheet')}>
          From a spreadsheet
        </button>
        <button type="button" aria-pressed={mode === 'single'} onClick={() => setMode('single')}>
          One product
        </button>
      </div>

      <p className="hint" style={{ margin: '10px 0 14px' }}>
        This writes to the shop’s books in the cloud; their tills pick it up on their next
        sync, within about a minute of being online. In the shop’s own stock log the change
        is recorded against the owner — the fleet audit log is where your name against it
        lives.
      </p>

      {mode === 'sheet' ? (
        <SheetImport
          api={api}
          shop={shop}
          hasProducts={hasProducts}
          busy={busy}
          run={run}
          onChanged={onChanged}
        />
      ) : (
        <SingleProduct
          api={api}
          shop={shop}
          categories={categories}
          busy={busy}
          run={run}
          onChanged={onChanged}
        />
      )}
    </>
  )
}

/* -------------------------------------------------------------- sheet mode */

type SheetKind = 'products' | 'batches'

const TEMPLATES: Record<SheetKind, string[]> = {
  // Only "Product Name" is required; the rest fall back to sensible defaults
  // row by row, which is what lets a supplier's own sheet import at all.
  products: [
    'Product Name',
    'Category',
    'Barcode',
    'Cost Price',
    'Selling Price',
    'Stock Quantity',
    'Expiry Date',
    'Reorder Level',
    'Pack Name',
    'Units Per Pack',
  ],
  batches: ['Product Name', 'Quantity Received', 'Batch Cost', 'Expiry Date', 'Supplier', 'Unit'],
}

function SheetImport({
  api,
  shop,
  hasProducts,
  busy,
  run,
  onChanged,
}: {
  api: Api
  shop: ShopRow
  hasProducts: boolean
  busy: string | null
  run: Run
  onChanged: () => Promise<void>
}) {
  const [kind, setKind] = useState<SheetKind>('products')
  const [csv, setCsv] = useState('')
  const [filename, setFilename] = useState<string | null>(null)
  const [result, setResult] = useState<(ImportResult & { kind: SheetKind }) | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const rows = csv.trim() ? csv.trim().split(/\r?\n/).length - 1 : 0

  return (
    <>
      <div className="form-grid inset">
        <label className="field">
          <span>What the sheet contains</span>
          <select
            className="input"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value === 'batches' ? 'batches' : 'products')
              setResult(null)
            }}
          >
            <option value="products">Products — create or update the catalogue</option>
            <option value="batches">Stock received — add units to existing products</option>
          </select>
          <span className="hint">
            {kind === 'products'
              ? 'Matched by barcode, then by name: a row that matches updates that product, a row that doesn’t creates one. Stock Quantity is opening stock on a new product and units RECEIVED on one that already exists — leave it blank to edit prices and names without moving stock.'
              : 'Every row must name a product this shop already has. Batch Cost is the total for the line, not the price of one unit.'}
          </span>
        </label>
      </div>

      {kind === 'batches' && !hasProducts && (
        <Notice>
          This shop has no products yet, so there is nothing for stock rows to land on.
          Import the catalogue first.
        </Notice>
      )}

      <div className="form-actions" style={{ marginBottom: 10 }}>
        <Button size="sm" onClick={() => fileRef.current?.click()}>
          <Icon name="upload" size={14} />
          Choose a CSV
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => downloadCsv(`${kind}-template.csv`, TEMPLATES[kind].join(',') + '\r\n')}
        >
          Download the template
        </Button>
        {filename && <span className="hint">{filename}</span>}
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (!file) return
            setFilename(file.name)
            setResult(null)
            void file.text().then(setCsv)
            // Clear the input so re-picking the same file still fires a change.
            e.target.value = ''
          }}
        />
      </div>

      <label className="field">
        <span>…or paste the rows</span>
        <textarea
          className="input"
          rows={5}
          value={csv}
          spellCheck={false}
          placeholder={TEMPLATES[kind].join(',')}
          onChange={(e) => {
            setCsv(e.target.value)
            setFilename(null)
            setResult(null)
          }}
        />
        <span className="hint">
          {rows > 0
            ? `${rows} data ${rows === 1 ? 'row' : 'rows'} below the header.`
            : 'The first line must be the header row.'}
        </span>
      </label>

      <div className="form-actions">
        <Button
          variant="primary"
          disabled={!csv.trim()}
          busy={busy === 'import'}
          busyLabel="Importing…"
          onClick={() =>
            void run('import', async () => {
              const r =
                kind === 'products'
                  ? await api.importShopProducts(shop.id, csv)
                  : await api.importShopBatches(shop.id, csv)
              setResult({ ...r, kind })
              await onChanged()
            })
          }
        >
          Import into {shop.name}
        </Button>
      </div>

      {result && <ImportOutcome result={result} />}
    </>
  )
}

/**
 * What the import actually did — including, prominently, what it refused.
 *
 * The importer applies rows independently and reports the bad ones by line
 * number, so a 200-row sheet with four typos loads 196 items and names the four.
 * Hiding those behind a success count would leave the operator telling the shop
 * their list was loaded when part of it silently wasn't.
 */
function ImportOutcome({ result }: { result: ImportResult & { kind: SheetKind } }) {
  const created = result.imported
  const noun = result.kind === 'products' ? 'product' : 'stock row'
  return (
    <div className="import-result" data-failed={result.failed > 0 ? 'true' : undefined}>
      <div className="chip-row">
        {created > 0 && (
          <Chip tone="ok">
            {created} {created === 1 ? noun : `${noun}s`} added
          </Chip>
        )}
        {result.updated > 0 && <Chip tone="ok">{result.updated} updated</Chip>}
        {result.failed > 0 && <Chip tone="bad">{result.failed} rejected</Chip>}
        {created === 0 && result.updated === 0 && result.failed === 0 && (
          <Chip tone="idle">Nothing to import</Chip>
        )}
      </div>
      {result.errors.length > 0 && (
        <ul className="import-errors">
          {result.errors.map((e) => (
            <li key={e.row}>
              <span className="mono">Line {e.row}</span> {e.message}
            </li>
          ))}
        </ul>
      )}
      {result.failed > 0 && (
        <p className="hint">
          Only the listed rows were skipped — everything else is in. Fix those lines and
          import the sheet again; rows that already landed will be matched and updated, not
          duplicated.
        </p>
      )}
    </div>
  )
}

/* ------------------------------------------------------------- single mode */

function SingleProduct({
  api,
  shop,
  categories,
  busy,
  run,
  onChanged,
}: {
  api: Api
  shop: ShopRow
  categories: string[]
  busy: string | null
  run: Run
  onChanged: () => Promise<void>
}) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [costPrice, setCostPrice] = useState('')
  const [sellingPrice, setSellingPrice] = useState('')
  const [openingStock, setOpeningStock] = useState('')
  const [expiry, setExpiry] = useState('')
  const [barcode, setBarcode] = useState('')
  const [added, setAdded] = useState<string | null>(null)

  const belowCost =
    Number(sellingPrice) > 0 && Number(costPrice) > 0 && Number(sellingPrice) < Number(costPrice)

  return (
    <form
      className="form-grid inset"
      onSubmit={(e) => {
        e.preventDefault()
        void run('create', async () => {
          const created = await api.createShopProduct(shop.id, {
            name: name.trim(),
            category: category.trim() || undefined,
            costPrice: Number(costPrice) || 0,
            sellingPrice: Number(sellingPrice) || 0,
            openingStock: Number(openingStock) || 0,
            expiryDate: expiry ? toDdMmYyyy(expiry) : undefined,
            barcode: barcode.trim() || null,
          })
          setAdded(created.name)
          setName('')
          setCategory('')
          setCostPrice('')
          setSellingPrice('')
          setOpeningStock('')
          setExpiry('')
          setBarcode('')
          await onChanged()
        })
      }}
    >
      <label className="field">
        <span>Product name</span>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </label>
      <label className="field">
        <span>Category</span>
        <input
          className="input"
          list={`categories-${shop.id}`}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Drinks"
        />
        <datalist id={`categories-${shop.id}`}>
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </label>
      <label className="field">
        <span>Cost each (GHS)</span>
        <input
          className="input"
          type="number"
          min="0"
          step="0.01"
          value={costPrice}
          onChange={(e) => setCostPrice(e.target.value)}
        />
      </label>
      <label className="field">
        <span>Sells for (GHS)</span>
        <input
          className="input"
          type="number"
          min="0"
          step="0.01"
          value={sellingPrice}
          onChange={(e) => setSellingPrice(e.target.value)}
          required
        />
        {/* A warning, never a block: clearance and expiring stock are real
            reasons to sell under cost, and the server accepts them too. */}
        {belowCost && <span className="hint">That’s below cost — confirm with the shop.</span>}
      </label>
      <label className="field">
        <span>Opening stock</span>
        <input
          className="input"
          type="number"
          min="0"
          step="1"
          value={openingStock}
          onChange={(e) => setOpeningStock(e.target.value)}
          placeholder="0"
        />
      </label>
      <label className="field">
        <span>Expiry (optional)</span>
        <input
          className="input"
          type="date"
          value={expiry}
          onChange={(e) => setExpiry(e.target.value)}
        />
        <span className="hint">Blank means this stock doesn’t carry a date.</span>
      </label>
      <label className="field">
        <span>Barcode (optional)</span>
        <input
          className="input mono"
          value={barcode}
          onChange={(e) => setBarcode(e.target.value)}
        />
      </label>

      <div className="form-actions">
        <Button type="submit" variant="primary" busy={busy === 'create'} busyLabel="Adding…">
          Add to {shop.name}
        </Button>
        {added && (
          <span className="hint">
            <Icon name="check" size={13} /> Added “{added}”.
          </span>
        )}
      </div>
    </form>
  )
}
