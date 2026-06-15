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
    <div className="page-narrow">
      <h2>Pick a username</h2>
      <p className="muted" style={{ margin: '0.5rem 0 1.5rem' }}>
        Friends use this to find and invite you.
      </p>
      <div className="cluster" style={{ alignItems: 'stretch' }}>
        <span style={{ display: 'flex', alignItems: 'center', color: 'var(--text-faint)' }}>@</span>
        <input
          className="input"
          placeholder="yogesh_b"
          value={username}
          onChange={e => setUsername(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && save()}
        />
      </div>
      {error && <p style={{ color: 'var(--danger)', fontSize: '0.85rem', margin: '0.6rem 0 0' }}>{error}</p>}
      <button onClick={save} disabled={saving} className="btn btn-primary mt-2">
        {saving ? 'Saving...' : 'Continue'}
      </button>
    </div>
  )
}
