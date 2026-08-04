import { supabase } from './supabase'

// Reading the bill happens in the `scan-bill` Edge Function, NOT here — that is
// where the Gemini API key lives now. This file keeps all the deterministic
// money math, so the numbers stay ours and stay reproducible.

// Thrown with a code the UI can turn into a specific message.
export class ScanError extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}

export async function parseBill(imageFile) {
  const { base64, mimeType } = await prepareImage(imageFile)

  // invoke() attaches the Supabase auth header for us (the anon key for guests).
  const { data, error } = await supabase.functions.invoke('scan-bill', {
    body: { imageBase64: base64, mimeType },
  })

  if (error) {
    // Two different JSON shapes can come back:
    //   our function  -> { error: "rate_limited" }
    //   the Supabase gateway (e.g. function missing) -> { code: "NOT_FOUND", ... }
    // Only a genuine fetch failure should say "network" — anything else would
    // wrongly tell the user to check their internet.
    let code = 'unknown'
    try {
      const body = await error.context?.json?.()
      if (body?.error) code = body.error
      else if (body?.code) code = `gateway_${body.code}`
    } catch {
      // No readable body at all = the request never completed.
      code = 'network'
    }
    throw new ScanError(code)
  }
  if (data?.error) throw new ScanError(data.error)

  return processBill(data)
}

const MAX_EDGE = 1600 // px on the long side — keeps receipt text readable

// Phone photos are several MB, and they now travel through our function instead
// of straight to Google. Downscale to keep the upload small and the scan fast.
async function prepareImage(file) {
  // PDFs go through untouched — there is nothing to downscale, and Gemini reads
  // them directly. Only images get resized.
  if (!file.type.startsWith('image/')) {
    return { base64: await fileToBase64(file), mimeType: file.type }
  }

  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))

    // Already small enough — send the original bytes untouched.
    if (scale === 1) {
      return { base64: await fileToBase64(file), mimeType: file.type }
    }

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
    return { base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' }
  } catch {
    // Any browser hiccup (e.g. HEIC it cannot decode) — just send the original.
    return { base64: await fileToBase64(file), mimeType: file.type }
  }
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