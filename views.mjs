// Shared view generation logic
// Generates derived data views from prices.json:
//   data/current.json        — latest single entry
//   data/timeseries.json     — flat arrays for graphing
//   data/index.json          — metadata + per-year summary stats
//   data/yearly/{year}.json  — full entries grouped by year

import { writeFileSync, mkdirSync } from 'fs'

function round2(n) {
  return Math.round(n * 100) / 100
}

export function generateViews(prices) {
  mkdirSync('./data/yearly', { recursive: true })

  // 1. current.json — most recent entry
  if (prices.length > 0) {
    writeFileSync('./data/current.json', JSON.stringify(prices[0], null, 2))
  }

  // 2. timeseries.json — flat arrays optimized for charting
  //    Oldest-first for natural left-to-right graphing
  const reversed = [...prices].reverse()
  const timeseries = {
    dates: reversed.map(p => p.date),
    price_per_gram: reversed.map(p => p.price_per_gram),
    karats: {
      '24k': reversed.map(p => p.karats['24k']),
      '22k': reversed.map(p => p.karats['22k']),
      '21k': reversed.map(p => p.karats['21k']),
      '18k': reversed.map(p => p.karats['18k']),
    },
  }
  writeFileSync('./data/timeseries.json', JSON.stringify(timeseries))

  // 3. yearly/{year}.json + index stats
  const byYear = {}
  for (const entry of prices) {
    const year = entry.date.slice(0, 4)
    if (!byYear[year]) byYear[year] = []
    byYear[year].push(entry)
  }

  const yearStats = {}
  for (const [year, entries] of Object.entries(byYear)) {
    // Write yearly file (newest-first, same as prices.json)
    writeFileSync(`./data/yearly/${year}.json`, JSON.stringify(entries, null, 2))

    // Compute stats
    const pricesArr = entries.map(e => e.price_per_gram)
    const min = Math.min(...pricesArr)
    const max = Math.max(...pricesArr)
    const avg = round2(pricesArr.reduce((a, b) => a + b, 0) / pricesArr.length)
    const open = entries[entries.length - 1].price_per_gram // oldest in year
    const close = entries[0].price_per_gram // newest in year

    yearStats[year] = {
      entries: entries.length,
      first_date: entries[entries.length - 1].date,
      last_date: entries[0].date,
      open,
      close,
      min,
      max,
      avg,
      change_pct: round2((close - open) / open * 100),
    }
  }

  // 4. index.json — metadata + per-year stats
  const index = {
    total_entries: prices.length,
    first_date: prices.length > 0 ? prices[prices.length - 1].date : null,
    last_date: prices.length > 0 ? prices[0].date : null,
    generated: new Date().toISOString(),
    years: yearStats,
  }
  writeFileSync('./data/index.json', JSON.stringify(index, null, 2))

  // Summary
  const yearCount = Object.keys(byYear).length
  console.log(`Generated views: current.json, timeseries.json, index.json, ${yearCount} yearly files`)
}
