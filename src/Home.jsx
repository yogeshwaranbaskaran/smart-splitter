import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from './supabase'

export default function Home({ user, profile }) {
  const [groups, setGroups] = useState([])
  const [invites, setInvites] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [actionGroups, setActionGroups] = useState(new Set())
  const navigate = useNavigate()

  useEffect(() => {
    loadGroups()
    loadInvites()
  }, [])

  useEffect(() => {
    computeActionGroups()
  }, [groups])

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

  return (
    <div className="page">
      <div className="topbar">
        <h1 style={{ fontSize: '1.5rem' }}>🧾 Smart Splitter</h1>
        <div className="cluster">
          <span className="faint">@{profile?.username}</span>
          <button onClick={logout} className="btn btn-sm">Logout</button>
        </div>
      </div>

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
