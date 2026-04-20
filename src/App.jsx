import { useState } from 'react'
import { parseBill } from './billparser'
import { supabase } from './supabase'

export default function App({ user, groupId }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [splitName, setSplitName] = useState('')
  const [creatorName, setCreatorName] = useState(user?.email?.split('@')[0] || '')
  const [splitCreated, setSplitCreated] = useState(null)

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

    setSplitCreated(split)
  }

  if (splitCreated) {
  const link = `${window.location.origin}/split/${splitCreated.id}`
  return (
    <div style={{ padding: '2rem', maxWidth: '600px', margin: '0 auto' }}>
      <h2>Split created!</h2>
      <p>Share this link with your friends:</p>
      <div style={{ background: '#1a1a1a', padding: '1rem', borderRadius: '8px', wordBreak: 'break-all' }}>
        {link}
      </div>
      <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
        <button
          onClick={() => navigator.clipboard.writeText(link)}
          style={{ padding: '0.5rem 1rem', cursor: 'pointer' }}
        >
          Copy link
        </button>
        <button
          onClick={() => window.location.href = `/split/${splitCreated.id}?creator=${encodeURIComponent(creatorName)}`}
          style={{ padding: '0.5rem 1.5rem', cursor: 'pointer', background: '#4ade80', color: '#000', border: 'none', borderRadius: '6px', fontWeight: 'bold' }}
        >
          Next → Make my selections
        </button>
      </div>
    </div>
  )
}

  return (
    <div style={{ padding: '2rem', maxWidth: '600px', margin: '0 auto' }}>
      <h1>Smart Splitter</h1>

      <div style={{ marginBottom: '1rem' }}>
        <input
          placeholder="Your name"
          value={creatorName}
          onChange={e => setCreatorName(e.target.value)}
          style={{ padding: '0.5rem', marginRight: '1rem', width: '180px' }}
        />
        <input
          placeholder="Split name (e.g. Goa trip)"
          value={splitName}
          onChange={e => setSplitName(e.target.value)}
          style={{ padding: '0.5rem', width: '220px' }}
        />
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <input type="file" accept="image/*" onChange={handleUpload} />
      </div>

      {loading && <p>Reading bill...</p>}

      {items.length > 0 && (
        <div>
          <h3>Items found</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>Item</th>
                <th style={{ padding: '0.5rem' }}>Qty</th>
                <th style={{ padding: '0.5rem' }}>Price</th>
                <th style={{ padding: '0.5rem' }}>Tax</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={i} style={{ borderTop: '1px solid #333' }}>
                  <td style={{ padding: '0.5rem' }}>
                    <input
                      value={item.name}
                      onChange={e => updateItem(i, 'name', e.target.value)}
                      style={{ width: '100%', padding: '0.25rem' }}
                    />
                  </td>
                  <td style={{ padding: '0.5rem' }}>
                    <input
                      type="number"
                      value={item.quantity}
                      onChange={e => updateItem(i, 'quantity', e.target.value)}
                      style={{ width: '60px', padding: '0.25rem' }}
                    />
                  </td>
                  <td style={{ padding: '0.5rem' }}>
                    <input
                      type="number"
                      value={item.price}
                      onChange={e => updateItem(i, 'price', e.target.value)}
                      style={{ width: '80px', padding: '0.25rem' }}
                    />
                  </td>
                  <td style={{ padding: '0.5rem', fontSize: '0.8rem', color: '#888' }}>
                    {item.tax_rate > 0
                      ? `${item.tax_rate}% ${item.tax_included ? '(incl)' : '(added)'}`
                      : 'no tax'}
                  </td>
                  <td style={{ padding: '0.5rem' }}>
                    <button onClick={() => removeItem(i)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <button
            onClick={createSplit}
            style={{ marginTop: '1.5rem', padding: '0.75rem 2rem', fontSize: '1rem', cursor: 'pointer' }}
          >
            Create split
          </button>
        </div>

      )}
    </div>
  )
}