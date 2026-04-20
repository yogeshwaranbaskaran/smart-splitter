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
  const [inviteEmail, setInviteEmail] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user || null)
      setAuthLoading(false)
    })
  }, [])

  useEffect(() => {
    if (!id) return
    loadGroup()
    loadMembers()
    loadSplits()
  }, [id])

  async function loadGroup() {
    const { data } = await supabase.from('groups').select('*').eq('id', id).single()
    setGroup(data)
  }

  async function loadMembers() {
    const { data } = await supabase.from('group_members').select('*').eq('group_id', id)
    setMembers(data || [])
  }

  async function loadSplits() {
    const { data } = await supabase
      .from('splits')
      .select('*')
      .eq('group_id', id)
      .order('created_at', { ascending: false })
    setSplits(data || [])
  }

  async function inviteMember() {
    if (!inviteEmail.trim()) return
    const already = members.find(m => m.email === inviteEmail)
    if (already) { alert('Already a member'); return }

    await supabase.from('group_members').insert({
      group_id: id,
      user_id: '00000000-0000-0000-0000-000000000000',
      email: inviteEmail
    })

    setInviteEmail('')
    loadMembers()
    alert(`Invited ${inviteEmail} — they will see this group when they log in`)
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
          <div key={m.id} style={{ padding: '0.4rem 0', borderBottom: '1px solid #222', fontSize: '0.9rem' }}>
            {m.email} {m.user_id === user.id ? '(you)' : ''}
          </div>
        ))}
        <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
          <input
            placeholder="Friend's email"
            value={inviteEmail}
            onChange={e => setInviteEmail(e.target.value)}
            style={{ flex: 1, padding: '0.5rem' }}
          />
          <button
            onClick={inviteMember}
            style={{ padding: '0.5rem 1rem', cursor: 'pointer' }}
          >
            Invite
          </button>
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

      {splits.length === 0 && (
        <p style={{ color: '#888' }}>No splits yet. Create one!</p>
      )}

      {splits.map(split => (
        <div
          key={split.id}
          onClick={() => window.location.href = `/split/${split.id}`}
          style={{
            padding: '1rem',
            marginBottom: '0.75rem',
            border: '1px solid #333',
            borderRadius: '8px',
            cursor: 'pointer'
          }}
        >
          <strong>{split.name}</strong>
          <div style={{ fontSize: '0.8rem', color: '#888', marginTop: '0.25rem' }}>
            By {split.created_by} · {new Date(split.created_at).toLocaleDateString()}
          </div>
        </div>
      ))}
    </div>
  )
}