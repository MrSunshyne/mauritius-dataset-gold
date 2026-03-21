// Zero-dependency BOM gold price scraper
// Fetches industrial gold and gold coin prices from bom.mu and outputs JSON

const GOLD_URL = 'https://www.bom.mu/industrial-gold'
const COINS_URL = 'https://www.bom.mu/gold-coins'

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

function extractDate(html) {
  // Look for date in various BOM page formats
  const patterns = [
    /<span class="date-display-single"[^>]*>([^<]+)<\/span>/i,
    /datetime="[^"]*"[^>]*>([^<]+)</i,
    /(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/i,
  ]

  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match) return match[1].trim()
  }
  return null
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

async function fetchGoldPrices() {
  console.log(`Fetching ${GOLD_URL}...`)
  const response = await fetch(GOLD_URL)
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  const html = await response.text()

  const dateRaw = extractDate(html)
  if (!dateRaw) throw new Error('Could not find date on industrial gold page')
  const date = parseDate(dateRaw)
  if (!date) throw new Error(`Could not parse date: ${dateRaw}`)

  // Use first table only (page also has an exchange rates table)
  const rows = extractFirstTable(html)
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

async function fetchCoinPrices() {
  console.log(`Fetching ${COINS_URL}...`)
  const response = await fetch(COINS_URL)
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  const html = await response.text()

  const dateRaw = extractDate(html)
  if (!dateRaw) throw new Error('Could not find date on gold coins page')
  const date = parseDate(dateRaw)
  if (!date) throw new Error(`Could not parse date: ${dateRaw}`)

  // Extract only the first table (coins); second table is exchange rates
  const rows = extractFirstTable(html)
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

async function main() {
  const fs = await import('fs')

  fs.mkdirSync('./data/history', { recursive: true })

  const gold = await fetchGoldPrices()
  if (!gold) {
    console.log('No gold data available today. Exiting.')
    return
  }

  const coins = await fetchCoinPrices()

  // Read existing data
  let existingPrices = []
  let existingCoins = []
  try { existingPrices = JSON.parse(fs.readFileSync('./data/prices.json', 'utf8')) } catch {}
  try { existingCoins = JSON.parse(fs.readFileSync('./data/coins.json', 'utf8')) } catch {}

  // Deduplicate by date — only add if this date is new
  if (!existingPrices.some(e => e.date === gold.date)) {
    existingPrices.unshift(gold.clean)
  } else {
    // Update existing entry for today
    existingPrices = existingPrices.map(e => e.date === gold.date ? gold.clean : e)
  }
  existingPrices.sort((a, b) => b.date.localeCompare(a.date))

  if (coins) {
    if (!existingCoins.some(e => e.date === coins.date)) {
      existingCoins.unshift(coins.clean)
    } else {
      existingCoins = existingCoins.map(e => e.date === coins.date ? coins.clean : e)
    }
    existingCoins.sort((a, b) => b.date.localeCompare(a.date))
  }

  // Write outputs
  const today = new Date().toISOString().slice(0, 10)

  fs.writeFileSync('./data/prices.json', JSON.stringify(existingPrices, null, 2))
  fs.writeFileSync('./data/latest.json', JSON.stringify(gold.legacy))
  fs.writeFileSync(`./data/history/${today}.json`, JSON.stringify(gold.legacy))

  if (coins) {
    fs.writeFileSync('./data/coins.json', JSON.stringify(existingCoins, null, 2))
  }

  console.log(`Written prices.json (${existingPrices.length} entries)`)
  console.log(`Written latest.json and history/${today}.json`)
  if (coins) console.log(`Written coins.json (${existingCoins.length} entries)`)

  // Generate derived views
  const { generateViews } = await import('./views.mjs')
  generateViews(existingPrices)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
