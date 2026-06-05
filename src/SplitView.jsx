import { useEffect, useState } from 'react'
import { useParams , useSearchParams} from 'react-router-dom'
import { supabase } from './supabase'

export default function SplitView() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const creatorFromUrl = searchParams.get('creator')
  const [split, setSplit] = useState(null)
  const [items, setItems] = useState([])
  const [userName, setUserName] = useState(() => sessionStorage.getItem(`name-${id}`) || '')
  const [nameConfirmed, setNameConfirmed] = useState(() => !!sessionStorage.getItem(`name-${id}`))
  const [selections, setSelections] = useState({})
  const [confirmed, setConfirmed] = useState(() => !!sessionStorage.getItem(`confirmed-${id}`))
  const [allSelections, setAllSelections] = useState([])
  const [showSummary, setShowSummary] = useState(false)
  const [currentEmail, setCurrentEmail] = useState(null)
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
  }

  async function loadSelections() {
    const { data } = await supabase
      .from('selections')
      .select('*')
      .eq('split_id', id)

    setAllSelections(data || [])
  }

  function toggleItem(itemId) {
    setSelections(prev => ({
      ...prev,
      [itemId]: !prev[itemId]
    }))
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
      share: item.price
    }))

    await supabase.from('selections').insert(toInsert)
    sessionStorage.setItem(`confirmed-${id}`, 'true')
    setConfirmed(true)
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
    sessionStorage.setItem(`confirmed-${id}`, 'true')
    setConfirmed(true)
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

  function getMyTotal() {
    return items
      .filter(item => selections[item.id])
      .reduce((sum, item) => sum + Number(item.price), 0)
  }

  if (!split) return <div style={{ padding: '2rem' }}>Loading...</div>

  // manual (GPay-style) splits: just show who owes what, read-only
  if (split.split_type === 'manual') {
    const total = allSelections.reduce((sum, s) => sum + Number(s.share), 0)
    return (
      <div style={{ padding: '2rem', maxWidth: '500px', margin: '0 auto' }}>
        <a href={split.group_id ? `/group/${split.group_id}` : '/'} style={{ color: '#888', fontSize: '0.9rem', display: 'inline-block', marginBottom: '1rem' }}>← Back</a>
        <h2>{split.name}</h2>
        <p style={{ color: '#888' }}>Created by {split.created_by} · {new Date(split.created_at).toLocaleDateString()}</p>
        <div style={{ fontSize: '1.2rem', margin: '1rem 0', fontWeight: 'bold' }}>
          Total: ₹{total.toFixed(2)}
        </div>
        <h3>Who owes what</h3>
        {allSelections.map(s => (
          <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem', marginBottom: '0.5rem', background: '#c3e3fa', borderRadius: '8px' }}>
            <span>{s.user_name}</span>
            <strong>₹{Number(s.share).toFixed(2)}</strong>
          </div>
        ))}
      </div>
    )
  }

  const isCreator = currentEmail && currentEmail === split.created_by

  if (split.finalized) {
    const summary = {}
    allSelections.forEach(s => {
      const item = items.find(i => i.id === s.item_id)
      if (!item) return
      const pickers = allSelections.filter(x => x.item_id === s.item_id)
      summary[s.user_name] = (summary[s.user_name] || 0) + item.price / pickers.length
    })

    return (
      <div style={{ padding: '2rem', maxWidth: '500px', margin: '0 auto' }}>
        <a href={split.group_id ? `/group/${split.group_id}` : '/'} style={{ color: '#888', fontSize: '0.9rem', display: 'inline-block', marginBottom: '1rem' }}>← Back</a>
        <h2>🔒 {split.name} — Final</h2>
        <p style={{ color: '#888' }}>Created by {split.created_by} · {new Date(split.created_at).toLocaleDateString()}</p>
        <p style={{ color: '#888' }}>This split is finalized. Selections are locked.</p>
        {isCreator && (
          <button
            onClick={unfinalizeSplit}
            style={{ padding: '0.5rem 1.25rem', cursor: 'pointer', background: '#fff', color: '#2563eb', border: '1px solid #2563eb', borderRadius: '6px', marginBottom: '1rem' }}
          >
            ← Reopen split (allow edits again)
          </button>
        )}
        <div style={{ fontSize: '1.1rem', margin: '1rem 0' }}>
          Bill total: ₹{items.reduce((sum, item) => sum + Number(item.price), 0).toFixed(2)}
        </div>

        <h3>Who owes what</h3>
        {Object.entries(summary).map(([name, total]) => (
          <div key={name} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid #333' }}>
            <span>{name}</span>
            <strong>₹{total.toFixed(2)}</strong>
          </div>
        ))}

        <h3 style={{ marginTop: '1.5rem' }}>Item breakdown</h3>
        {items.map(item => {
          const who = getItemSelectors(item.id)
          const share = who.length > 0 ? (item.price / who.length).toFixed(2) : item.price
          return (
            <div key={item.id} style={{ marginBottom: '0.75rem', padding: '0.75rem', background: '#c3e3fa', borderRadius: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <strong>{item.name}</strong>
                <span>₹{item.price}</span>
              </div>
              <div style={{ fontSize: '0.85rem', color: '#666', marginTop: '0.25rem' }}>
                {who.length > 0 ? `${who.join(', ')} — ₹${share} each` : 'Nobody picked this'}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  if (!nameConfirmed) {
    return (
      <div style={{ padding: '2rem', maxWidth: '400px', margin: '0 auto' }}>
        <h2>{split.name}</h2>
        <p>Created by {split.created_by}</p>
        <input
          placeholder="Enter your name"
          value={userName}
          onChange={e => setUserName(e.target.value)}
          style={{ padding: '0.5rem', width: '100%', marginBottom: '1rem' }}
        />
        
        <button
          onClick={() => {
            if (userName) {
                sessionStorage.setItem(`name-${id}`, userName)
                setNameConfirmed(true)
            }
          }}
          style={{ padding: '0.5rem 1.5rem', cursor: 'pointer' }}
        >
          Join split
        </button>
      </div>
    )
  }

  if (confirmed) {
  const summary = {}
  allSelections.forEach(s => {
    const item = items.find(i => i.id === s.item_id)
    if (!item) return
    const pickers = allSelections.filter(x => x.item_id === s.item_id)
    const share = item.price / pickers.length
    summary[s.user_name] = (summary[s.user_name] || 0) + share
  })

  return (
    <div style={{ padding: '2rem', maxWidth: '500px', margin: '0 auto' }}>
      <a href={split.group_id ? `/group/${split.group_id}` : '/'} style={{ color: '#888', fontSize: '0.9rem', display: 'inline-block', marginBottom: '1rem' }}>← Back</a>
      <h2>✓ Selection confirmed</h2>
      <p style={{ color: '#888', marginTop: '-0.5rem' }}>Created by {split.created_by} · {new Date(split.created_at).toLocaleDateString()}</p>
      <div style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>
        Bill total: ₹{items.reduce((sum, item) => sum + Number(item.price), 0).toFixed(2)}
      </div>
      <p style={{ color: '#aaa' }}>Waiting for everyone to confirm...</p>
      <button
        onClick = {loadSelections}
        style={{ padding: '0.4rem 1rem', cursor: 'pointer', marginBottom: '1rem' }}
       >
        Refresh
          
      </button>
      <button
        onClick={() => {
        sessionStorage.removeItem(`confirmed-${id}`)
        setConfirmed(false)}}

        style={{ padding: '0.5rem 1rem', cursor: 'pointer', marginBottom: '1rem' }}
        >
        ← Edit my selection
      </button>

      {isCreator && (
        <button
          onClick={finalizeSplit}
          style={{ display: 'block', padding: '0.6rem 1.5rem', cursor: 'pointer', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '6px', marginBottom: '1rem', fontWeight: 'bold' }}
        >
          🔒 Finalize split (lock for everyone)
        </button>
      )}

      <h3 style={{ marginTop: '1.5rem' }}>Live summary</h3>
      {Object.entries(summary).map(([name, total]) => (
        <div key={name} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid #333' }}>
          <span>{name}</span>
          <strong>₹{total.toFixed(2)}</strong>
        </div>
      ))}

      <h3 style={{ marginTop: '1.5rem' }}>Item breakdown</h3>
      {items.map(item => {
        const who = getItemSelectors(item.id)
        const share = who.length > 0 ? (item.price / who.length).toFixed(2) : item.price
        return (
          <div key={item.id} style={{ marginBottom: '0.75rem', padding: '0.75rem', background: '#c3e3fa', borderRadius: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong>{item.name}</strong>
              <span style={{ color: '#666', fontSize: '0.9rem' }}>x{item.quantity}</span>
              <span>₹{item.price}</span>
            </div>
            <div style={{ fontSize: '0.85rem', color: '#666', marginTop: '0.25rem' }}>
              {who.length > 0 ? `${who.join(', ')} — ₹${share} each` : 'Nobody picked this'}
            </div>
          </div>
        )
      })}
    </div>
  )
}

  return (
    <div style={{ padding: '2rem', maxWidth: '600px', margin: '0 auto' }}>
      <a href={split.group_id ? `/group/${split.group_id}` : '/'} style={{ color: '#888', fontSize: '0.9rem', display: 'inline-block', marginBottom: '1rem' }}>← Back</a>
      <h2>{split.name}</h2>
      <p>Hi {userName}, pick your items:</p>
      {items.map(item => {
        const who = getItemSelectors(item.id)
        return (
          <div
            key={item.id}
            onClick={() => toggleItem(item.id)}
            style={{
              padding: '1rem',
              marginBottom: '0.75rem',
              borderRadius: '8px',
              border: selections[item.id] ? '2px solid #22c55e' : '1px solid #ddd',
              cursor: 'pointer',
              background: selections[item.id] ? '#f0fdf4' : '#ffffff',
              color: '#000'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong>{item.name}</strong>
              <span>₹{item.price}</span>
            </div>
            <div style={{ fontSize: '0.8rem', color: '#aaa', marginTop: '0.25rem' }}>
              {who.length > 0 ? `Picked by: ${who.join(', ')}` : 'Nobody picked this yet'}
            </div>
          </div>
        )
      })}

      <div style={{ marginTop: '1rem', fontSize: '1.1rem' }}>
        Your total: ₹{getMyTotal()}
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem', flexWrap: 'wrap' }}>
        <button
          onClick={confirmSelections}
          style={{ padding: '0.75rem 2rem', fontSize: '1rem', cursor: 'pointer', background: '#22c55e', color: '#fff', border: 'none', borderRadius: '6px' }}
        >
          Confirm my selection
        </button>
        <button
          onClick={markNothing}
          style={{ padding: '0.75rem 1.5rem', fontSize: '1rem', cursor: 'pointer', background: '#fff', color: '#666', border: '1px solid #ddd', borderRadius: '6px' }}
        >
          Nothing here is mine
        </button>
      </div>
    </div>
  )
}