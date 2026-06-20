import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from './supabase'
import { symbolFor, CURRENCIES } from './currency'

export default function GroupView() {
  const { id } = useParams()
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [group, setGroup] = useState(null)
  const [members, setMembers] = useState([])
  const [splits, setSplits] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [openMenuId, setOpenMenuId] = useState(null)
  const [myUsername, setMyUsername] = useState(null)
  const [actionSplits, setActionSplits] = useState(new Set())
  const [creatorNames, setCreatorNames] = useState({}) // email -> @username
  const [editingName, setEditingName] = useState(false) // group-name inline edit
  const [nameInput, setNameInput] = useState('')
  const [tab, setTab] = useState('splits') // 'splits' | 'expenses'
  const [groupSelections, setGroupSelections] = useState([]) // all selections across the group's splits
  const [settlements, setSettlements] = useState([]) // repayments (pending/confirmed)
  const [openBalMenu, setOpenBalMenu] = useState(null) // which balance row's ⋮ is open
  const [deleteTarget, setDeleteTarget] = useState(null) // split pending delete-confirm
  const [settingsOpen, setSettingsOpen] = useState(false) // group ⋮ settings menu
  const [settingsSection, setSettingsSection] = useState(null) // null | 'currency'

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setUser(session?.user || null)
      setAuthLoading(false)
      if (session?.user) {
        const { data: p } = await supabase
          .from('profiles')
          .select('username')
          .eq('id', session.user.id)
          .maybeSingle()
        setMyUsername(p?.username || null)
      }
    })
  }, [])

  useEffect(() => {
    computeActions()
  }, [splits, myUsername])

  // pull every selection in the group so the Expenses tab can net balances
  useEffect(() => {
    if (!splits.length) { setGroupSelections([]); return }
    loadGroupSelections()
  }, [splits])

  async function loadGroupSelections() {
    const ids = splits.map(s => s.id)
    const { data } = await supabase
      .from('selections')
      .select('split_id, user_name, share')
      .in('split_id', ids)
    setGroupSelections(data || [])
  }

  async function loadSettlements() {
    const { data } = await supabase.from('settlements').select('*').eq('group_id', id)
    setSettlements(data || [])
  }

  // debtor marks a debt as paid back → creates a PENDING settlement for the creditor to confirm
  async function settleUp(other, amount) {
    if (!myUsername) return
    const { error } = await supabase.from('settlements').insert({
      group_id: id, from_user: myUsername, to_user: other,
      amount: Number(amount.toFixed(2)), status: 'pending'
    })
    if (error) { alert('Could not record settle-up: ' + error.message); return }
    loadSettlements()
  }

  // creditor confirms they received the money → settlement becomes CONFIRMED and clears the balance
  async function confirmSettlement(settlementId) {
    const { error } = await supabase.from('settlements')
      .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
      .eq('id', settlementId)
    if (error) { alert('Could not confirm: ' + error.message); return }
    loadSettlements()
  }

  // debtor cancels a pending settle-up they sent by mistake
  async function cancelSettlement(settlementId) {
    await supabase.from('settlements').delete().eq('id', settlementId)
    loadSettlements()
  }

  // Net "who owes whom" from the current user's point of view.
  // For each split, the payer (paid_by, or the creator as fallback) is owed each
  // other person's share; we sum across splits, then net the two directions.
  function getBalances() {
    const me = myUsername
    if (!me) return []

    const payerOf = {}
    splits.forEach(s => {
      let p = s.paid_by
      if (!p) {
        const resolved = creatorNames[s.created_by] // "@username" or undefined
        p = resolved ? resolved.replace(/^@/, '') : s.created_by
      }
      payerOf[s.id] = p
    })

    const owe = {} // owe[debtor][creditor] = amount
    const add = (debtor, creditor, amt) => {
      if (debtor === creditor) return
      owe[debtor] = owe[debtor] || {}
      owe[debtor][creditor] = (owe[debtor][creditor] || 0) + amt
    }
    groupSelections.forEach(sel => {
      const payer = payerOf[sel.split_id]
      const amt = Number(sel.share)
      if (!payer || !amt || amt <= 0 || sel.user_name === payer) return
      add(sel.user_name, payer, amt)
    })

    // confirmed repayments reduce the debt from→to (may go negative = overpaid)
    settlements.filter(s => s.status === 'confirmed').forEach(s => {
      owe[s.from_user] = owe[s.from_user] || {}
      owe[s.from_user][s.to_user] = (owe[s.from_user][s.to_user] || 0) - Number(s.amount)
    })

    const people = new Set()
    groupSelections.forEach(s => people.add(s.user_name))
    Object.values(payerOf).forEach(p => p && people.add(p))
    settlements.forEach(s => { people.add(s.from_user); people.add(s.to_user) })
    people.delete(me)

    const lines = []
    people.forEach(other => {
      const iOwe = owe[me]?.[other] || 0
      const theyOwe = owe[other]?.[me] || 0
      const net = theyOwe - iOwe // positive → they owe me
      if (Math.abs(net) >= 0.01) lines.push({ other, net })
    })
    return lines.sort((a, b) => b.net - a.net)
  }

  async function computeActions() {
    if (!myUsername) { setActionSplits(new Set()); return }
    // open scan splits the current user hasn't acted on yet
    const scanIds = splits.filter(s => s.split_type !== 'manual' && !s.finalized).map(s => s.id)
    if (scanIds.length === 0) { setActionSplits(new Set()); return }

    const { data } = await supabase
      .from('selections')
      .select('split_id')
      .in('split_id', scanIds)
      .eq('user_name', myUsername)

    const acted = new Set((data || []).map(r => r.split_id))
    setActionSplits(new Set(scanIds.filter(sid => !acted.has(sid))))
  }

  useEffect(() => {
    if (!id) return
    loadGroup()
    loadMembers()
    loadSplits()
    loadSettlements()
  }, [id])

  useEffect(() => {
    if (openMenuId === null) return
    const close = () => setOpenMenuId(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [openMenuId])

  useEffect(() => {
    if (openBalMenu === null) return
    const close = () => setOpenBalMenu(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [openBalMenu])

  useEffect(() => {
    if (!settingsOpen) return
    const close = () => { setSettingsOpen(false); setSettingsSection(null) }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [settingsOpen])

  async function loadGroup() {
    const { data } = await supabase.from('groups').select('*').eq('id', id).single()
    setGroup(data)
  }

  async function loadMembers() {
    const { data } = await supabase.from('group_members').select('*').eq('group_id', id)
    const rows = data || []

    // look up usernames for these members (group_members only stores email)
    const ids = rows.map(r => r.user_id)
    const nameMap = {}
    if (ids.length) {
      const { data: profs } = await supabase
        .from('profiles')
        .select('id, username')
        .in('id', ids)
      ;(profs || []).forEach(p => { nameMap[p.id] = p.username })
    }

    setMembers(rows.map(r => ({ ...r, username: nameMap[r.user_id] })))
  }

  async function loadSplits() {
    const { data } = await supabase
      .from('splits')
      .select('*')
      .eq('group_id', id)
      .order('created_at', { ascending: false })
    setSplits(data || [])

    // created_by stores emails — map each distinct creator email to their @username
    const emails = [...new Set((data || []).map(s => s.created_by).filter(Boolean))]
    if (emails.length) {
      const { data: profs } = await supabase
        .from('profiles')
        .select('email, username')
        .in('email', emails)
      const map = {}
      ;(profs || []).forEach(p => { if (p.username) map[p.email] = `@${p.username}` })
      setCreatorNames(map)
    }
  }

  async function leaveGroup() {
    if (!window.confirm('Leave this group? You can rejoin later with an invite or link.')) return
    await supabase
      .from('group_members')
      .delete()
      .eq('group_id', id)
      .eq('user_id', user.id)
    window.location.href = '/'
  }

  // actually delete the split that's pending confirmation in the modal
  async function confirmDeleteSplit() {
    const splitId = deleteTarget?.id
    setDeleteTarget(null)
    if (!splitId) return

    // remove child rows first (no orphans), then the split
    await supabase.from('selections').delete().eq('split_id', splitId)
    await supabase.from('items').delete().eq('split_id', splitId)
    const { data, error } = await supabase.from('splits').delete().eq('id', splitId).select()
    if (error) {
      alert('Could not delete split: ' + error.message)
      return
    }
    if (!data || data.length === 0) {
      alert('Nothing was deleted — a database rule (RLS) is blocking it. We will fix this in the security step.')
      return
    }
    loadSplits()
  }

  async function searchUsers() {
    const q = searchQuery.trim().toLowerCase()
    if (!q) { setSearchResults([]); return }

    setSearching(true)
    const { data } = await supabase
      .from('profiles')
      .select('id, username, email')
      .ilike('username', `%${q}%`)
      .limit(10)
    setSearchResults(data || [])
    setSearching(false)
  }

  async function invite(profile) {
    const already = members.find(m => m.user_id === profile.id)
    if (already) { alert('Already invited or a member'); return }

    await supabase.from('group_members').insert({
      group_id: id,
      user_id: profile.id,
      email: profile.email,
      status: 'pending'
    })

    setSearchQuery('')
    setSearchResults([])
    loadMembers()
    alert(`Invited @${profile.username}`)
  }

  // rename a split — creator only (the ⋮ menu is already creator-gated)
  async function renameSplit(split, e) {
    e.stopPropagation()
    setOpenMenuId(null)
    const next = window.prompt('Rename split', split.name)?.trim()
    if (!next || next === split.name) return
    const { error } = await supabase.from('splits').update({ name: next }).eq('id', split.id)
    if (error) { alert('Could not rename: ' + error.message); return }
    loadSplits()
  }

  // rename the group — ANY member can do this (user's call)
  async function saveGroupName() {
    const next = nameInput.trim()
    setEditingName(false)
    if (!next || next === group.name) return
    const { error } = await supabase.from('groups').update({ name: next }).eq('id', id)
    if (error) { alert('Could not rename group: ' + error.message); return }
    setGroup(prev => ({ ...prev, name: next }))
  }

  // change the group's currency — any member can (the "group override")
  async function saveGroupCurrency(code) {
    const { error } = await supabase.from('groups').update({ currency: code }).eq('id', id)
    if (error) { alert('Could not change currency: ' + error.message); return }
    setGroup(prev => ({ ...prev, currency: code }))
  }

  if (authLoading) return <div className="screen-msg">Loading…</div>
  if (!user) return <div className="screen-msg">Please <a href="/">login</a> first.</div>
  if (!group) return <div className="screen-msg">Loading group…</div>

  const cur = symbolFor(group.currency) // group currency governs all amounts here

  return (
    <div className="page">
      {deleteTarget && (
        <div
          onClick={() => setDeleteTarget(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: '1rem' }}
        >
          <div onClick={e => e.stopPropagation()} className="card" style={{ maxWidth: '360px', width: '100%' }}>
            <h3 style={{ marginTop: 0 }}>Delete split?</h3>
            <p className="muted" style={{ marginTop: '-0.2rem' }}>
              <strong>{deleteTarget.name}</strong> and all its items and selections will be permanently removed. 
            </p>
            <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1.2rem' }}>
              <button onClick={() => setDeleteTarget(null)} className="btn" style={{ flex: 1 }}>Cancel</button>
              <button onClick={confirmDeleteSplit} className="btn btn-danger" style={{ flex: 1 }}>Delete</button>
            </div>
          </div>
        </div>
      )}

      <a href="/" className="back-link">Back to groups</a>

      {editingName ? (
        <div className="cluster mt-1" style={{ alignItems: 'stretch' }}>
          <input
            className="input"
            autoFocus
            value={nameInput}
            onChange={e => setNameInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') saveGroupName(); if (e.key === 'Escape') setEditingName(false) }}
          />
          <button onClick={saveGroupName} className="btn btn-sm btn-primary">Save</button>
          <button onClick={() => setEditingName(false)} className="btn btn-sm">Cancel</button>
        </div>
      ) : (
        <div className="cluster" style={{ justifyContent: 'space-between', position: 'relative', zIndex: 100 }}>
          <h2 style={{ margin: 0 }}>{group.name}</h2>
          <div style={{ position: 'relative' }}>
            <button
              onClick={e => { e.stopPropagation(); setSettingsOpen(o => !o); setSettingsSection(null) }}
              title="Group settings"
              aria-label="Group settings"
              style={{
                width: '36px', height: '36px', flexShrink: 0,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: 'var(--accent-soft)', color: 'var(--accent)',
                border: 'none', borderRadius: 'var(--radius-pill)',
                fontSize: '1.4rem', lineHeight: 1, fontWeight: 700, cursor: 'pointer'
              }}
            >
              ⋮
            </button>
            {settingsOpen && (
              <div className="menu" style={{ right: 0, minWidth: '220px' }} onClick={e => e.stopPropagation()}>
                <button
                  onClick={() => { setSettingsOpen(false); setSettingsSection(null); setNameInput(group.name); setEditingName(true) }}
                  className="menu-item"
                >
                  ✏️ Rename group
                </button>
                <button
                  onClick={() => setSettingsSection(s => s === 'currency' ? null : 'currency')}
                  className="menu-item"
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)' }}
                >
                  <span>Currency</span>
                  <span className="faint">{settingsSection === 'currency' ? '▾' : '▸'}</span>
                </button>
                {settingsSection === 'currency' && (
                  <div style={{ padding: '0.2rem 0.8rem 0.6rem' }}>
                    <select
                      className="input"
                      value={group.currency || 'INR'}
                      onChange={e => saveGroupCurrency(e.target.value)}
                      style={{ width: '100%' }}
                    >
                      {CURRENCIES.map(c => (
                        <option key={c.code} value={c.code}>{c.symbol} {c.code} — {c.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mt-2">
        <h3 style={{ marginBottom: '0.6rem' }}>Members</h3>
        <div className="card">
          {members.map((m, i) => (
            <div key={m.id} className="row" style={{ padding: '0.5rem 0', borderTop: i ? '1px solid var(--border)' : 'none' }}>
              <span>{m.username ? `@${m.username}` : m.email} {m.user_id === user.id ? <span className="faint">(you)</span> : ''}</span>
              {m.status === 'pending' && <span className="badge badge-warning">⏳ pending</span>}
            </div>
          ))}
        </div>

        <div className="cluster mt-1" style={{ alignItems: 'stretch' }}>
          <input
            className="input"
            placeholder="Search by username"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && searchUsers()}
          />
          <button onClick={searchUsers} className="btn">
            {searching ? '…' : 'Search'}
          </button>
        </div>

        {searchResults.map(p => (
          <div key={p.id} className="line mt-1">
            <span>@{p.username}</span>
            <button onClick={() => invite(p)} className="btn btn-sm btn-success">Invite</button>
          </div>
        ))}
        {searchQuery && !searching && searchResults.length === 0 && (
          <p className="faint mt-1">No users found</p>
        )}

        <div className="mt-2" style={{ paddingTop: '1rem', borderTop: '1px dashed var(--border-strong)' }}>
          <button
            onClick={() => {
              const link = `${window.location.origin}/join/${id}`
              navigator.clipboard.writeText(link)
              alert('Invite link copied! Share it on WhatsApp etc.')
            }}
            className="btn btn-sm"
          >
            🔗 Copy invite link
          </button>
          <p className="faint" style={{ marginTop: '0.4rem' }}>
            Anyone with this link can join the group.
          </p>
        </div>
      </div>

      <div className="cluster mt-2" style={{ gap: '0.5rem' }}>
        <button onClick={() => setTab('splits')} className={`btn btn-block ${tab === 'splits' ? 'btn-primary' : ''}`}>Splits</button>
        <button onClick={() => setTab('expenses')} className={`btn btn-block ${tab === 'expenses' ? 'btn-primary' : ''}`}>Expenses</button>
      </div>

      {tab === 'splits' && (<>
      <div className="section-head">
        <h3 style={{ margin: 0 }}>Splits</h3>
        <button onClick={() => window.location.href = `/?group=${id}`} className="btn btn-sm btn-primary">
          + New split
        </button>
      </div>

      {splits.length === 0 && <p className="muted">No splits yet. Create one!</p>}

      {splits.map(split => (
        <div
          key={split.id}
          onClick={() => window.location.href = `/split/${split.id}`}
          className="card card-tap"
          style={openMenuId === split.id ? { position: 'relative', zIndex: 50 } : undefined}
        >
          <div className="row">
            <div>
              <div className="cluster">
                <span className="card-title">{split.name}</span>
                {actionSplits.has(split.id) && (
                  <span className="badge badge-danger">● Action required</span>
                )}
              </div>
              <div className="card-sub">
                By {creatorNames[split.created_by] || split.created_by} · {new Date(split.created_at).toLocaleDateString()}
              </div>
            </div>

            {split.created_by === user.email && (
              <div style={{ position: 'relative' }}>
                <button
                  onClick={e => {
                    e.stopPropagation()
                    setOpenMenuId(openMenuId === split.id ? null : split.id)
                  }}
                  className="btn-ghost"
                  style={{ fontSize: '1.3rem', lineHeight: 1, padding: '0.1rem 0.5rem', cursor: 'pointer', background: 'none', border: 'none' }}
                >
                  ⋮
                </button>

                {openMenuId === split.id && (
                  <div className="menu">
                    <button
                      onClick={e => renameSplit(split, e)}
                      className="menu-item"
                    >
                      ✏️ Rename
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); setOpenMenuId(null); setDeleteTarget(split) }}
                      className="menu-item menu-item-danger"
                    >
                      🗑 Delete
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ))}
      </>)}

      {tab === 'expenses' && (() => {
        const lines = getBalances()
        const owedToMe = lines.filter(l => l.net > 0).reduce((s, l) => s + l.net, 0)
        const iOweTotal = lines.filter(l => l.net < 0).reduce((s, l) => s - l.net, 0)
        const net = owedToMe - iOweTotal
        return (
          <div className="mt-2">
            {!myUsername && <p className="muted">Log in to see your balances.</p>}
            {myUsername && lines.length === 0 && <p className="muted">All settled up !</p>}
            {myUsername && lines.length > 0 && (
              <>
                <div className="amount-hero">
                  <div className="lbl">{net >= 0 ? 'You are owed ' : 'You owe '}</div>
                  <div className="val" style={{ color: net >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                    {cur}{Math.abs(net).toFixed(2)}
                  </div>
                </div>
                <div className="mt-2">
                  {lines.map(l => {
                    const out = settlements.find(s => s.status === 'pending' && s.from_user === myUsername && s.to_user === l.other)
                    const inc = settlements.find(s => s.status === 'pending' && s.from_user === l.other && s.to_user === myUsername)
                    return (
                      <div key={l.other} className="card" style={{ padding: '0.75rem 0.9rem' }}>
                        <div className="row">
                          <span className="cluster">
                            <span className="avatar-sm">{l.other.trim().charAt(0).toUpperCase()}</span>
                            {l.other}
                          </span>
                          <span className="cluster">
                            {l.net > 0
                              ? <strong style={{ color: 'var(--success)' }}>owes you {cur}{l.net.toFixed(2)}</strong>
                              : <strong style={{ color: 'var(--danger)' }}>you owe {cur}{(-l.net).toFixed(2)}</strong>}
                            {/* ⋮ menu — only when I owe them (settle up lives here, on purpose) */}
                            {l.net < 0 && (
                              <div style={{ position: 'relative' }}>
                                <button
                                  onClick={e => { e.stopPropagation(); setOpenBalMenu(openBalMenu === l.other ? null : l.other) }}
                                  className="btn-ghost"
                                  style={{ fontSize: '1.3rem', lineHeight: 1, padding: '0.1rem 0.5rem', cursor: 'pointer', background: 'none', border: 'none' }}
                                >
                                  ⋮
                                </button>
                                {openBalMenu === l.other && (
                                  <div className="menu">
                                    {out
                                      ? <button onClick={() => { setOpenBalMenu(null); cancelSettlement(out.id) }} className="menu-item menu-item-danger">
                                          ✕ Cancel settle-up
                                        </button>
                                      : <button onClick={() => { setOpenBalMenu(null); settleUp(l.other, -l.net) }} className="menu-item">
                                          💸 Settle up {cur}{(-l.net).toFixed(2)}
                                        </button>}
                                  </div>
                                )}
                              </div>
                            )}
                          </span>
                        </div>

                        {/* waiting note once a settle-up is sent */}
                        {l.net < 0 && out && (
                          <p className="faint mt-1" style={{ margin: '0.4rem 0 0' }}>
                            ⏳ Waiting for @{l.other} to confirm {cur}{Number(out.amount).toFixed(2)}
                          </p>
                        )}

                        {/* incoming repayment to confirm — kept visible so the payee notices */}
                        {l.net > 0 && inc && (
                          <div className="cluster mt-1" style={{ flexWrap: 'wrap' }}>
                            <span className="faint">@{l.other} marked {cur}{Number(inc.amount).toFixed(2)} as paid</span>
                            <button onClick={() => confirmSettlement(inc.id)} className="btn btn-sm btn-success">Confirm received</button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        )
      })()}

      <div className="mt-2" style={{ marginTop: '3rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border)' }}>
        <button onClick={leaveGroup} className="btn btn-sm btn-danger-outline">
          Leave group
        </button>
      </div>
    </div>
  )
}
