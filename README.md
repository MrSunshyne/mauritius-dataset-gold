# Mauritius Gold Price Dataset

Automatically updated dataset of Mauritius gold prices, scraped daily from the [Bank of Mauritius](https://www.bom.mu/industrial-gold) website.

Zero dependencies — uses Node.js built-in `fetch` to scrape the BOM gold price tables.

## Datasets

### [`data/prices.json`](data/prices.json) (recommended)

Clean format with ISO dates and numeric values, sorted newest first. Includes derived karat prices and all BOM form/weight variants.

```json
[
  {
    "date": "2026-03-20",
    "price_per_gram": 7421.58,
    "karats": {
      "24k": 7421.58,
      "22k": 6803.12,
      "21k": 6493.88,
      "18k": 5566.19
    },
    "forms": [
      { "form": "Grains", "weight_oz": 0.50, "weight_gm": 15.55, "price_per_gm": 7421.58 },
      { "form": "Bar", "weight_oz": 3.22, "weight_gm": 100.00, "price_per_gm": 7417.87 }
    ]
  }
]
```

**Raw URL:**
```
https://raw.githubusercontent.com/MrSunshyne/mauritius-dataset-gold/main/data/prices.json
```

### [`data/coins.json`](data/coins.json)

Dodo Gold Coin prices (22K) by denomination, scraped from the [BOM Gold Coins](https://www.bom.mu/gold-coins) page.

```json
[
  {
    "date": "2026-03-20",
    "denominations": [
      { "denomination": 100, "weight_gm": 3.41, "diameter_mm": 16.50, "price": 30435.00 },
      { "denomination": 250, "weight_gm": 8.51, "diameter_mm": 22.00, "price": 72835.00 },
      { "denomination": 500, "weight_gm": 17.03, "diameter_mm": 27.00, "price": 142665.00 },
      { "denomination": 1000, "weight_gm": 34.05, "diameter_mm": 32.69, "price": 285325.00 }
    ]
  }
]
```

**Raw URL:**
```
https://raw.githubusercontent.com/MrSunshyne/mauritius-dataset-gold/main/data/coins.json
```

### [`data/current.json`](data/current.json)

Just the latest price entry. Lightweight for apps that only need today's price.

```
https://raw.githubusercontent.com/MrSunshyne/mauritius-dataset-gold/main/data/current.json
```

### [`data/timeseries.json`](data/timeseries.json)

Flat arrays optimized for charting (oldest-first). ~271 KB vs 4.3 MB for the full dataset.

```json
{
  "dates": ["2004-01-27", "2004-01-28", ...],
  "price_per_gram": [364.47, 365.12, ...],
  "karats": {
    "24k": [364.47, ...],
    "22k": [334.10, ...],
    "21k": [318.91, ...],
    "18k": [273.35, ...]
  }
}
```

```
https://raw.githubusercontent.com/MrSunshyne/mauritius-dataset-gold/main/data/timeseries.json
```

### [`data/index.json`](data/index.json)

Metadata and per-year summary statistics (entries, open, close, min, max, avg, change %).

```
https://raw.githubusercontent.com/MrSunshyne/mauritius-dataset-gold/main/data/index.json
```

### [`data/yearly/{year}.json`](data/yearly/)

Full price entries grouped by year (~200 KB each). Load only the year you need.

```
https://raw.githubusercontent.com/MrSunshyne/mauritius-dataset-gold/main/data/yearly/2024.json
```

### [`data/latest.json`](data/latest.json)

Legacy format preserving the original BOM strings as-is.

### `data/history/`

Daily snapshots in `YYYY-MM-DD.json` format.

## Usage

```js
// Get just today's price
const res = await fetch('https://raw.githubusercontent.com/MrSunshyne/mauritius-dataset-gold/main/data/current.json')
const current = await res.json()
console.log(`Gold: Rs ${current.price_per_gram}/gram (24K)`)
console.log(`22K: Rs ${current.karats['22k']}/gram`)

// Build a chart
const ts = await fetch('https://raw.githubusercontent.com/MrSunshyne/mauritius-dataset-gold/main/data/timeseries.json').then(r => r.json())
// ts.dates and ts.price_per_gram are ready to plot

// Get yearly summary stats
const index = await fetch('https://raw.githubusercontent.com/MrSunshyne/mauritius-dataset-gold/main/data/index.json').then(r => r.json())
console.log(index.years['2024']) // { entries, open, close, min, max, avg, change_pct }
```

## How it works

1. Fetches the BOM industrial gold and gold coins HTML pages daily
2. Parses the price tables using regex (no browser needed)
3. Derives karat prices (22K, 21K, 18K) from the 24K reference using the standard formula
4. Outputs JSON files and a dated snapshot
5. GitHub Actions commits and pushes if the data changed

## Running locally

```bash
node fetch.mjs
```

## Disclaimer

This project is not affiliated with the Bank of Mauritius. Data is automatically fetched from publicly available pages at most once per day. Data is made available under fair use for informational purposes.
