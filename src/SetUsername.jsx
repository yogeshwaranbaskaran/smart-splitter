import { useState } from 'react'
import { supabase } from './supabase'

// rule: 3-20 chars, lowercase letters, numbers, underscore
const USERNAME_RE = /^[a-z0-9_]{3,20}$/

export default function SetUsername({ user, onDone }) {
  const [username, setUsername] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    const u = username.trim().toLowerCase()

    if (!USERNAME_RE.test(u)) {
      setError('3–20 chars: lowercase letters, numbers, underscore only')
      return
    }

    setSaving(true)
    setError('')

    // check if taken (nice UX; the DB unique constraint is the real guard)
    const { data: existing } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', u)
      .maybeSingle()

    if (existing) {
      setError('Username already taken')
      setSaving(false)
      return
    }

    const { error: insertError } = await supabase
      .from('profiles')
      .insert({ id: user.id, username: u, email: user.email })

    if (insertError) {
      setError('Could not save — try another username')
      setSaving(false)
      return
    }

    onDone(u)
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '400px', margin: '4rem auto' }}>
      <h2>Pick a username</h2>
      <p style={{ color: '#888', marginBottom: '1.5rem' }}>
        Friends use this to find and invite you.
      </p>
      <input
        placeholder="e.g. yogesh_b"
        value={username}
        onChange={e => setUsername(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && save()}
        style={{ width: '100%', padding: '0.6rem', marginBottom: '0.75rem', boxSizing: 'border-box' }}
      />
      {error && <p style={{ color: '#ef4444', fontSize: '0.85rem', marginBottom: '0.75rem' }}>{error}</p>}
      <button
        onClick={save}
        disabled={saving}
        style={{ padding: '0.6rem 1.5rem', cursor: 'pointer', background: '#22c55e', color: '#fff', border: 'none', borderRadius: '6px' }}
      >
        {saving ? 'Saving...' : 'Continue'}
      </button>
    </div>
  )
}
