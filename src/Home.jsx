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
    <div style={{ padding: '2rem', maxWidth: '600px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem' }}>Smart Splitter</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span style={{ fontSize: '0.85rem', color: '#888' }}>{user.email}</span>
          <button onClick={logout} style={{ padding: '0.4rem 0.75rem', cursor: 'pointer' }}>Logout</button>
        </div>
      </div>

      {invites.length > 0 && (
        <div style={{ marginBottom: '2rem' }}>
          <h2 style={{ margin: '0 0 1rem' }}>Pending invites</h2>
          {invites.map(inv => (
            <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', marginBottom: '0.75rem', border: '1px solid #f59e0b', borderRadius: '8px', background: '#fffbeb' }}>
              <div>
                <strong>{inv.groups.name}</strong>
                <div style={{ fontSize: '0.8rem', color: '#888' }}>You've been invited</div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  onClick={() => acceptInvite(inv.id)}
                  style={{ padding: '0.4rem 1rem', cursor: 'pointer', background: '#22c55e', color: '#fff', border: 'none', borderRadius: '6px' }}
                >
                  Accept
                </button>
                <button
                  onClick={() => declineInvite(inv.id)}
                  style={{ padding: '0.4rem 1rem', cursor: 'pointer', background: '#fff', color: '#ef4444', border: '1px solid #ef4444', borderRadius: '6px' }}
                >
                  Decline
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0 }}>Your groups</h2>
        <button
          onClick={() => setShowCreate(!showCreate)}
          style={{ padding: '0.5rem 1rem', cursor: 'pointer', background: '#22c55e', color: '#fff', border: 'none', borderRadius: '6px' }}
        >
          + Create group
        </button>
      </div>

      {showCreate && (
        <div style={{ marginBottom: '1.5rem', padding: '1rem', border: '1px solid #ddd', borderRadius: '8px' }}>
          <input
            placeholder="Group name (e.g. Roommates, Goa trip)"
            value={groupName}
            onChange={e => setGroupName(e.target.value)}
            style={{ width: '100%', padding: '0.5rem', marginBottom: '0.75rem', boxSizing: 'border-box' }}
          />
          <button
            onClick={createGroup}
            style={{ padding: '0.5rem 1.5rem', cursor: 'pointer', background: '#22c55e', color: '#fff', border: 'none', borderRadius: '6px' }}
          >
            Create
          </button>
        </div>
      )}

      {groups.length === 0 && (
        <p style={{ color: '#888' }}>No groups yet. Create one and invite your friends.</p>
      )}

      {groups.map(group => (
        <div
          key={group.id}
          onClick={() => navigate(`/group/${group.id}`)}
          style={{ padding: '1rem', marginBottom: '0.75rem', border: '1px solid #ddd', borderRadius: '8px', cursor: 'pointer' }}
        >
          <strong>{group.name}</strong>
          {actionGroups.has(group.id) && (
            <span style={{ background: '#ef4444', color: '#fff', fontSize: '0.7rem', padding: '0.15rem 0.5rem', borderRadius: '10px', marginLeft: '0.5rem', whiteSpace: 'nowrap' }}>
              Action required
            </span>
          )}
          <div style={{ fontSize: '0.8rem', color: '#888', marginTop: '0.25rem' }}>
            {group.created_by === user.id ? 'Created by you' : 'Member'}
          </div>
        </div>
      ))}
    </div>
  )
}