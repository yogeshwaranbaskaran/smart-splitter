import { useEffect, useState } from 'react'
import { useParams , useSearchParams} from 'react-router-dom'
import { supabase } from './supabase'
import { symbolFor } from './currency'
import { computeItemShares, computeSplitTotals, fmtQty } from './splitmath'
import { cap } from './names'

export default function SplitView() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const creatorFromUrl = searchParams.get('creator')
  const [split, setSplit] = useState(null)
  const [items, setItems] = useState([])
  const [userName, setUserName] = useState(() => sessionStorage.getItem(`name-${id}`) || '')
  const [nameConfirmed, setNameConfirmed] = useState(() => !!sessionStorage.getItem(`name-${id}`))
  const [selections, setSelections] = useState({})
  // Explicit quantities, keyed by item id. A key is only present when I said
  // "I had exactly this much"; otherwise my claim shares the remainder.
  const [qtys, setQtys] = useState({})
  // Whether I already picked is a FACT IN THE DATABASE, not a tab-local flag.
  // This used to read sessionStorage, which dies with the tab — so coming back
  // to a split later made the app ask you to pick all over again even though
  // your selections were saved. Derived from my selections rows below instead.
  const [confirmed, setConfirmed] = useState(false)
  // Set only when I deliberately press "Edit my selection", so the effect that
  // derives `confirmed` from the database cannot immediately undo the edit.
  const [editing, setEditing] = useState(false)
  // Summary page tab: 'overview' (status, finalize, who owes what) or 'items' (per-item breakdown).
  const [summaryTab, setSummaryTab] = useState('overview')
  const [allSelections, setAllSelections] = useState([])
  const [currentEmail, setCurrentEmail] = useState(null)
  const [creatorName, setCreatorName] = useState(null)
  const [currencyCode, setCurrencyCode] = useState('INR')

  useEffect(() => {
    if (creatorFromUrl) {
      setUserName(creatorFromUrl)
      setNameConfirmed(true)
    }
  }, [creatorFromUrl])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setCurrentEmail(session?.user?.email || null)
      if (session?.user) {
        const { data: p } = await supabase
          .from('profiles')
          .select('username')
          .eq('id', session.user.id)
          .maybeSingle()
        if (p?.username) {
          setUserName(p.username)
          setNameConfirmed(true)
        }
      }
    })
  }, [])

  useEffect(() => {
    loadSplit()
    loadSelections()

    const channel = supabase
      .channel(`selections-${id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'selections',
        filter: `split_id=eq.${id}`
      }, () => {
        loadSelections()
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'splits',
        filter: `id=eq.${id}`
      }, () => {
        loadSplit()
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [id])

  async function loadSplit() {
    const { data: splitData } = await supabase
      .from('splits')
      .select('*')
      .eq('id', id)
      .single()

    const { data: itemsData } = await supabase
      .from('items')
      .select('*')
      .eq('split_id', id)

    setSplit(splitData)
    setItems(itemsData || [])

    // currency: the group's currency governs the split; guests/no-group use the snapshot
    if (splitData?.group_id) {
      const { data: g } = await supabase.from('groups').select('currency').eq('id', splitData.group_id).maybeSingle()
      setCurrencyCode(g?.currency || splitData.currency || 'INR')
    } else {
      setCurrencyCode(splitData?.currency || 'INR')
    }

    // created_by stores an email — look up the creator's @username to show instead
    if (splitData?.created_by) {
      const { data: prof } = await supabase
        .from('profiles')
        .select('username')
        .eq('email', splitData.created_by)
        .maybeSingle()
      setCreatorName(prof?.username ? `@${cap(prof.username)}` : splitData.created_by)
    }
  }

  async function loadSelections() {
    const { data } = await supabase
      .from('selections')
      .select('*')
      .eq('split_id', id)

    setAllSelections(data || [])
  }

  // Rehydrate my own state from the database whenever selections or my identity
  // load. Two things get restored: that I already acted, and WHICH items I took
  // (so "Edit my selection" starts from my real picks instead of a blank slate).
  useEffect(() => {
    if (!userName || editing) return
    const mine = allSelections.filter(s => s.user_name === userName)
    if (mine.length === 0) return

    setConfirmed(true)
    const picks = {}
    const q = {}
    // A marker row (item_id null, share 0) means "nothing here is mine" — the
    // person acted but took no items, so there is nothing to tick.
    mine.forEach(s => {
      if (!s.item_id) return
      picks[s.item_id] = true
      if (s.qty !== null && s.qty !== undefined) q[s.item_id] = Number(s.qty)
    })
    setSelections(picks)
    setQtys(q)
  }, [allSelections, userName, editing])

  function toggleItem(itemId) {
    setSelections(prev => ({
      ...prev,
      [itemId]: !prev[itemId]
    }))
    // Un-ticking an item must drop any quantity I had set on it, otherwise a
    // stale number would come back if I tapped it again.
    setQtys(prev => {
      const next = { ...prev }
      delete next[itemId]
      return next
    })
  }

  // Step a quantity up or down. Passing null returns the item to "share it" —
  // the implicit claim that splits whatever is left with the other claimers.
  function setQty(itemId, value) {
    setQtys(prev => {
      const next = { ...prev }
      if (value === null) delete next[itemId]
      else next[itemId] = value
      return next
    })
  }

  async function confirmSelections() {
    if (!userName) return

    // delete previous selections by this user
    await supabase
      .from('selections')
      .delete()
      .eq('split_id', id)
      .eq('user_name', userName)

    const selected = items.filter(item => selections[item.id])

    if (selected.length === 0) {
      alert('Select at least one item')
      return
    }

    const toInsert = selected.map(item => ({
      split_id: id,
      item_id: item.id,
      user_name: userName,
      qty: qtys[item.id] ?? null,   // null = share the remainder
      share: 0                      // real amount is written by recomputeShares
    }))

    await supabase.from('selections').insert(toInsert)
    await recomputeShares()
    setConfirmed(true)
    setEditing(false)
  }

  // `share` is the money each person owes for one item. It cannot be worked out
  // from a single row, because it depends on who ELSE claimed the same item and
  // how much they took — so it is recalculated for the whole split after any
  // change and written back.
  //
  // This also fixes a long-standing bug: `share` used to be stored as the full
  // line price for every picker, so the group Expenses tab counted a shared
  // ₹300 dish as ₹300 owed by each person instead of ₹100.
  async function recomputeShares() {
    const { data: fresh } = await supabase
      .from('selections')
      .select('*')
      .eq('split_id', id)

    const rows = fresh || []
    const updates = []

    items.forEach(item => {
      const { shares } = computeItemShares(item, rows)
      rows
        .filter(r => r.item_id === item.id)
        .forEach(r => {
          const amount = shares[r.user_name]?.amount ?? 0
          if (Number(r.share) !== amount) updates.push({ ...r, share: amount })
        })
    })

    if (updates.length) await supabase.from('selections').upsert(updates)
    setAllSelections(updates.length ? await reload() : rows)
  }

  async function reload() {
    const { data } = await supabase.from('selections').select('*').eq('split_id', id)
    return data || []
  }

  async function markNothing() {
    if (!userName) return
    // record that this person acted but owes nothing (a marker row, no item)
    await supabase.from('selections').delete().eq('split_id', id).eq('user_name', userName)
    await supabase.from('selections').insert({
      split_id: id,
      item_id: null,
      user_name: userName,
      share: 0
    })
    // Dropping out of items changes what everyone else owes on them, so shares
    // have to be recalculated here too.
    await recomputeShares()
    setConfirmed(true)
    setEditing(false)
  }

  async function finalizeSplit() {
    if (!window.confirm('Finalize this split? Nobody can change their selections after this.')) return
    await supabase.from('splits').update({ finalized: true }).eq('id', id)
    setSplit(prev => (prev ? { ...prev, finalized: true } : prev))
  }

  async function unfinalizeSplit() {
    await supabase.from('splits').update({ finalized: false }).eq('id', id)
    setSplit(prev => (prev ? { ...prev, finalized: false } : prev))
  }

  function getItemSelectors(itemId) {
    return allSelections
      .filter(s => s.item_id === itemId)
      .map(s => s.user_name)
  }

  // What I would owe if I confirmed right now. Built by replacing my rows in
  // the live selections with my current on-screen picks, so the preview accounts
  // for everyone else's claims too.
  function getMyTotal() {
    const others = allSelections.filter(s => s.user_name !== userName)
    const mine = items
      .filter(item => selections[item.id])
      .map(item => ({ item_id: item.id, user_name: userName, qty: qtys[item.id] ?? null }))
    const { perPerson } = computeSplitTotals(items, [...others, ...mine])
    return perPerson[userName] || 0
  }

  // Same preview, used to warn about unclaimed units while picking.
  function livePreview() {
    const others = allSelections.filter(s => s.user_name !== userName)
    const mine = items
      .filter(item => selections[item.id])
      .map(item => ({ item_id: item.id, user_name: userName, qty: qtys[item.id] ?? null }))
    return computeSplitTotals(items, [...others, ...mine])
  }

  const backHref = split && (split.group_id ? `/group/${split.group_id}` : '/')

  if (!split) return <div className="screen-msg">Loading…</div>

  const cur = symbolFor(currencyCode) // currency symbol used across this view

  // show @username if we resolved it, else fall back to the raw created_by email
  const creatorLabel = creatorName || split.created_by

  // manual (GPay-style) splits: just show who owes what, read-only
  if (split.split_type === 'manual') {
    const total = allSelections.reduce((sum, s) => sum + Number(s.share), 0)
    return (
      <div className="page" style={{ maxWidth: '480px' }}>
        <a href={backHref} className="back-link">Back</a>
        <h2>{split.name}</h2>
        <p className="card-sub">Created by {creatorLabel} · {new Date(split.created_at).toLocaleDateString()}</p>

        <div className="amount-hero mt-2">
          <div className="lbl">Total</div>
          <div className="val">{cur}{total.toFixed(2)}</div>
        </div>

        <h3 className="mt-2" style={{ marginBottom: '0.6rem' }}>Who owes what</h3>
        {allSelections.map(s => (
          <div key={s.id} className="line">
            <span className="cluster">
              <span className="avatar-sm">{s.user_name.trim().charAt(0).toUpperCase()}</span>
              {cap(s.user_name)}
            </span>
            <strong>{cur}{Number(s.share).toFixed(2)}</strong>
          </div>
        ))}
      </div>
    )
  }

  const isCreator = currentEmail && currentEmail === split.created_by
  const billTotal = items.reduce((sum, item) => sum + Number(item.price), 0).toFixed(2)

  // Split a stored (final) item price into base + tax using the rate we saved.
  // tax_included: tax is inside the price; otherwise it was added on top.
  function splitTax(item) {
    const rate = item.tax_rate || 0
    const price = Number(item.price)
    if (rate <= 0) return { base: price, tax: 0 }
    if (item.tax_included) {
      const tax = Math.round((price * rate / (100 + rate)) * 100) / 100
      return { base: Math.round((price - tax) * 100) / 100, tax }
    }
    const base = Math.round((price / (1 + rate / 100)) * 100) / 100
    return { base, tax: Math.round((price - base) * 100) / 100 }
  }

  // whole bill is uniformly one mode (the parser applies one branch to all items)
  const hasTax = items.some(i => (i.tax_rate || 0) > 0)
  const taxMode = !hasTax ? 'none' : items.some(i => (i.tax_rate || 0) > 0 && !i.tax_included) ? 'added' : 'included'

  // shared: who-owes-what + item breakdown blocks
  function WhoOwes(summary) {
    return (
      <>
        <h3 className="mt-2" style={{ marginBottom: '0.6rem' }}>Who owes what</h3>
        {Object.entries(summary).map(([name, total]) => (
          <div key={name} className="line">
            <span className="cluster">
              <span className="avatar-sm">{name.trim().charAt(0).toUpperCase()}</span>
              {cap(name)}
            </span>
            <strong>{cur}{total.toFixed(2)}</strong>
          </div>
        ))}
      </>
    )
  }

  function ItemBreakdown() {
    return (
      <>
        <h3 className="mt-2" style={{ marginBottom: '0.3rem' }}>Item breakdown</h3>
        <p className="card-sub" style={{ marginBottom: '0.6rem' }}>
          {taxMode === 'added'
            ? '🧾 Tax added on top '
            : taxMode === 'included'
              ? '🧾 Prices already include tax.'
              : '🧾 No tax on this bill.'}
        </p>
        <div className="card" style={{ padding: '0.2rem 0.9rem' }}>
          {items.map((item, i) => {
            // Each person's real share of THIS item (qty-aware), not price / pickers.
            const r = computeItemShares(item, allSelections)
            const claimers = Object.entries(r.shares)
            const { base, tax } = splitTax(item)
            const taxNote = taxMode === 'added' && tax > 0
              ? `${cur}${base.toFixed(2)} + ${cur}${tax.toFixed(2)} tax`
              : tax > 0 ? `incl. ${cur}${tax.toFixed(2)} tax` : ''
            return (
              <div key={item.id} style={{ padding: '0.6rem 0', borderTop: i ? '1px solid var(--border)' : 'none' }}>
                <div className="row">
                  <strong>
                    {item.name}
                    {r.quantity > 1 && <span className="faint"> ×{fmtQty(r.quantity)}</span>}
                  </strong>
                  <strong>{cur}{Number(item.price).toFixed(2)}</strong>
                </div>
                {taxNote && <div className="faint" style={{ fontSize: '0.8rem' }}>{taxNote}</div>}

                {claimers.length === 0 ? (
                  <div className="faint" style={{ fontSize: '0.85rem', marginTop: '0.25rem' }}>Not claimed by anyone yet</div>
                ) : (
                  <div style={{ marginTop: '0.35rem' }}>
                    {claimers.map(([name, sh]) => (
                      <div key={name} className="row" style={{ fontSize: '0.85rem', padding: '0.1rem 0' }}>
                        <span className="cluster" style={{ gap: '0.4rem' }}>
                          <span className="avatar-sm">{name.trim().charAt(0).toUpperCase()}</span>
                          {cap(name)}
                          <span className="faint">
                            {r.quantity > 1 || sh.explicit ? ` · ${fmtQty(sh.qty)} of ${fmtQty(r.quantity)}` : ''}
                            {!sh.explicit && claimers.length > 1 ? ' (shared equally)' : ''}
                          </span>
                        </span>
                        <strong>{cur}{sh.amount.toFixed(2)}</strong>
                      </div>
                    ))}
                    {r.unclaimedQty > 0 && (
                      <div className="row" style={{ fontSize: '0.85rem', padding: '0.1rem 0', color: 'var(--danger)' }}>
                        <span>Unclaimed: {fmtQty(r.unclaimedQty)} of {fmtQty(r.quantity)}</span>
                        <strong>{cur}{r.unclaimedAmount.toFixed(2)}</strong>
                      </div>
                    )}
                    {r.overclaimed && (
                      <div style={{ fontSize: '0.85rem', color: 'var(--danger)' }}>
                        Claimed more than the {fmtQty(r.quantity)} ordered
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </>
    )
  }

  if (split.finalized) {
    // Same maths as the live summary, so the numbers do not change the moment
    // a split is locked.
    const summary = computeSplitTotals(items, allSelections).perPerson

    return (
      <div className="page" style={{ maxWidth: '480px' }}>
        <a href={backHref} className="back-link">Back</a>
        <div className="cluster">
          <h2>{split.name}</h2>
          <span className="badge badge-muted">🔒 Final</span>
        </div>
        <p className="card-sub">Created by {creatorLabel} · {new Date(split.created_at).toLocaleDateString()}</p>
        <p className="muted mt-1">This split is finalized. Selections are locked.</p>
        {isCreator && (
          <button onClick={unfinalizeSplit} className="btn btn-sm mt-1" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>
            ← Reopen split (allow edits again)
          </button>
        )}
        <div className="amount-hero mt-2">
          <div className="lbl">Bill total</div>
          <div className="val">{cur}{billTotal}</div>
        </div>
        {WhoOwes(summary)}
        {ItemBreakdown()}
      </div>
    )
  }

  if (!nameConfirmed) {
    return (
      <div className="page-narrow">
        <h2>{split.name}</h2>
        <p className="muted" style={{ margin: '0.5rem 0 1.5rem' }}>Created by {creatorLabel}</p>
        <input
          className="input"
          placeholder="Enter your name"
          value={userName}
          onChange={e => setUserName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && userName && (sessionStorage.setItem(`name-${id}`, userName), setNameConfirmed(true))}
        />
        <button
          onClick={() => {
            if (userName) {
              sessionStorage.setItem(`name-${id}`, userName)
              setNameConfirmed(true)
            }
          }}
          className="btn btn-primary mt-1"
        >
          Join split
        </button>
      </div>
    )
  }

  if (confirmed && !editing) {
    const totals = computeSplitTotals(items, allSelections)
    const summary = totals.perPerson

    return (
      <div className="page" style={{ maxWidth: '480px' }}>
        <a href={backHref} className="back-link">Back</a>
        <div className="cluster">
          <h2>Selection confirmed</h2>
          <span className="badge" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}>✓</span>
        </div>
        <p className="card-sub">Created by {creatorLabel} · {new Date(split.created_at).toLocaleDateString()}</p>

        <div className="amount-hero mt-2">
          <div className="lbl">Bill total</div>
          <div className="val">{cur}{billTotal}</div>
        </div>
        {/* ---- Status card: is this split complete, and can it be locked? ---- */}
        <div
          className="card mt-2"
          style={{ borderLeft: `4px solid ${totals.complete ? 'var(--success)' : 'var(--danger)'}` }}
        >
          {totals.complete ? (
            <>
              <strong>Everything is claimed</strong>
              <p className="faint" style={{ margin: '0.25rem 0 0' }}>
                {isCreator ? 'You can finalize this split when everyone is ready.' : 'Waiting for the creator to finalize the split.'}
              </p>
            </>
          ) : (
            <>
              <strong>Some items are still unclaimed</strong>
              <div className="mt-1">
                {totals.problems.map((p, i) => (
                  <div key={i} className="row" style={{ fontSize: '0.9rem', padding: '0.15rem 0' }}>
                    <span>
                      {p.kind === 'overclaimed'
                        ? `${p.item.name}: claimed more than ordered`
                        : `${p.item.name}: ${fmtQty(p.qty)} of ${fmtQty(Number(p.item.quantity) || 1)} unclaimed`}
                    </span>
                    {p.kind !== 'overclaimed' && <strong>{cur}{p.amount.toFixed(2)}</strong>}
                  </div>
                ))}
              </div>
              {totals.unclaimedAmount > 0 && (
                <p className="faint" style={{ margin: '0.5rem 0 0' }}>
                  {cur}{totals.unclaimedAmount.toFixed(2)} has not been assigned. Ask the person who had it to select it.
                </p>
              )}
            </>
          )}

          {isCreator && (
            <button
              onClick={finalizeSplit}
              disabled={!totals.complete}
              className="btn btn-danger btn-block mt-2"
            >
              Finalize split
            </button>
          )}
        </div>

        <div className="cluster mt-1" style={{ flexWrap: 'wrap' }}>
          <button onClick={loadSelections} className="btn btn-sm">Refresh</button>
          <button onClick={() => setEditing(true)} className="btn btn-sm">Edit my selection</button>
        </div>

        {/* Same two-button tab pattern as the group page, for consistency. */}
        <div className="cluster mt-2" role="tablist" aria-label="Summary sections">
          <button
            role="tab"
            aria-selected={summaryTab === 'overview'}
            onClick={() => setSummaryTab('overview')}
            className={`btn btn-block ${summaryTab === 'overview' ? 'btn-primary' : ''}`}
          >Overview</button>
          <button
            role="tab"
            aria-selected={summaryTab === 'items'}
            onClick={() => setSummaryTab('items')}
            className={`btn btn-block ${summaryTab === 'items' ? 'btn-primary' : ''}`}
          >Items</button>
        </div>

        {summaryTab === 'overview' ? WhoOwes(summary) : ItemBreakdown()}
      </div>
    )
  }

  return (
    <div className="page">
      <a href={backHref} className="back-link">Back</a>
      <h2>{split.name}</h2>
      <p className="muted mt-1">Hi {cap(userName)}, pick your items:</p>

      <div className="mt-1">
        {items.map(item => {
          const who = getItemSelectors(item.id)
          const maxQty = Number(item.quantity) || 1
          const picked = !!selections[item.id]
          const myQty = qtys[item.id]          // undefined = sharing the remainder
          const hasQty = myQty !== undefined
          const step = 0.5

          // What everyone ELSE has already said about this item, so I can see
          // how much is really left before I claim.
          const others = allSelections.filter(x => x.item_id === item.id && x.user_name !== userName)
          const othersExplicit = others.filter(x => x.qty !== null && x.qty !== undefined)
          const othersSharing = others.length - othersExplicit.length
          const takenByOthers = othersExplicit.reduce((n, x) => n + Number(x.qty), 0)
          const remaining = Math.max(0, +(maxQty - takenByOthers).toFixed(2))
          const fullyTaken = remaining <= 0 && othersSharing === 0
          // I can only claim up to what is left (never below one step so the
          // stepper still works when the item is technically full).
          const myMax = Math.max(step, remaining)

          return (
            <div
              key={item.id}
              onClick={() => toggleItem(item.id)}
              className={`pick ${picked ? 'pick-on' : ''}`}
            >
              <div className="row">
                <strong>
                  {item.name}
                  {maxQty > 1 && <span className="faint"> ×{fmtQty(maxQty)}</span>}
                </strong>
                <span>{cur}{item.price}</span>
              </div>
              <div className="faint" style={{ marginTop: '0.25rem' }}>
                {who.length > 0 ? `Picked by: ${who.map(cap).join(', ')}` : 'Not claimed yet'}
              </div>

              {/* Heads-up: how much of this is already spoken for by others. */}
              {others.length > 0 && (othersExplicit.length > 0 || maxQty > 1) && (
                <div style={{ marginTop: '0.2rem', fontSize: '0.8rem', color: fullyTaken ? 'var(--danger)' : 'var(--text-muted)' }}>
                  {othersExplicit.map(x => `${cap(x.user_name)} took ${fmtQty(x.qty)}`).join(', ')}
                  {othersSharing > 0 ? `${othersExplicit.length ? '. ' : ''}${othersSharing} ${othersSharing === 1 ? 'person is' : 'people are'} sharing the rest` : ''}
                  {'. '}
                  {fullyTaken
                    ? `All ${fmtQty(maxQty)} already claimed. Check with them before adding yourself.`
                    : `${fmtQty(remaining)} of ${fmtQty(maxQty)} still available.`}
                </div>
              )}

              {/* Quantity control, only once I have actually taken the item.
                  stopPropagation everywhere so tapping it never un-picks. */}
              {picked && (
                <div
                  className="cluster mt-1"
                  style={{ gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}
                  onClick={e => e.stopPropagation()}
                >
                  {!hasQty ? (
                    <button
                      className="btn btn-sm"
                      onClick={() => setQty(item.id, Math.min(1, myMax))}
                    >
                      Set my amount
                    </button>
                  ) : (
                    <>
                      <button
                        className="btn btn-sm"
                        onClick={() => setQty(item.id, Math.max(step, +(myQty - step).toFixed(2)))}
                        disabled={myQty <= step}
                      >−</button>
                      <strong style={{ minWidth: '3.5rem', textAlign: 'center' }}>
                        {fmtQty(myQty)} / {fmtQty(maxQty)}{remaining < maxQty ? <span className="faint"> ({fmtQty(remaining)} available)</span> : null}
                      </strong>
                      <button
                        className="btn btn-sm"
                        onClick={() => setQty(item.id, Math.min(myMax, +(myQty + step).toFixed(2)))}
                        disabled={myQty >= myMax}
                      >+</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => setQty(item.id, null)}>
                        Share equally
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="row mt-1" style={{ fontSize: '1.1rem', fontWeight: 700 }}>
        <span>Your total</span>
        <span>{cur}{getMyTotal()}</span>
      </div>

      {/* Live warning while picking, so gaps get noticed before confirming. */}
      {(() => {
        const p = livePreview()
        if (p.complete) return null
        return (
          <p className="faint mt-1">
            {p.unclaimedAmount > 0
              ? `${cur}${p.unclaimedAmount} of this bill has not been claimed by anyone yet.`
              : 'Some items have been claimed more times than they were ordered.'}
          </p>
        )
      })()}

      <div className="cluster mt-2" style={{ flexWrap: 'wrap' }}>
        <button onClick={confirmSelections} className="btn btn-lg btn-primary">
          Confirm my selection
        </button>
        <button onClick={markNothing} className="btn btn-lg">
          Nothing here is mine
        </button>
      </div>
    </div>
  )
}
