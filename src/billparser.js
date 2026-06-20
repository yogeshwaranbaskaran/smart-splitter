import { GoogleGenerativeAI } from '@google/generative-ai'

const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY)

export async function parseBill(imageFile) {
  const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite' })
  const imageData = await fileToBase64(imageFile)

  const prompt = `Look at this bill/receipt image. Return ONLY this JSON, no markdown, no explanation.

{
  "items": [
    {
      "name": "english name",
      "quantity": 1,
      "line_amount": 100,
      "tax_rate": 8,
      "tax_included": false
    }
  ],
  "tax_type": "added",
  "grand_total": 1587
}

Rules:
- name: translate to English
- quantity: number of units bought. If the bill shows "3x299", quantity is 3
- line_amount: the amount printed on the bill for that whole line, EXACTLY as shown. Do not add or remove tax — copy the printed number.
- tax_rate: the tax percentage that applies to this item as a number (e.g. 8, 10, 5, 12, 18). If tax is shown only as a total at the bottom, infer the rate for each item; if you cannot tell, use the bill's main rate. If there is genuinely no tax, use 0.
- tax_included: true if the printed line_amount already contains tax, false if tax is added separately (usually summarised at the bottom)
- tax_type: the overall style of the whole bill — "included" if item prices already contain tax, "added" if tax is a separate charge added on top, "none" if there is no tax at all
- grand_total: the final total actually paid, exactly as printed

Tax styles vary by country — infer from the receipt:
- Japan: items marked * = 8% added on top; 内 = tax already included; bags/non-food = 10% added
- India (GST): CGST/SGST/IGST listed at the bottom and added on top; common rates 5/12/18%
- If the item prices already add up (roughly) to the grand total, tax is "included"`

  const result = await model.generateContent([
    prompt,
    { inlineData: { mimeType: imageFile.type, data: imageData } }
  ])

  const text = result.response.text()
  const cleaned = text.replace(/```json|```/g, '').trim()
  const parsed = JSON.parse(cleaned)

  return processBill(parsed)
}

const round2 = n => Math.round(n * 100) / 100

// Given a printed line amount + tax rate + mode, split it into base / tax / final.
// "Printed" is whatever is on the bill: the pre-tax amount (tax added) or the
// tax-inclusive amount (tax included). final = the after-tax price we charge/share.
export function deriveItem(it) {
  // keep the raw strings for the editable fields so the user can type freely
  const printedRaw = it.line_amount ?? it.printed ?? ''
  const rateRaw = it.tax_rate ?? 0
  const printed = parseFloat(printedRaw) || 0
  const rate = parseFloat(rateRaw) || 0
  const included = !!it.tax_included
  let base, tax, final
  if (rate <= 0) {
    base = printed; tax = 0; final = printed
  } else if (included) {
    final = printed
    tax = round2(printed * rate / (100 + rate))
    base = round2(printed - tax)
  } else {
    base = printed
    tax = round2(printed * rate / 100)
    final = round2(printed + tax)
  }
  return {
    name: it.name,
    quantity: it.quantity ?? 1,
    printed: printedRaw,     // editable amount shown on the review page (matches the bill)
    tax_rate: rateRaw,       // editable
    tax_included: included,
    base, tax, final,        // derived numbers
  }
}

function processBill({ items, tax_type, grand_total }) {
  if (!items || items.length === 0) return { items: [], taxType: 'none' }

  const processed = items.map(deriveItem)

  // The printed grand total is the source of truth. Per-item tax rounding makes the
  // sum drift a unit or two; snap that residue onto the largest item's TAX (not its
  // base — bases must keep matching the bill so the user can verify them). Only when
  // the gap is small; a big gap means the AI misread the total, so we trust the items.
  if (grand_total > 0) {
    const sum = processed.reduce((s, i) => s + i.final, 0)
    const gap = round2(grand_total - sum)
    const tolerance = Math.max(6, grand_total * 0.1)
    if (gap !== 0 && Math.abs(gap) <= tolerance) {
      let idx = 0
      processed.forEach((it, i) => { if (it.final > processed[idx].final) idx = i })
      processed[idx].tax = round2(processed[idx].tax + gap)
      processed[idx].final = round2(processed[idx].final + gap)
    }
  }

  // overall tax style — prefer the AI's call, else infer from the items
  let taxType = tax_type
  if (!['added', 'included', 'none'].includes(taxType)) {
    const anyTax = processed.some(i => i.tax_rate > 0)
    taxType = !anyTax ? 'none' : processed.some(i => i.tax_rate > 0 && !i.tax_included) ? 'added' : 'included'
  }

  return { items: processed, taxType }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}