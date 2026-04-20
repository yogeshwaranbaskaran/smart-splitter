import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export default function Home({ user }) {
  const [groups, setGroups] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [groupName, setGroupName] = useState('')

  useEffect(() => {
    loadGroups()
  }, [])

  async function loadGroups() {
    const { data } = await supabase
      .from('group_members')
      .select('group_id, groups(id, name, created_by, created_at)')
      .eq('user_id', user.id)

    const grouped = data?.map(d => d.groups).filter(Boolean) || []
    setGroups(grouped)
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
        <h1 style={{ margin: 0 }}>Smart Splitter</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span style={{ fontSize: '0.85rem', color: '#888' }}>{user.email}</span>
          <button onClick={logout} style={{ padding: '0.4rem 0.75rem', cursor: 'pointer' }}>Logout</button>
        </div>
      </div>

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
        <div style={{ marginBottom: '1.5rem', padding: '1rem', border: '1px solid #333', borderRadius: '8px' }}>
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
          onClick={() => window.location.href = `/group/${group.id}`}
          style={{
            padding: '1rem',
            marginBottom: '0.75rem',
            border: '1px solid #333',
            borderRadius: '8px',
            cursor: 'pointer'
          }}
        >
          <strong>{group.name}</strong>
          <div style={{ fontSize: '0.8rem', color: '#888', marginTop: '0.25rem' }}>
            {group.created_by === user.id ? 'Created by you' : 'Member'}
          </div>
        </div>
      ))}
    </div>
  )
}