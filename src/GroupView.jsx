import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from './supabase'

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
  }, [id])

  useEffect(() => {
    if (openMenuId === null) return
    const close = () => setOpenMenuId(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [openMenuId])

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

  async function deleteSplit(splitId, e) {
    e.stopPropagation()
    if (!window.confirm('Delete this split? This cannot be undone.')) return

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

  if (authLoading) return <div className="screen-msg">Loading…</div>
  if (!user) return <div className="screen-msg">Please <a href="/">login</a> first.</div>
  if (!group) return <div className="screen-msg">Loading group…</div>

  return (
    <div className="page">
      <a href="/" className="back-link">Back to groups</a>

      <h2>{group.name}</h2>

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

      <div className="section-head">
        <h3 style={{ margin: 0 }}>Splits</h3>
        <button onClick={() => window.location.href = `/?group=${id}`} className="btn btn-sm btn-primary">
          + New split
        </button>
      </div>

      {splits.length === 0 && <p className="muted">No splits yet. Create one!</p>}

      {splits.map(split => (
        <div key={split.id} onClick={() => window.location.href = `/split/${split.id}`} className="card card-tap">
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
                      onClick={e => { setOpenMenuId(null); deleteSplit(split.id, e) }}
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

      <div className="mt-2" style={{ marginTop: '3rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border)' }}>
        <button onClick={leaveGroup} className="btn btn-sm btn-danger-outline">
          Leave group
        </button>
      </div>
    </div>
  )
}
