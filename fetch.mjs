// Zero-dependency BOM gold price scraper
// Fetches industrial gold and gold coin prices from bom.mu and outputs JSON

import { readFileSync } from 'fs'
import tls from 'tls'

const GOLD_URL = 'https://www.bom.mu/industrial-gold'
const COINS_URL = 'https://www.bom.mu/gold-coins'

// bom.mu serves its certificate without the Sectigo intermediate. Browsers
// fetch it on the fly, Node does not, so trust the bundled copy explicitly.
tls.setDefaultCACertificates([
  ...tls.getCACertificates('default'),
  readFileSync(new URL('./certs/sectigo-public-server-authentication-ca-ev-r36.pem', import.meta.url), 'utf8'),
])

const MONTHS = {
  january: '01', february: '02', march: '03', april: '04',
  may: '05', june: '06', july: '07', august: '08',
  september: '09', october: '10', november: '11', december: '12',
}

function parseDate(raw) {
  // "20 March 2026" → "2026-03-20"
  const trimmed = raw.trim()
  if (!trimmed) return null

  const parts = trimmed.split(/\s+/)
  if (parts.length !== 3) return null

  const [dayStr, monthStr, yearStr] = parts
  const month = MONTHS[monthStr.toLowerCase()]
  if (!month) return null

  return `${yearStr}-${month}-${dayStr.padStart(2, '0')}`
}

function extractView(html, viewId) {
  // Scope parsing to the price view: the sidebar has its own dates (e.g. the
  // Key Rate decision date) and tables (exchange rates)
  const start = html.indexOf(`view-id-${viewId}`)
  if (start === -1) return null
  const end = html.indexOf('</section>', start)
  return html.slice(start, end === -1 ? undefined : end)
}

function extractDate(viewHtml) {
  // The view header holds the publication date, e.g. "20 March 2026"
  const header = viewHtml.match(/<div class="view-header">([\s\S]*?)<\/div>/i)
  if (!header) return null
  const text = header[1].replace(/<[^>]*>/g, ' ')
  const match = text.match(/\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/i)
  return match ? match[0] : null
}

function extractTable(html) {
  const rows = []
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi

  let match
  while ((match = rowRegex.exec(html)) !== null) {
    const cells = []
    const rowHtml = match[1]
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi
    let cellMatch
    while ((cellMatch = cellRe.exec(rowHtml)) !== null) {
      const text = cellMatch[1]
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .trim()
      cells.push(text)
    }
    if (cells.length >= 3) {
      rows.push(cells)
    }
  }

  return rows
}

function extractFirstTable(html) {
  // Extract only the first <table>...</table> block
  const tableMatch = html.match(/<table[^>]*>([\s\S]*?)<\/table>/i)
  if (!tableMatch) return []
  return extractTable(tableMatch[0])
}

function parseNum(str) {
  return parseFloat(str.replace(/,/g, ''))
}

function round2(n) {
  return Math.round(n * 100) / 100
}

async function fetchPage(url, dateFilter, date) {
  const target = new URL(url)
  if (date) {
    // BOM date filter expects DD-MM-YYYY
    const [y, m, d] = date.split('-')
    target.searchParams.set(`${dateFilter}[value][date]`, `${d}-${m}-${y}`)
  }
  console.log(`Fetching ${target}...`)
  const response = await fetch(target)
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  return response.text()
}

// Without a date, fetches the latest published prices. With a date
// (YYYY-MM-DD), fetches that day and returns null if BOM published nothing.
async function fetchGoldPrices(requestedDate) {
  const html = await fetchPage(GOLD_URL, 'field_transaction_date_goldind_value', requestedDate)

  const view = extractView(html, 'industrial_gold')
  if (!view) throw new Error('Could not find price view on industrial gold page')

  const dateRaw = extractDate(view)
  if (!dateRaw && requestedDate) {
    console.log(`No gold prices published on ${requestedDate}. Skipping.`)
    return null
  }
  if (!dateRaw) throw new Error('Could not find date on industrial gold page')
  const date = parseDate(dateRaw)
  if (!date) throw new Error(`Could not parse date: ${dateRaw}`)
  if (requestedDate && date !== requestedDate) throw new Error(`Asked for ${requestedDate}, got ${date}`)

  const rows = extractFirstTable(view)
  console.log(`Found ${rows.length} table rows on industrial gold page`)

  // Filter to data rows (skip headers). Data rows have 4 cells with numeric price.
  // Columns: Form | Weight (Oz) | Weight (Gm) | Price (Rs) / Gm
  const dataRows = rows.filter(row => {
    if (row.length < 4) return false
    const price = parseNum(row[3])
    return !isNaN(price) && price > 0
  })

  if (dataRows.length === 0) {
    console.log('No gold price data found (possibly a holiday). Skipping.')
    return null
  }

  const forms = dataRows.map(row => ({
    form: row[0].trim(),
    weight_oz: parseNum(row[1]),
    weight_gm: parseNum(row[2]),
    price_per_gm: parseNum(row[3]),
  }))

  // Use Grains price as the 24K reference (first Grains row)
  const grainsRow = forms.find(f => f.form.toLowerCase() === 'grains')
  const price24k = grainsRow ? grainsRow.price_per_gm : forms[0].price_per_gm

  const legacy = dataRows.map(row => ({
    date: dateRaw,
    form: row[0].trim(),
    weight_oz: row[1],
    weight_gm: row[2],
    price_per_gm: row[3],
  }))

  const clean = {
    date,
    price_per_gram: price24k,
    karats: {
      '24k': price24k,
      '22k': round2(price24k * 22 / 24),
      '21k': round2(price24k * 21 / 24),
      '18k': round2(price24k * 18 / 24),
    },
    forms,
  }

  return { date, dateRaw, clean, legacy }
}

