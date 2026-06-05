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

  if (authLoading) return <div style={{ padding: '2rem' }}>Loading...</div>
  if (!user) return <div style={{ padding: '2rem' }}>Please <a href="/">login</a> first.</div>
  if (!group) return <div style={{ padding: '2rem' }}>Loading group...</div>

  return (
    <div style={{ padding: '2rem', maxWidth: '600px', margin: '0 auto' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <a href="/" style={{ color: '#888', fontSize: '0.9rem' }}>← Back to groups</a>
      </div>

      <h2>{group.name}</h2>

      <div style={{ marginBottom: '2rem' }}>
        <h3>Members</h3>
        {members.map(m => (
          <div key={m.id} style={{ padding: '0.4rem 0', borderBottom: '1px solid #eee', fontSize: '0.9rem', display: 'flex', justifyContent: 'space-between' }}>
            <span>{m.username ? `@${m.username}` : m.email} {m.user_id === user.id ? '(you)' : ''}</span>
            {m.status === 'pending' && <span style={{ color: '#f59e0b', fontSize: '0.8rem' }}>⏳ pending</span>}
          </div>
        ))}

        <div style={{ marginTop: '1rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              placeholder="Search by username"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && searchUsers()}
              style={{ flex: 1, padding: '0.5rem' }}
            />
            <button onClick={searchUsers} style={{ padding: '0.5rem 1rem', cursor: 'pointer' }}>
              {searching ? '...' : 'Search'}
            </button>
          </div>

          {searchResults.map(p => (
            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem', marginTop: '0.5rem', border: '1px solid #eee', borderRadius: '6px' }}>
              <span>@{p.username}</span>
              <button onClick={() => invite(p)} style={{ padding: '0.3rem 0.75rem', cursor: 'pointer', background: '#22c55e', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '0.85rem' }}>
                Invite
              </button>
            </div>
          ))}
          {searchQuery && !searching && searchResults.length === 0 && (
            <p style={{ color: '#888', fontSize: '0.85rem', marginTop: '0.5rem' }}>No users found</p>
          )}
        </div>

        <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px dashed #ddd' }}>
          <button
            onClick={() => {
              const link = `${window.location.origin}/join/${id}`
              navigator.clipboard.writeText(link)
              alert('Invite link copied! Share it on WhatsApp etc.')
            }}
            style={{ padding: '0.5rem 1rem', cursor: 'pointer', background: '#f3f4f6', border: '1px solid #ddd', borderRadius: '6px', fontSize: '0.9rem' }}
          >
            🔗 Copy invite link
          </button>
          <p style={{ color: '#aaa', fontSize: '0.75rem', marginTop: '0.4rem' }}>
            Anyone with this link can join the group.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3 style={{ margin: 0 }}>Splits</h3>
        <button
          onClick={() => window.location.href = `/?group=${id}`}
          style={{ padding: '0.5rem 1rem', cursor: 'pointer', background: '#22c55e', color: '#fff', border: 'none', borderRadius: '6px' }}
        >
          + New split
        </button>
      </div>

      {splits.length === 0 && <p style={{ color: '#888' }}>No splits yet. Create one!</p>}

      {splits.map(split => (
        <div
          key={split.id}
          onClick={() => window.location.href = `/split/${split.id}`}
          style={{ padding: '1rem', marginBottom: '0.75rem', border: '1px solid #ddd', borderRadius: '8px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <div>
            <strong>{split.name}</strong>
            {actionSplits.has(split.id) && (
              <span style={{ background: '#ef4444', color: '#fff', fontSize: '0.7rem', padding: '0.15rem 0.5rem', borderRadius: '10px', marginLeft: '0.5rem', whiteSpace: 'nowrap' }}>
                Action required
              </span>
            )}
            <div style={{ fontSize: '0.8rem', color: '#888', marginTop: '0.25rem' }}>
              By {split.created_by} · {new Date(split.created_at).toLocaleDateString()}
            </div>
          </div>

          {split.created_by === user.email && (
            <div style={{ position: 'relative' }}>
              <button
                onClick={e => {
                  e.stopPropagation()
                  setOpenMenuId(openMenuId === split.id ? null : split.id)
                }}
                style={{ padding: '0.25rem 0.6rem', cursor: 'pointer', background: 'transparent', border: 'none', fontSize: '1.3rem', lineHeight: 1, color: '#666' }}
              >
                ⋮
              </button>

              {openMenuId === split.id && (
                <div style={{ position: 'absolute', right: 0, top: '100%', background: '#fff', border: '1px solid #ddd', borderRadius: '6px', boxShadow: '0 2px 8px rgba(0,0,0,0.15)', zIndex: 10, minWidth: '120px' }}>
                  <button
                    onClick={e => {
                      setOpenMenuId(null)
                      deleteSplit(split.id, e)
                    }}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.6rem 1rem', cursor: 'pointer', background: 'transparent', border: 'none', color: '#ef4444', fontSize: '0.9rem' }}
                  >
                    🗑 Delete
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      <div style={{ marginTop: '3rem', paddingTop: '1.5rem', borderTop: '1px solid #eee' }}>
        <button
          onClick={leaveGroup}
          style={{ padding: '0.5rem 1.25rem', cursor: 'pointer', background: '#fff', color: '#ef4444', border: '1px solid #ef4444', borderRadius: '6px', fontSize: '0.9rem' }}
        >
          Leave group
        </button>
      </div>
    </div>
  )
}