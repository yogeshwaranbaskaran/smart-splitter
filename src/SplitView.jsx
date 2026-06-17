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
  const [currentEmail, setCurrentEmail] = useState(null)
  const [creatorName, setCreatorName] = useState(null)

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

    // created_by stores an email — look up the creator's @username to show instead
    if (splitData?.created_by) {
      const { data: prof } = await supabase
        .from('profiles')
        .select('username')
        .eq('email', splitData.created_by)
        .maybeSingle()
      setCreatorName(prof?.username ? `@${prof.username}` : splitData.created_by)
    }
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

  const backHref = split && (split.group_id ? `/group/${split.group_id}` : '/')

  if (!split) return <div className="screen-msg">Loading…</div>

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
          <div className="val">₹{total.toFixed(2)}</div>
        </div>

        <h3 className="mt-2" style={{ marginBottom: '0.6rem' }}>Who owes what</h3>
        {allSelections.map(s => (
          <div key={s.id} className="line">
            <span className="cluster">
              <span className="avatar-sm">{s.user_name.trim().charAt(0).toUpperCase()}</span>
              {s.user_name}
            </span>
            <strong>₹{Number(s.share).toFixed(2)}</strong>
          </div>
        ))}
      </div>
    )
  }

  const isCreator = currentEmail && currentEmail === split.created_by
  const billTotal = items.reduce((sum, item) => sum + Number(item.price), 0).toFixed(2)

  // shared: who-owes-what + item breakdown blocks
  function OwesAndBreakdown(summary) {
    return (
      <>
        <h3 className="mt-2" style={{ marginBottom: '0.6rem' }}>Who owes what</h3>
        {Object.entries(summary).map(([name, total]) => (
          <div key={name} className="line">
            <span className="cluster">
              <span className="avatar-sm">{name.trim().charAt(0).toUpperCase()}</span>
              {name}
            </span>
            <strong>₹{total.toFixed(2)}</strong>
          </div>
        ))}

        <h3 className="mt-2" style={{ marginBottom: '0.6rem' }}>Item breakdown</h3>
        {items.map(item => {
          const who = getItemSelectors(item.id)
          const share = who.length > 0 ? (item.price / who.length).toFixed(2) : item.price
          return (
            <div key={item.id} className="bill-item">
              <div className="row">
                <strong>{item.name}</strong>
                <span>₹{item.price}</span>
              </div>
              <div className="card-sub">
                {who.length > 0 ? `${who.join(', ')} — ₹${share} each` : 'Nobody picked this'}
              </div>
            </div>
          )
        })}
      </>
    )
  }

  if (split.finalized) {
    const summary = {}
    allSelections.forEach(s => {
      const item = items.find(i => i.id === s.item_id)
      if (!item) return
      const pickers = allSelections.filter(x => x.item_id === s.item_id)
      summary[s.user_name] = (summary[s.user_name] || 0) + item.price / pickers.length
    })

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
          <div className="val">₹{billTotal}</div>
        </div>
        {OwesAndBreakdown(summary)}
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

  if (confirmed) {
    const summary = {}
    allSelections.forEach(s => {
      const item = items.find(i => i.id === s.item_id)
      if (!item) return
      const pickers = allSelections.filter(x => x.item_id === s.item_id)
      summary[s.user_name] = (summary[s.user_name] || 0) + item.price / pickers.length
    })

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
          <div className="val">₹{billTotal}</div>
        </div>
        <p className="muted mt-1">Waiting for everyone to confirm…</p>

        <div className="cluster mt-1" style={{ flexWrap: 'wrap' }}>
          <button onClick={loadSelections} className="btn btn-sm">Refresh</button>
          <button
            onClick={() => { sessionStorage.removeItem(`confirmed-${id}`); setConfirmed(false) }}
            className="btn btn-sm"
          >
            ← Edit my selection
          </button>
        </div>

        {isCreator && (
          <button onClick={finalizeSplit} className="btn btn-danger btn-block mt-2">
            🔒 Finalize split (lock for everyone)
          </button>
        )}

        {OwesAndBreakdown(summary)}
      </div>
    )
  }

  return (
    <div className="page">
      <a href={backHref} className="back-link">Back</a>
      <h2>{split.name}</h2>
      <p className="muted mt-1">Hi {userName}, pick your items:</p>

      <div className="mt-1">
        {items.map(item => {
          const who = getItemSelectors(item.id)
          return (
            <div
              key={item.id}
              onClick={() => toggleItem(item.id)}
              className={`pick ${selections[item.id] ? 'pick-on' : ''}`}
            >
              <div className="row">
                <strong>{item.name}</strong>
                <span>₹{item.price}</span>
              </div>
              <div className="faint" style={{ marginTop: '0.25rem' }}>
                {who.length > 0 ? `Picked by: ${who.join(', ')}` : 'Nobody picked this yet'}
              </div>
            </div>
          )
        })}
      </div>

      <div className="row mt-1" style={{ fontSize: '1.1rem', fontWeight: 700 }}>
        <span>Your total</span>
        <span>₹{getMyTotal()}</span>
      </div>

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
