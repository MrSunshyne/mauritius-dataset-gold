// Standalone script to regenerate all views from existing prices.json, coins.json and international.json
// Usage: node generate-views.mjs

import { readFileSync } from 'fs'
import { generateViews } from './views.mjs'

const prices = JSON.parse(readFileSync('./data/prices.json', 'utf8'))
const coins = JSON.parse(readFileSync('./data/coins.json', 'utf8'))
const international = JSON.parse(readFileSync('./data/international.json', 'utf8'))
console.log(`Loaded ${prices.length} entries from prices.json, ${coins.length} from coins.json and ${international.length} from international.json`)
generateViews(prices, coins, international)
