// How an item's cost is divided between the people who claimed it.
//
// THE RULE (decided 2026-08-05):
//   - Tapping an item with no quantity means "I had some of this" — an
//     IMPLICIT claim. Implicit claimers share whatever is left, equally.
//   - Setting a quantity is an EXPLICIT claim for exactly that many units.
//   - Explicit claims are honoured first. The remainder goes to the implicit
//     claimers.
//   - If EVERY claimer was explicit and they do not add up to the item's
//     quantity, the difference is UNCLAIMED. It belongs to nobody, it is shown
//     to the whole group, and the split cannot be finalized until it is gone.
//
// Worked example — 2 Cokes, 3 people, all three tap it:
//   A sets qty 1 (drank a whole one), B and C just tap.
//   -> explicit = 1, remainder = 1, split between B and C = 0.5 each.
//   If instead A sets 1 and B sets 0.5 and C does not tap at all:
//   -> explicit = 1.5, nobody implicit, so 0.5 Coke is unclaimed.

const round2 = n => Math.round(n * 100) / 100

// Floating point makes 0.1+0.2 !== 0.3, so never compare quantities exactly.
const EPS = 0.001

// A selection claims a specific amount only when qty is a real number.
// null/undefined/'' all mean "share whatever is left".
export function isExplicit(sel) {
  return sel.qty !== null && sel.qty !== undefined && sel.qty !== '' && !Number.isNaN(Number(sel.qty))
}

// Work out, for ONE item, how much quantity and money each claimer owes.
// `selections` may be every selection in the split; it gets filtered here.
export function computeItemShares(item, selections) {
  const quantity = Number(item.quantity) || 1
  const price = Number(item.price) || 0
  const unitPrice = quantity > 0 ? price / quantity : price

  // Marker rows (item_id null, "nothing here is mine") never reach this.
  const claims = selections.filter(s => s.item_id === item.id)
  const explicit = claims.filter(isExplicit)
  const implicit = claims.filter(s => !isExplicit(s))

  const explicitQty = explicit.reduce((sum, s) => sum + Number(s.qty), 0)
  const remainder = quantity - explicitQty

  // Implicit claimers absorb the remainder, so anything left over is only
  // unclaimed when nobody tapped it without a quantity.
  const perImplicit = implicit.length > 0 ? remainder / implicit.length : 0

  const shares = {}
  explicit.forEach(s => {
    const q = Number(s.qty)
    shares[s.user_name] = { qty: q, amount: round2(q * unitPrice), explicit: true }
  })
  implicit.forEach(s => {
    const q = Math.max(0, perImplicit)
    shares[s.user_name] = { qty: q, amount: round2(q * unitPrice), explicit: false }
  })

  // Claimed for more than exists (e.g. two people each claim 2 of 2 Cokes).
  const overclaimed = remainder < -EPS

  // Genuinely nobody's: only possible when every claimer named an amount.
  const unclaimedQty = implicit.length === 0 && remainder > EPS ? remainder : 0

  return {
    unitPrice,
    quantity,
    shares,
    unclaimedQty,
    unclaimedAmount: round2(unclaimedQty * unitPrice),
    overclaimed,
    claimedQty: quantity - unclaimedQty,
  }
}

// Roll the per-item results up for a whole split.
export function computeSplitTotals(items, selections) {
  const perPerson = {}
  const problems = []
  let unclaimedAmount = 0

  items.forEach(item => {
    const r = computeItemShares(item, selections)

    Object.entries(r.shares).forEach(([name, s]) => {
      perPerson[name] = round2((perPerson[name] || 0) + s.amount)
    })

    if (r.unclaimedQty > 0) {
      unclaimedAmount = round2(unclaimedAmount + r.unclaimedAmount)
      problems.push({ item, kind: 'unclaimed', qty: r.unclaimedQty, amount: r.unclaimedAmount })
    }
    if (r.overclaimed) {
      problems.push({ item, kind: 'overclaimed', qty: r.quantity, amount: 0 })
    }
  })

  return {
    perPerson,
    problems,
    unclaimedAmount,
    // A split is only complete when every unit of every item belongs to somebody.
    complete: problems.length === 0,
  }
}

// Format 1 as "1" but 0.5 as "0.5", so the UI never shows "1.00 x Coke".
export function fmtQty(q) {
  const n = Number(q) || 0
  return Number.isInteger(n) ? String(n) : String(round2(n))
}
