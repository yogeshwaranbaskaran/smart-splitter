import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from './supabase'
import SetUsername from './SetUsername.jsx'

export default function JoinGroup() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [group, setGroup] = useState(null)
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)

  useEffect(() => {
    init()
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => init())
    return () => subscription.unsubscribe()
  }, [])

  async function init() {
    const { data: { session } } = await supabase.auth.getSession()
    const u = session?.user || null
    setUser(u)

    const { data: g } = await supabase
      .from('groups')
      .select('id, name')
      .eq('id', id)
      .maybeSingle()
    setGroup(g)

    if (u) {
      const { data: p } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', u.id)
        .maybeSingle()
      setProfile(p || null)
    }
    setLoading(false)
  }

  async function loginWithGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.href } // return to this join page after login
    })
  }

  async function joinGroup() {
    setJoining(true)

    // already have a membership row? (maybe a pending invite) → make it accepted
    const { data: existing } = await supabase
      .from('group_members')
      .select('id, status')
      .eq('group_id', id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (existing) {
      if (existing.status !== 'accepted') {
        await supabase
          .from('group_members')
          .update({ status: 'accepted' })
          .eq('id', existing.id)
      }
    } else {
      await supabase.from('group_members').insert({
        group_id: id,
        user_id: user.id,
        email: user.email,
        status: 'accepted'
      })
    }

    navigate(`/group/${id}`)
  }

  if (loading) return <div className="screen-msg">Loading…</div>
  if (!group) return <div className="screen-msg">This group link is invalid or no longer exists.</div>

  // not logged in → log in first (comes back here after)
  if (!user) {
    return (
      <div className="page-narrow center">
        <h2>Join “{group.name}”</h2>
        <p className="muted" style={{ margin: '0.5rem 0 1.5rem' }}>Log in to join this group.</p>
        <button onClick={loginWithGoogle} className="btn btn-lg">
          Sign in with Google
        </button>
      </div>
    )
  }

  // logged in but no username yet → force it, then come back to confirm
  if (!profile) {
    return (
      <SetUsername
        user={user}
        onDone={username => setProfile({ id: user.id, username, email: user.email })}
      />
    )
  }

  // logged in + has username → one-confirm join
  return (
    <div className="page-narrow center">
      <h2>Join “{group.name}”?</h2>
      <p className="muted" style={{ margin: '0.5rem 0 1.5rem' }}>You'll be added as a member.</p>
      <div className="cluster" style={{ justifyContent: 'center' }}>
        <button onClick={() => navigate('/')} className="btn">
          Cancel
        </button>
        <button onClick={joinGroup} disabled={joining} className="btn btn-primary">
          {joining ? 'Joining…' : 'Join group'}
        </button>
      </div>
    </div>
  )
}
