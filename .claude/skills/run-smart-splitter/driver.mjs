#!/usr/bin/env node
// Headless driver for the Smart Splitter web app.
// Reads one command per line on stdin, executes it against a headless
// Chromium page, prints results to stdout. Exits at EOF.
//
// Commands:
//   goto <url>              navigate (waits for network idle)
//   click <text>            click element whose visible text matches (first hit)
//   css <selector>          click by CSS selector
//   fill <selector>|<text>  fill an input ('|' separator — selectors may contain spaces)
//   press <key>             keyboard key (Enter, Tab, ...)
//   wait <ms>               sleep
//   text                    dump page innerText
//   eval <js>               run JS in the page, print JSON result
//   ss <name>               screenshot to shots/<name>.png (in this dir)
//   upload <selector>|<path>  set a file input's files ('|' separator)
//   waitfor <text>          wait until text appears on the page (60s timeout)
//
// Usage:  node driver.mjs <<'EOF'
//   goto http://localhost:5173
//   click Continue as guest
//   ss home
//   EOF

import { chromium } from 'playwright'
import { createInterface } from 'node:readline'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const shotsDir = join(here, 'shots')
mkdirSync(shotsDir, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 420, height: 800 } })
page.on('console', m => { if (m.type() === 'error') console.log(`[page-error] ${m.text()}`) })

const rl = createInterface({ input: process.stdin })
for await (const line of rl) {
  const cmd = line.trim()
  if (!cmd || cmd.startsWith('#')) continue
  const sp = cmd.indexOf(' ')
  const verb = sp === -1 ? cmd : cmd.slice(0, sp)
  const rest = sp === -1 ? '' : cmd.slice(sp + 1)
  try {
    switch (verb) {
      case 'goto':
        await page.goto(rest, { waitUntil: 'networkidle' })
        console.log(`[goto] ${rest} → ${await page.title()}`)
        break
      case 'click':
        await page.getByText(rest, { exact: false }).first().click()
        console.log(`[click] ${rest}`)
        break
      case 'css':
        await page.locator(rest).first().click()
        console.log(`[css-click] ${rest}`)
        break
      case 'fill': {
        const s2 = rest.indexOf('|')
        await page.locator(rest.slice(0, s2)).first().fill(rest.slice(s2 + 1))
        console.log(`[fill] ${rest}`)
        break
      }
      case 'press':
        await page.keyboard.press(rest)
        console.log(`[press] ${rest}`)
        break
      case 'wait':
        await new Promise(r => setTimeout(r, Number(rest)))
        break
      case 'text':
        console.log(await page.evaluate(() => document.body.innerText))
        break
      case 'eval':
        console.log(JSON.stringify(await page.evaluate(rest)))
        break
      case 'upload': {
        const s2 = rest.indexOf('|')
        await page.locator(rest.slice(0, s2)).first().setInputFiles(rest.slice(s2 + 1))
        console.log(`[upload] ${rest}`)
        break
      }
      case 'waitfor':
        await page.getByText(rest, { exact: false }).first().waitFor({ timeout: 60000 })
        console.log(`[waitfor] ${rest}`)
        break
      case 'ss': {
        const p = join(shotsDir, `${rest}.png`)
        await page.screenshot({ path: p })
        console.log(`[ss] ${p}`)
        break
      }
      default:
        console.log(`[?] unknown command: ${verb}`)
    }
  } catch (e) {
    console.log(`[error] ${verb}: ${e.message.split('\n')[0]}`)
  }
}
await browser.close()