async function fetchCoinPrices(requestedDate) {
  const html = await fetchPage(COINS_URL, 'field_transaction_date_goldcoins_value', requestedDate)

  const view = extractView(html, 'gold_coins')
  if (!view) throw new Error('Could not find price view on gold coins page')

  const dateRaw = extractDate(view)
  if (!dateRaw && requestedDate) {
    console.log(`No coin prices published on ${requestedDate}. Skipping.`)
    return null
  }
  if (!dateRaw) throw new Error('Could not find date on gold coins page')
  const date = parseDate(dateRaw)
  if (!date) throw new Error(`Could not parse date: ${dateRaw}`)
  if (requestedDate && date !== requestedDate) throw new Error(`Asked for ${requestedDate}, got ${date}`)

  const rows = extractFirstTable(view)
  console.log(`Found ${rows.length} table rows on gold coins page`)

  // Columns: Denomination | Weight (gm) | Diameter (mm) | Price (Rs)
  const dataRows = rows.filter(row => {
    const price = parseNum(row[row.length - 1])
    return !isNaN(price) && price > 0
  })

  if (dataRows.length === 0) {
    console.log('No coin price data found. Skipping coins.')
    return null
  }

  const denominations = dataRows.map(row => ({
    denomination: parseNum(row[0]),
    weight_gm: parseNum(row[1]),
    diameter_mm: parseNum(row[2]),
    price: parseNum(row[3]),
  }))

  return { date, clean: { date, denominations } }
}

function datesBetween(from, to) {
  const dates = []
  for (let d = new Date(from); d <= new Date(to); d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10))
  }
  return dates
}

// Insert or replace the entry for its date, keeping newest first
function upsert(list, entry) {
  return [entry, ...list.filter(e => e.date !== entry.date)]
    .sort((a, b) => b.date.localeCompare(a.date))
}

async function main() {
  const fs = await import('fs')

  fs.mkdirSync('./data/history', { recursive: true })

  // Optional date range to backfill missed days: node fetch.mjs FROM [TO]
  const today = new Date().toISOString().slice(0, 10)
  const [from, to = today] = process.argv.slice(2)
  for (const arg of [from, to]) {
    if (arg && !/^\d{4}-\d{2}-\d{2}$/.test(arg)) throw new Error(`Invalid date "${arg}", expected YYYY-MM-DD`)
  }

  // Read existing data
  let existingPrices = []
  let existingCoins = []
  try { existingPrices = JSON.parse(fs.readFileSync('./data/prices.json', 'utf8')) } catch {}
  try { existingCoins = JSON.parse(fs.readFileSync('./data/coins.json', 'utf8')) } catch {}

  if (from) {
    for (const date of datesBetween(from, to)) {
      const gold = await fetchGoldPrices(date)
      if (gold) {
        existingPrices = upsert(existingPrices, gold.clean)
        fs.writeFileSync(`./data/history/${date}.json`, JSON.stringify(gold.legacy))
      }
      const coins = await fetchCoinPrices(date)
      if (coins) existingCoins = upsert(existingCoins, coins.clean)
    }
    fs.writeFileSync('./data/prices.json', JSON.stringify(existingPrices, null, 2))
    fs.writeFileSync('./data/coins.json', JSON.stringify(existingCoins, null, 2))
    console.log(`Backfilled ${from} to ${to}: prices.json (${existingPrices.length} entries), coins.json (${existingCoins.length} entries)`)
  } else {
    const gold = await fetchGoldPrices()
    if (!gold) {
      console.log('No gold data available today. Exiting.')
      return
    }

    const coins = await fetchCoinPrices()

    existingPrices = upsert(existingPrices, gold.clean)
    if (coins) existingCoins = upsert(existingCoins, coins.clean)

    fs.writeFileSync('./data/prices.json', JSON.stringify(existingPrices, null, 2))
    fs.writeFileSync('./data/latest.json', JSON.stringify(gold.legacy))
    fs.writeFileSync(`./data/history/${gold.date}.json`, JSON.stringify(gold.legacy))

    if (coins) {
      fs.writeFileSync('./data/coins.json', JSON.stringify(existingCoins, null, 2))
    }

    console.log(`Written prices.json (${existingPrices.length} entries)`)
    console.log(`Written latest.json and history/${gold.date}.json`)
    if (coins) console.log(`Written coins.json (${existingCoins.length} entries)`)
  }

  // Generate derived views
  const { generateViews } = await import('./views.mjs')
  generateViews(existingPrices)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
