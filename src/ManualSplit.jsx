import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export default function ManualSplit({ user, groupId, onBack }) {
  const [members, setMembers] = useState([])
  const [splitName, setSplitName] = useState('')
  const [total, setTotal] = useState('')
  const [included, setIncluded] = useState({}) // { name: true }
  const [mode, setMode] = useState('even') // 'even' | 'uneven'
  const [customShares, setCustomShares] = useState({}) // { name: amount }

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

    setMembers(rows.map(r => ({ user_id: r.user_id, name: nameMap[r.user_id] || r.email })))
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
        alert(`You've assigned ₹${sumEdited.toFixed(2)}, which is more than the total ₹${totalNum.toFixed(2)}.`)
        return
      }
      if (Math.abs(remaining) > 0.5) {
        alert(`Amounts add up to ₹${unevenSum.toFixed(2)}, but the total is ₹${totalNum.toFixed(2)}. Make them match.`)
        return
      }
      selectedNames.forEach(n => { shares[n] = shareFor(n) })
    }

    const { data: split, error } = await supabase
      .from('splits')
      .insert({ name: splitName, created_by: user.email, group_id: groupId, split_type: 'manual' })
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

  return (
    <div style={{ padding: '2rem', maxWidth: '600px', margin: '0 auto' }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', marginBottom: '1rem' }}>
        ← Back
      </button>
      <h1>Split manually</h1>

      <input
        placeholder="Split name (e.g. Dinner)"
        value={splitName}
        onChange={e => setSplitName(e.target.value)}
        style={{ width: '100%', padding: '0.6rem', marginBottom: '1rem', boxSizing: 'border-box' }}
      />

      <input
        type="number"
        placeholder="Total amount (₹)"
        value={total}
        onChange={e => setTotal(e.target.value)}
        style={{ width: '100%', padding: '0.6rem', marginBottom: '1.5rem', boxSizing: 'border-box' }}
      />

      <h3>Who's included?</h3>
      {members.length === 0 && <p style={{ color: '#888' }}>No members found in this group.</p>}
      {members.map(m => (
        <label key={m.user_id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={!!included[m.name]} onChange={() => toggleMember(m.name)} />
          <span>@{m.name}</span>
          {mode === 'uneven' && included[m.name] && (
            <input
              type="number"
              placeholder="₹"
              value={m.name in customShares ? customShares[m.name] : (autoEach > 0 ? autoEach.toFixed(2) : '')}
              onChange={e => setShare(m.name, e.target.value)}
              style={{ width: '90px', padding: '0.3rem', marginLeft: 'auto', color: m.name in customShares ? '#000' : '#999' }}
            />
          )}
          {mode === 'even' && included[m.name] && (
            <span style={{ marginLeft: 'auto', color: '#16a34a' }}>₹{evenEach.toFixed(2)}</span>
          )}
        </label>
      ))}

      <div style={{ margin: '1.5rem 0', display: 'flex', gap: '0.5rem' }}>
        <button
          onClick={() => setMode('even')}
          style={{ flex: 1, padding: '0.5rem', cursor: 'pointer', background: mode === 'even' ? '#22c55e' : '#fff', color: mode === 'even' ? '#fff' : '#000', border: '1px solid #ddd', borderRadius: '6px' }}
        >
          Split evenly
        </button>
        <button
          onClick={() => setMode('uneven')}
          style={{ flex: 1, padding: '0.5rem', cursor: 'pointer', background: mode === 'uneven' ? '#22c55e' : '#fff', color: mode === 'uneven' ? '#fff' : '#000', border: '1px solid #ddd', borderRadius: '6px' }}
        >
          Split unevenly
        </button>
      </div>

      {mode === 'uneven' && selectedNames.length > 0 && (
        <div style={{ marginBottom: '1rem', color: autoEach < -0.5 || Math.abs(remaining) > 0.5 ? '#ef4444' : '#16a34a' }}>
          {autoEach < -0.5
            ? `Over by ₹${(-remaining).toFixed(2)} — you've assigned more than the total`
            : untouchedNames.length > 0
              ? `₹${(totalNum - sumEdited).toFixed(2)} split evenly among ${untouchedNames.length} other${untouchedNames.length > 1 ? 's' : ''}`
              : `Remaining: ₹${remaining.toFixed(2)} ${Math.abs(remaining) < 0.5 ? '✓' : '(must reach ₹0)'}`}
        </div>
      )}

      <button
        onClick={createSplit}
        style={{ padding: '0.75rem 2rem', fontSize: '1rem', cursor: 'pointer', background: '#22c55e', color: '#fff', border: 'none', borderRadius: '6px' }}
      >
        Create split
      </button>
    </div>
  )
}
