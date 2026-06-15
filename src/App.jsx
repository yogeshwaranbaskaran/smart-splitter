import { useState } from 'react'
import { parseBill } from './billparser'
import { supabase } from './supabase'
import ManualSplit from './ManualSplit'

export default function App({ user, groupId, profile }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [splitName, setSplitName] = useState('')
  const [creatorName, setCreatorName] = useState(profile?.username || user?.email?.split('@')[0] || '')
  const [splitCreated, setSplitCreated] = useState(null)
  // guests (no group) only get the scan flow; group splits choose scan vs manual first
  const [mode, setMode] = useState(groupId ? null : 'scan')

  async function handleUpload(e) {
    const file = e.target.files[0]
    if (!file) return
    setLoading(true)
    try {
      const parsed = await parseBill(file)
      setItems(parsed)
    } catch (err) {
      alert('Could not read bill. Try a clearer image.')
      console.error(err)
    }
    setLoading(false)
  }

  function updateItem(index, field, value) {
    const updated = [...items]
    updated[index][field] = value
    setItems(updated)
  }

  function removeItem(index) {
    setItems(items.filter((_, i) => i !== index))
  }

  async function createSplit() {
    if (!splitName || !creatorName) {
      alert('Enter your name and a split name')
      return
    }
    if (items.length === 0) {
      alert('Upload a bill first')
      return
    }

    const { data: split, error } = await supabase
      .from('splits')
      .insert({
        name: splitName,
        created_by: user ? user.email : creatorName,
        group_id: groupId || null
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
      price: item.price
    }))

    await supabase.from('items').insert(itemsToInsert)

    // logged-in creator → straight to picking items; guests → keep the copy-link screen
    if (user) {
      window.location.href = `/split/${split.id}`
    } else {
      setSplitCreated(split)
    }
  }

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
          placeholder="Split name (e.g. Goa trip)"
          value={splitName}
          onChange={e => setSplitName(e.target.value)}
        />
      </div>

      <div className="dropzone">
        <div style={{ fontSize: '2.2rem' }}>🧾</div>
        <div className="muted mt-1">Add your bill — snap it or pick a photo</div>
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
          <h3 style={{ marginBottom: '0.6rem' }}>Items found</h3>
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
              <div className="cluster mt-1">
                <label className="faint">Qty
                  <input type="number" value={item.quantity} onChange={e => updateItem(i, 'quantity', e.target.value)} className="input" style={{ width: '64px', marginLeft: '0.4rem' }} />
                </label>
                <label className="faint">Price ₹
                  <input type="number" value={item.price} onChange={e => updateItem(i, 'price', e.target.value)} className="input" style={{ width: '90px', marginLeft: '0.4rem' }} />
                </label>
                <span className="faint" style={{ marginLeft: 'auto' }}>
                  {item.tax_rate > 0
                    ? `${item.tax_rate}% ${item.tax_included ? '(incl)' : '(added)'}`
                    : 'no tax'}
                </span>
              </div>
            </div>
          ))}
          <div className="row mt-1" style={{ fontSize: '1.1rem', fontWeight: 700 }}>
            <span>Total</span>
            <span>₹{items.reduce((sum, item) => sum + Number(item.price), 0).toFixed(2)}</span>
          </div>
          <button onClick={createSplit} className="btn btn-lg btn-primary mt-2">
            Create split
          </button>
        </div>
      )}
    </div>
  )
}
