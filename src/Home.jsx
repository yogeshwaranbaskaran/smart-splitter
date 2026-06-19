import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from './supabase'

// same rule as SetUsername.jsx: 3-20 chars, lowercase letters, numbers, underscore
const USERNAME_RE = /^[a-z0-9_]{3,20}$/

export default function Home({ user, profile }) {
  const [groups, setGroups] = useState([])
  const [invites, setInvites] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [actionGroups, setActionGroups] = useState(new Set())
  const [menuOpen, setMenuOpen] = useState(false)        // profile dropdown
  const [editing, setEditing] = useState(false)          // username edit modal
  const [newName, setNewName] = useState('')
  const [unameErr, setUnameErr] = useState('')
  const [savingName, setSavingName] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    loadGroups()
    loadInvites()
  }, [])

  useEffect(() => {
    computeActionGroups()
  }, [groups])

  // close the profile dropdown when clicking anywhere else
  useEffect(() => {
    if (!menuOpen) return
    const close = () => setMenuOpen(false)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [menuOpen])

  async function computeActionGroups() {
    const username = profile?.username
    if (!username || groups.length === 0) { setActionGroups(new Set()); return }

    const groupIds = groups.map(g => g.id)
    const { data: gSplits } = await supabase
      .from('splits')
      .select('id, group_id, split_type, finalized')
      .in('group_id', groupIds)

    const scan = (gSplits || []).filter(s => s.split_type !== 'manual' && !s.finalized)
    const ids = scan.map(s => s.id)

    let acted = new Set()
    if (ids.length) {
      const { data: sel } = await supabase
        .from('selections')
        .select('split_id')
        .in('split_id', ids)
        .eq('user_name', username)
      acted = new Set((sel || []).map(r => r.split_id))
    }

    const need = new Set()
    scan.forEach(s => { if (!acted.has(s.id)) need.add(s.group_id) })
    setActionGroups(need)
  }

  async function loadGroups() {
    const { data } = await supabase
      .from('group_members')
      .select('group_id, groups(id, name, created_by, created_at)')
      .eq('user_id', user.id)
      .eq('status', 'accepted')

    setGroups(data?.map(d => d.groups).filter(Boolean) || [])
  }

  async function loadInvites() {
    const { data } = await supabase
      .from('group_members')
      .select('id, group_id, groups(id, name, created_by)')
      .eq('user_id', user.id)
      .eq('status', 'pending')

    setInvites(data?.filter(d => d.groups) || [])
  }

  async function acceptInvite(memberRowId) {
    await supabase
      .from('group_members')
      .update({ status: 'accepted' })
      .eq('id', memberRowId)
    loadInvites()
    loadGroups()
  }

  async function declineInvite(memberRowId) {
    await supabase
      .from('group_members')
      .delete()
      .eq('id', memberRowId)
    loadInvites()
  }

  async function createGroup() {
    if (!groupName.trim()) return

    const { data: group, error } = await supabase
      .from('groups')
      .insert({ name: groupName, created_by: user.id })
      .select()
      .single()

    if (error) { alert('Error creating group'); return }

    await supabase.from('group_members').insert({
      group_id: group.id,
      user_id: user.id,
      email: user.email
    })

    setGroupName('')
    setShowCreate(false)
    loadGroups()
  }

  async function logout() {
    await supabase.auth.signOut()
    window.location.reload()
  }

  async function saveUsername() {
    const u = newName.trim().toLowerCase()
    const old = profile.username

    if (!USERNAME_RE.test(u)) {
      setUnameErr('3–20 chars: lowercase letters, numbers, underscore only')
      return
    }
    if (u === old) { setEditing(false); return }

    setSavingName(true)
    setUnameErr('')

    // is the new handle taken by someone else?
    const { data: taken } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', u)
      .maybeSingle()
    if (taken && taken.id !== user.id) {
      setUnameErr('Username already taken')
      setSavingName(false)
      return
    }

    // 1) update my profile (the source of truth)
    const { error: pErr } = await supabase
      .from('profiles')
      .update({ username: u })
      .eq('id', user.id)
    if (pErr) {
      setUnameErr('Could not save — try again')
      setSavingName(false)
      return
    }

    // 2) CASCADE: rewrite my name in every past selection so the OLD handle
    //    exists nowhere (group members / split creators auto-resolve from email)
    await supabase.from('selections').update({ user_name: u }).eq('user_name', old)

    // reload so everything re-reads the new username consistently
    window.location.reload()
  }

  return (
    <div className="page">
      <div className="topbar" style={{ position: 'relative', zIndex: 100 }}>
        <h1 style={{ fontSize: '1.5rem' }}>🧾 Smart Splitter</h1>
        <div style={{ position: 'relative' }}>
          <button
            onClick={e => { e.stopPropagation(); setMenuOpen(o => !o) }}
            className="btn btn-sm"
          >
            @{profile?.username} ▾
          </button>
          {menuOpen && (
            <div className="menu" style={{ right: 0 }}>
              <button
                onClick={() => { setMenuOpen(false); setNewName(profile.username); setUnameErr(''); setEditing(true) }}
                className="menu-item"
              >
                ✏️ Rename
              </button>
              <button onClick={logout} className="menu-item menu-item-danger">
                🚪 Logout
              </button>
            </div>
          )}
        </div>
      </div>

      {editing && (
        <div
          onClick={() => setEditing(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: '1rem' }}
        >
          <div onClick={e => e.stopPropagation()} className="card" style={{ maxWidth: '380px', width: '100%', textAlign: 'center' }}>
            <div className="avatar" style={{ margin: '0 auto 0.75rem', width: '52px', height: '52px', fontSize: '1.4rem' }}>
              {(newName || '?').trim().charAt(0).toUpperCase()}
            </div>
            <h3 style={{ margin: '0 0 0.25rem' }}>Edit username</h3>
            <p className="faint" style={{ margin: '0 0 1.2rem', fontSize: '0.85rem' }}>
              Updates your name everywhere, including past splits.
            </p>

            <div style={{
              display: 'flex', alignItems: 'stretch', textAlign: 'left',
              border: '1.5px solid var(--border-strong)', borderRadius: 'var(--radius-sm)', overflow: 'hidden'
            }}>
              <span style={{
                padding: '0 0.85rem', display: 'flex', alignItems: 'center',
                background: 'var(--surface-2)', color: 'var(--text-muted)', fontWeight: 800
              }}>@</span>
              <input
                autoFocus
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && saveUsername()}
                style={{ flex: 1, border: 'none', outline: 'none', padding: '0.7rem 0.8rem', fontSize: '1rem', background: 'transparent', color: 'var(--text)' }}
              />
            </div>
            {unameErr && <p style={{ color: 'var(--danger)', fontSize: '0.85rem', margin: '0.6rem 0 0', textAlign: 'left' }}>{unameErr}</p>}

            <div style={{ display: 'flex', gap: '0.6rem', marginTop: '1.2rem' }}>
              <button onClick={() => setEditing(false)} className="btn" style={{ flex: 1 }}>Cancel</button>
              <button onClick={saveUsername} disabled={savingName} className="btn btn-primary" style={{ flex: 1 }}>
                {savingName ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {invites.length > 0 && (
        <div className="mt-2">
          <h2 style={{ marginBottom: '0.9rem' }}>Pending invites</h2>
          {invites.map(inv => (
            <div key={inv.id} className="card" style={{ borderColor: 'var(--warning)', background: 'var(--warning-soft)' }}>
              <div className="row">
                <div>
                  <div className="card-title">{inv.groups.name}</div>
                  <div className="card-sub">You've been invited</div>
                </div>
                <div className="cluster">
                  <button onClick={() => acceptInvite(inv.id)} className="btn btn-sm btn-success">Accept</button>
                  <button onClick={() => declineInvite(inv.id)} className="btn btn-sm btn-danger-outline">Decline</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="section-head">
        <h2 style={{ margin: 0 }}>Your groups</h2>
        <button onClick={() => setShowCreate(!showCreate)} className="btn btn-sm btn-primary">
          + Create group
        </button>
      </div>

      {showCreate && (
        <div className="card">
          <input
            className="input"
            placeholder="Group name (e.g. Roommates, Goa trip)"
            value={groupName}
            onChange={e => setGroupName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && createGroup()}
          />
          <button onClick={createGroup} className="btn btn-primary mt-1">Create</button>
        </div>
      )}

      {groups.length === 0 && (
        <p className="muted">No groups yet. Create one and invite your friends.</p>
      )}

      {groups.map(group => (
        <div key={group.id} onClick={() => navigate(`/group/${group.id}`)} className="card card-tap">
          <div className="cluster">
            <div className="avatar">{group.name.trim().charAt(0).toUpperCase()}</div>
            <div style={{ flex: 1 }}>
              <div className="cluster">
                <span className="card-title">{group.name}</span>
                {actionGroups.has(group.id) && (
                  <span className="badge badge-danger">Action required</span>
                )}
              </div>
              <div className="card-sub">
                {group.created_by === user.id ? 'Created by you' : 'Member'}
              </div>
            </div>
            <span className="faint" style={{ fontSize: '1.3rem' }}>›</span>
          </div>
        </div>
      ))}
    </div>
  )
}
