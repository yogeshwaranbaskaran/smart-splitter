import { GoogleGenerativeAI } from '@google/generative-ai'

const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY)

export async function parseBill(imageFile) {
  const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite-preview' })
  const imageData = await fileToBase64(imageFile)

  const prompt = `Look at this bill image. Return ONLY this JSON, no markdown, no explanation.

{
  "items": [
    {
      "name": "english name",
      "quantity": 1,
      "unit_price": 100,
      "tax_rate": 8,
      "tax_included": true
    }
  ],
  "grand_total": 1587
}

Rules:
- name: translate to English
- quantity: number of packs or units bought. If bill shows "3x299" quantity is 3
- unit_price: price per single unit as printed on bill
- tax_rate: tax percentage for this item. Look for % symbols near item or tax section. If no tax mentioned use 0
- tax_included: true if tax is already inside the printed price, false if tax is added separately at bottom
- grand_total: final amount paid

For Japanese bills:
- items marked with * have 8% tax added at bottom (tax_included: false)
- items marked with 内 have tax already inside price (tax_included: true)
- shopping bag and non-food items have 10% tax added at bottom (tax_included: false)`

  const result = await model.generateContent([
    prompt,
    { inlineData: { mimeType: imageFile.type, data: imageData } }
  ])

  const text = result.response.text()
  const cleaned = text.replace(/```json|```/g, '').trim()
  const parsed = JSON.parse(cleaned)

  return calculateFinalPrices(parsed)
}

function calculateFinalPrices({ items, grand_total }) {
  if (!items || items.length === 0) return []

  const rawTotal = items.reduce((sum, i) => sum + (i.unit_price * i.quantity), 0)

  // if raw prices already match grand total — tax is included, ignore LLM tax logic
  const rawMatchesGrand = grand_total > 0 && Math.abs(rawTotal - grand_total) < 5

  if (rawMatchesGrand) {
    return items.map(item => ({
      name: item.name,
      quantity: item.quantity,
      price: parseFloat((item.unit_price * item.quantity).toFixed(2)),
      tax_rate: item.tax_rate || 0,
      tax_included: true
    }))
  }

  // raw prices don't match — tax needs to be added
  const processed = items.map(item => {
    const taxRate = item.tax_rate || 0
    const baseTotal = item.unit_price * item.quantity
    const finalPrice = parseFloat((baseTotal * (1 + taxRate / 100)).toFixed(2))

    return {
      name: item.name,
      quantity: item.quantity,
      price: finalPrice,
      tax_rate: taxRate,
      tax_included: false
    }
  })

  // final sanity check — if still doesn't match, distribute the gap
  const processedTotal = processed.reduce((sum, i) => sum + i.price, 0)
  const gap = grand_total - processedTotal

  if (grand_total > 0 && gap > 2) {
    return processed.map(item => ({
      ...item,
      price: parseFloat((item.price + (gap * (item.price / processedTotal))).toFixed(2))
    }))
  }

  return processed
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}