import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { symbolFor } from './currency'

export default function ManualSplit({ user, groupId, onBack }) {
  const [members, setMembers] = useState([])
  const [splitName, setSplitName] = useState('')
  const [total, setTotal] = useState('')
  const [included, setIncluded] = useState({}) // { name: true }
  const [mode, setMode] = useState('even') // 'even' | 'uneven'
  const [customShares, setCustomShares] = useState({}) // { name: amount }
  const [paidBy, setPaidBy] = useState('') // who fronted the money (defaults to creator)
  const [currencyCode, setCurrencyCode] = useState('INR')

  useEffect(() => {
    loadMembers()
  }, [])

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
      const { data: profs } = await supabase
        .from('profiles')
        .select('id, username')
        .in('id', ids)
      ;(profs || []).forEach(p => { nameMap[p.id] = p.username })
    }

    const built = rows.map(r => ({ user_id: r.user_id, name: nameMap[r.user_id] || r.email }))
    setMembers(built)
    const mine = built.find(m => m.user_id === user.id)
    if (mine) setPaidBy(mine.name)

    const { data: g } = await supabase.from('groups').select('currency').eq('id', groupId).maybeSingle()
    if (g?.currency) setCurrencyCode(g.currency)
  }

  const totalNum = parseFloat(total) || 0
  const selectedNames = members.filter(m => included[m.name]).map(m => m.name)
  const evenEach = selectedNames.length > 0 ? totalNum / selectedNames.length : 0
  // uneven: people you typed a value for are "fixed"; everyone else shares the leftover evenly (GPay-style)
  const untouchedNames = selectedNames.filter(n => !(n in customShares))
  const sumEdited = selectedNames
    .filter(n => n in customShares)
    .reduce((s, n) => s + (parseFloat(customShares[n]) || 0), 0)
  const autoEach = untouchedNames.length > 0 ? (totalNum - sumEdited) / untouchedNames.length : 0
  const shareFor = n => (n in customShares ? (parseFloat(customShares[n]) || 0) : autoEach)
  const unevenSum = selectedNames.reduce((s, n) => s + shareFor(n), 0)
  const remaining = totalNum - unevenSum
  const cur = symbolFor(currencyCode) // currency symbol for this group's amounts

  function toggleMember(name) {
    setIncluded(prev => ({ ...prev, [name]: !prev[name] }))
  }

  function setShare(name, value) {
    // empty box → back to auto-split for that person
    setCustomShares(prev => {
      const next = { ...prev }
      if (value === '') delete next[name]
      else next[name] = value
      return next
    })
  }

  async function createSplit() {
    if (!splitName.trim()) { alert('Enter a split name'); return }
    if (totalNum <= 0) { alert('Enter a valid total amount'); return }
    if (selectedNames.length === 0) { alert('Select at least one person'); return }

    const shares = {}
    if (mode === 'even') {
      selectedNames.forEach(n => { shares[n] = evenEach })
    } else {
      if (autoEach < -0.5) {
        alert(`You've assigned ${cur}${sumEdited.toFixed(2)}, which is more than the total ${cur}${totalNum.toFixed(2)}.`)
        return
      }
      if (Math.abs(remaining) > 0.5) {
        alert(`Amounts add up to ${cur}${unevenSum.toFixed(2)}, but the total is ${cur}${totalNum.toFixed(2)}. Make them match.`)
        return
      }
      selectedNames.forEach(n => { shares[n] = shareFor(n) })
    }

    const { data: split, error } = await supabase
      .from('splits')
      .insert({ name: splitName, created_by: user.email, group_id: groupId, split_type: 'manual', paid_by: paidBy, currency: currencyCode })
      .select()
      .single()

    if (error) { alert('Error creating split: ' + error.message); console.error(error); return }

    const rows = selectedNames.map(n => ({
      split_id: split.id,
      item_id: null,
      user_name: n,
      share: parseFloat(shares[n].toFixed(2))
    }))
    await supabase.from('selections').insert(rows)

    // go straight to the in-app summary page
    window.location.href = `/split/${split.id}`
  }

  const unevenBad = autoEach < -0.5 || Math.abs(remaining) > 0.5

  return (
    <div className="page">
      <button onClick={onBack} className="back-link">Back</button>
      <h2>Split manually</h2>

      <div className="mt-2">
        <input
          className="input field"
          placeholder="Split name (e.g. Dinner)"
          value={splitName}
          onChange={e => setSplitName(e.target.value)}
        />
        <input
          className="input"
          type="number"
          placeholder={`Total amount (${cur})`}
          value={total}
          onChange={e => setTotal(e.target.value)}
        />
        {members.length > 0 && (
          <select
            className="input field mt-1"
            value={paidBy}
            onChange={e => setPaidBy(e.target.value)}
          >
            {members.map(m => (
              <option key={m.user_id} value={m.name}>Paid by @{m.name}</option>
            ))}
          </select>
        )}
      </div>

      <h3 className="mt-2">Who's included?</h3>
      {members.length === 0 && <p className="muted">No members found in this group.</p>}
      <div className="card" style={{ padding: '0.5rem 0.9rem' }}>
        {members.map((m, i) => (
          <label key={m.user_id} className="row" style={{ padding: '0.55rem 0', borderTop: i ? '1px solid var(--border)' : 'none', cursor: 'pointer' }}>
            <span className="cluster">
              <input type="checkbox" checked={!!included[m.name]} onChange={() => toggleMember(m.name)} style={{ accentColor: 'var(--accent)', width: '1.05rem', height: '1.05rem' }} />
              <span>@{m.name}</span>
            </span>
            {mode === 'uneven' && included[m.name] && (
              <input
                className="input"
                type="number"
                placeholder={cur}
                value={m.name in customShares ? customShares[m.name] : (autoEach > 0 ? autoEach.toFixed(2) : '')}
                onChange={e => setShare(m.name, e.target.value)}
                style={{ width: '100px', color: m.name in customShares ? 'var(--text)' : 'var(--text-faint)' }}
              />
            )}
            {mode === 'even' && included[m.name] && (
              <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{cur}{evenEach.toFixed(2)}</span>
            )}
          </label>
        ))}
      </div>

      <div className="cluster mt-2" style={{ gap: '0.5rem' }}>
        <button onClick={() => setMode('even')} className={`btn btn-block ${mode === 'even' ? 'btn-primary' : ''}`}>
          Split evenly
        </button>
        <button onClick={() => setMode('uneven')} className={`btn btn-block ${mode === 'uneven' ? 'btn-primary' : ''}`}>
          Split unevenly
        </button>
      </div>

      {mode === 'uneven' && selectedNames.length > 0 && (
        <p className="mt-1" style={{ color: unevenBad ? 'var(--danger)' : 'var(--success)', fontSize: '0.9rem' }}>
          {autoEach < -0.5
            ? `Over by ${cur}${(-remaining).toFixed(2)} — you've assigned more than the total`
            : untouchedNames.length > 0
              ? `${cur}${(totalNum - sumEdited).toFixed(2)} split evenly among ${untouchedNames.length} other${untouchedNames.length > 1 ? 's' : ''}`
              : `Remaining: ${cur}${remaining.toFixed(2)} ${Math.abs(remaining) < 0.5 ? '✓' : `(must reach ${cur}0)`}`}
        </p>
      )}

      <button onClick={createSplit} className="btn btn-lg btn-primary mt-2">
        Create split
      </button>
    </div>
  )
}
