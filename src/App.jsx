import { useEffect, useState } from 'react'
import { parseBill, deriveItem } from './billparser'
import { supabase } from './supabase'
import { symbolFor } from './currency'
import ManualSplit from './ManualSplit'

export default function App({ user, groupId, profile }) {
  const [items, setItems] = useState([])
  const [taxType, setTaxType] = useState('none') // 'added' | 'included' | 'none'
  const [loading, setLoading] = useState(false)
  const [splitName, setSplitName] = useState('')
  const [creatorName, setCreatorName] = useState(profile?.username || user?.email?.split('@')[0] || '')
  const [splitCreated, setSplitCreated] = useState(null)
  const [nameModal, setNameModal] = useState(false) // prompt for split name if missing
  // guests (no group) only get the scan flow; group splits choose scan vs manual first
  const [mode, setMode] = useState(groupId ? null : 'scan')
  // who paid the bill (group splits only) — defaults to the creator
  const [members, setMembers] = useState([])
  const [paidBy, setPaidBy] = useState(profile?.username || '')
  const [currencyCode, setCurrencyCode] = useState(profile?.currency || 'INR')

  useEffect(() => {
    if (!groupId || !user) return
    loadMembers()
  }, [groupId])

  async function loadMembers() {
    const { data } = await supabase
      .from('group_members')
      .select('user_id, email')
      .eq('group_id', groupId)
      .eq('status', 'accepted')
    const rows = data || []
    const ids = rows.map(r => r.user_id)
    const nameMap = {}
    if (ids.length) {
      const { data: profs } = await supabase.from('profiles').select('id, username').in('id', ids)
      ;(profs || []).forEach(p => { nameMap[p.id] = p.username })
    }
    const built = rows.map(r => ({ user_id: r.user_id, name: nameMap[r.user_id] || r.email }))
    setMembers(built)
    const mine = built.find(m => m.user_id === user.id)
    if (mine) setPaidBy(mine.name)

    // group currency governs amounts on this scan
    const { data: g } = await supabase.from('groups').select('currency').eq('id', groupId).maybeSingle()
    if (g?.currency) setCurrencyCode(g.currency)
  }

  async function handleUpload(e) {
    const file = e.target.files[0]
    if (!file) return
    setLoading(true)
    try {
      const parsed = await parseBill(file)
      setItems(parsed.items)
      setTaxType(parsed.taxType)
    } catch (err) {
      alert('Could not read bill. Try a clearer image.')
      console.error(err)
    }
    setLoading(false)
  }

  // re-derive base/tax/final whenever the user edits an amount or rate
  function updateItem(index, field, value) {
    const updated = [...items]
    updated[index] = deriveItem({ ...updated[index], [field]: value })
    setItems(updated)
  }

  function removeItem(index) {
    setItems(items.filter((_, i) => i !== index))
  }

  async function createSplit() {
    if (items.length === 0) {
      alert('Upload a bill first')
      return
    }
    if (!creatorName) {
      alert('Enter your name')
      return
    }
    if (!splitName.trim()) {
      setNameModal(true) // open the name box instead of blocking with an alert
      return
    }

    const { data: split, error } = await supabase
      .from('splits')
      .insert({
        name: splitName,
        created_by: user ? user.email : creatorName,
        group_id: groupId || null,
        paid_by: groupId && user ? paidBy : null,
        currency: currencyCode
      })
      .select()
      .single()

    if (error) {
      alert('Error creating split')
      console.error(error)
      return
    }

    const itemsToInsert = items.map(item => ({
      split_id: split.id,
      name: item.name,
      quantity: item.quantity,
      price: Number(item.final),                 // after-tax amount (used for shares)
      tax_rate: parseFloat(item.tax_rate) || 0,
      tax_included: !!item.tax_included
    }))

    const { error: itemsError } = await supabase.from('items').insert(itemsToInsert)
    if (itemsError) {
      alert('Split saved but items failed to save: ' + itemsError.message)
      console.error(itemsError)
      return
    }

    // logged-in creator → straight to picking items; guests → keep the copy-link screen
    if (user) {
      window.location.href = `/split/${split.id}`
    } else {
      setSplitCreated(split)
    }
  }

  const cur = symbolFor(currencyCode) // currency symbol for amounts on this scan

  if (groupId && mode === null) {
    return (
      <div className="page">
        <a href={`/group/${groupId}`} className="back-link">Back</a>
        <h2>New split</h2>
        <p className="muted">How do you want to split?</p>
        <div className="tiles">
          <button onClick={() => setMode('scan')} className="tile">
            <div className="tile-emoji">📷</div>
            <div className="tile-title">Scan a bill</div>
            <div className="tile-sub">Friends pick their own items</div>
          </button>
          <button onClick={() => setMode('manual')} className="tile">
            <div className="tile-emoji">✍️</div>
            <div className="tile-title">Split manually</div>
            <div className="tile-sub">Enter a total, split evenly or unevenly</div>
          </button>
        </div>
      </div>
    )
  }

  if (mode === 'manual') {
    return <ManualSplit user={user} groupId={groupId} onBack={() => setMode(null)} />
  }

  if (splitCreated) {
    const link = `${window.location.origin}/split/${splitCreated.id}`
    return (
      <div className="page">
        <h2>Split created! 🎉</h2>
        <p className="muted mt-1">Share this link with your friends:</p>
        <div className="line" style={{ wordBreak: 'break-all', display: 'block', background: 'var(--accent-soft)', borderColor: 'var(--accent-line)' }}>
          {link}
        </div>
        <div className="cluster mt-2" style={{ flexWrap: 'wrap' }}>
          <button onClick={() => setSplitCreated(null)} className="btn">← Edit split</button>
          <button onClick={() => navigator.clipboard.writeText(link)} className="btn">Copy link</button>
          <button
            onClick={() => {
              navigator.clipboard.writeText(link)
              window.open(`/split/${splitCreated.id}?creator=${encodeURIComponent(creatorName)}`, '_blank')
            }}
            className="btn btn-primary"
          >
            Next → Make my selections
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      {nameModal && (
        <div
          onClick={() => setNameModal(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: '1rem' }}
        >
          <div onClick={e => e.stopPropagation()} className="card" style={{ maxWidth: '360px', width: '100%' }}>
            <h3 style={{ marginTop: 0 }}>Name this split</h3>
            <p className="faint" style={{ marginTop: '-0.2rem' }}>Give it a name so everyone knows what it's for.</p>
            <input
              className="input"
              autoFocus
              placeholder="e.g. Dinner, Groceries"
              value={splitName}
              onChange={e => setSplitName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && splitName.trim()) { setNameModal(false); createSplit() } }}
            />
            <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1.2rem' }}>
              <button onClick={() => setNameModal(false)} className="btn" style={{ flex: 1 }}>Cancel</button>
              <button
                onClick={() => { if (splitName.trim()) { setNameModal(false); createSplit() } }}
                className="btn btn-primary"
                style={{ flex: 1 }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {groupId && (
        <button onClick={() => setMode(null)} className="back-link">Back</button>
      )}
      <h2>{groupId ? 'Scan a bill' : 'Smart Splitter'}</h2>

      <div className="mt-2">
        <input
          className="input field"
          placeholder="Your name"
          value={creatorName}
          onChange={e => setCreatorName(e.target.value)}
        />
        <input
          className="input field"
          placeholder="Split name (e.g. Costco)"
          value={splitName}
          onChange={e => setSplitName(e.target.value)}
        />
        {groupId && user && members.length > 0 && (
          <select
            className="input field"
            value={paidBy}
            onChange={e => setPaidBy(e.target.value)}
          >
            {members.map(m => (
              <option key={m.user_id} value={m.name}>Paid by @{m.name}</option>
            ))}
          </select>
        )}
      </div>

      <div className="dropzone">
        <div style={{ fontSize: '2.2rem' }}>🧾</div>
        <div className="muted mt-1">Add your bill: Snap it or Pick a photo</div>
        <div className="cluster mt-1" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
          <label className="btn btn-sm btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
            📷 Take photo
            <input type="file" accept="image/*" capture="environment" onChange={handleUpload} style={{ display: 'none' }} />
          </label>
          <label className="btn btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
            🖼️ Choose file
            <input type="file" accept="image/*" onChange={handleUpload} style={{ display: 'none' }} />
          </label>
        </div>
      </div>

      {loading && <p className="muted">Reading bill…</p>}

      {items.length > 0 && (
        <div className="mt-2">
          <h3 style={{ marginBottom: '0.3rem' }}>Items found</h3>
          <p className="card-sub" style={{ marginBottom: '0.6rem' }}>
            {taxType === 'added'
              ? '🧾 Tax is added on top '
              : taxType === 'included'
                ? '🧾 Prices already include tax. Check them against your bill.'
                : '🧾 No tax on this bill. Check the amounts against your bill.'}
          </p>
          {items.map((item, i) => (
            <div key={i} className="card" style={{ padding: '0.8rem 1rem' }}>
              <div className="cluster" style={{ alignItems: 'stretch' }}>
                <input
                  className="input"
                  value={item.name}
                  onChange={e => updateItem(i, 'name', e.target.value)}
                  style={{ flex: 1 }}
                />
                <button onClick={() => removeItem(i)} className="btn-ghost" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem' }}>✕</button>
              </div>
              <div className="cluster mt-1" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
                <label className="faint" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>Qty
                  <input type="number" value={item.quantity} onChange={e => updateItem(i, 'quantity', e.target.value)} className="input" style={{ width: '78px' }} />
                </label>
                <label className="faint" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>{item.tax_included ? `Price (incl. tax) ${cur}` : `Before tax ${cur}`}
                  <input type="number" value={item.printed} onChange={e => updateItem(i, 'printed', e.target.value)} className="input" style={{ width: '110px' }} />
                </label>
                {taxType !== 'none' && (
                  <label className="faint" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>Tax %
                    <input type="number" value={item.tax_rate} onChange={e => updateItem(i, 'tax_rate', e.target.value)} className="input" style={{ width: '82px' }} />
                  </label>
                )}
              </div>
              <div className="card-sub mt-1">
                {Number(item.tax) > 0
                  ? (item.tax_included
                      ? `incl. ${cur}${Number(item.tax).toFixed(2)} tax → line total ${cur}${Number(item.final).toFixed(2)}`
                      : `+ ${cur}${Number(item.tax).toFixed(2)} tax → line total ${cur}${Number(item.final).toFixed(2)}`)
                  : `line total ${cur}${Number(item.final).toFixed(2)}`}
              </div>
            </div>
          ))}

          {(() => {
            const subtotal = items.reduce((s, i) => s + Number(i.base || 0), 0)
            const taxTotal = items.reduce((s, i) => s + Number(i.tax || 0), 0)
            const grand = items.reduce((s, i) => s + Number(i.final || 0), 0)
            return (
              <div className="mt-2">
                {taxTotal > 0 && (
                  <>
                    <div className="row faint"><span>Subtotal (before tax)</span><span>{cur}{subtotal.toFixed(2)}</span></div>
                    <div className="row faint"><span>Tax</span><span>{cur}{taxTotal.toFixed(2)}</span></div>
                  </>
                )}
                <div className="row" style={{ fontSize: '1.1rem', fontWeight: 700 }}>
                  <span>Total</span>
                  <span>{cur}{grand.toFixed(2)}</span>
                </div>
              </div>
            )
          })()}

          <button onClick={createSplit} className="btn btn-lg btn-primary mt-2">
            Create split
          </button>
        </div>
      )}
    </div>
  )
}
