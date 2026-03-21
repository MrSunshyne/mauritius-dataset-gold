// Standalone script to regenerate all views from existing prices.json
// Usage: node generate-views.mjs

import { readFileSync } from 'fs'
import { generateViews } from './views.mjs'

const prices = JSON.parse(readFileSync('./data/prices.json', 'utf8'))
console.log(`Loaded ${prices.length} entries from prices.json`)
generateViews(prices)
