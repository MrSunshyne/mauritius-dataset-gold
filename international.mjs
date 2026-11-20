// International gold price and USD/MUR rate for each BOM price date, so the
// BOM price can be compared with the world price converted to rupees.
//
//   Gold:  COMEX gold futures (GC=F, front month) daily close from Yahoo Finance.
//          BOM publishes in the Mauritius morning, so each BOM date is matched
//          with the previous New York session's close.
//   Rate:  BOM consolidated indicative USD selling rate (TT/DD) for the same date.

import { existsSync, readFileSync, writeFileSync } from 'fs'

const COMEX_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/GC=F'
const FX_URL = 'https://www.bom.mu/markets/foreign-exchange/consolidated-indicative-exchange-rates'
const FILE = './data/international.json'

// Dates older than this without data are recorded as gaps instead of retried
const RETRY_DAYS = 7
// Ignore a previous close older than this (e.g. a gap in the futures data)
const MAX_CLOSE_AGE_DAYS = 5

function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function bomDate(date) {
  const [y, m, d] = date.split('-')
  return `${d}-${m}-${y}`
}

// Daily closes, oldest first, keyed by New York trading date
async function fetchComexCloses(from, to) {
  const url = new URL(COMEX_URL)
  url.searchParams.set('period1', String(Date.parse(`${from}T00:00:00Z`) / 1000))
  url.searchParams.set('period2', String(Date.parse(`${addDays(to, 1)}T00:00:00Z`) / 1000))
  url.searchParams.set('interval', '1d')
  console.log(`Fetching COMEX gold closes ${from} to ${to}...`)
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching COMEX gold closes`)
  const result = (await response.json()).chart?.result?.[0]
  if (!result) throw new Error('Unexpected COMEX gold response')

  const closes = []
  const quotes = result.indicators.quote[0].close
  result.timestamp.forEach((ts, i) => {
    if (quotes[i] == null) return
    const date = new Date(ts * 1000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
    closes.push({ date, close: Math.round(quotes[i] * 100) / 100 })
  })
  return closes
}

// USD selling rate by date; BOM returns a whole year in one page
async function fetchUsdSellRates(from, to) {
  const rates = new Map()
  for (let year = Number(from.slice(0, 4)); year <= Number(to.slice(0, 4)); year++) {
    const start = year === Number(from.slice(0, 4)) ? from : `${year}-01-01`
    const end = year === Number(to.slice(0, 4)) ? to : `${year}-12-31`
    const url = new URL(FX_URL)
    url.searchParams.set('field_country_tid', '39') // U.S.A.
    url.searchParams.set('field_transaction_date_value[value][date]', bomDate(start))
    url.searchParams.set('field_transaction_date_value_1[value][date]', bomDate(end))
    console.log(`Fetching USD rates ${start} to ${end}...`)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status} fetching USD rates`)
    const html = await response.text()

    // The table is rendered twice on the page; the Map keeps one rate per date
    const rowRe = /<tr[^>]*tblConso[^>]*>([\s\S]*?)<\/tr>/g
    let row
    while ((row = rowRe.exec(html)) !== null) {
      const sell = row[1].match(/views-field-php-3[^>]*>\s*([\d.,]+)\s*</)?.[1]
      const date = row[1].match(/content="(\d{4}-\d{2}-\d{2})T/)?.[1]
      if (sell && date) rates.set(date, parseFloat(sell.replace(/,/g, '')))
    }
  }
  return rates
}

// Adds an entry for every BOM price date not yet in international.json and
// returns the full list, newest first
export async function updateInternational(prices) {
  const existing = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : []
  const known = new Set(existing.map(e => e.date))
  const missing = prices.map(p => p.date).filter(date => !known.has(date)).sort()
  if (missing.length === 0) return existing

  const from = missing[0]
  const to = missing[missing.length - 1]
  const closes = await fetchComexCloses(addDays(from, -MAX_CLOSE_AGE_DAYS), to)
  const rates = await fetchUsdSellRates(from, to)
  const retryAfter = addDays(new Date().toISOString().slice(0, 10), -RETRY_DAYS)

  const added = []
  let c = 0
  for (const date of missing) {
    // Latest close from a session before the BOM date
    while (c + 1 < closes.length && closes[c + 1].date < date) c++
    const close = closes[c]?.date < date && closes[c].date >= addDays(date, -MAX_CLOSE_AGE_DAYS) ? closes[c] : null
    const rate = rates.get(date)
    if (close && rate) {
      added.push({ date, comex_date: close.date, comex_usd_per_oz: close.close, usd_mur: rate })
    }
    else if (date < retryAfter) {
      added.push({ date, comex_date: null, comex_usd_per_oz: null, usd_mur: null })
    }
  }

  const all = [...existing, ...added].sort((a, b) => b.date.localeCompare(a.date))
  writeFileSync(FILE, JSON.stringify(all, null, 2))
  console.log(`Written international.json (${added.length} new, ${all.length} entries)`)
  return all
}
