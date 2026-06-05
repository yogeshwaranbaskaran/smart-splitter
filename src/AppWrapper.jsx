import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from './supabase'
import Auth from './Auth.jsx'
import Home from './Home.jsx'
import App from './App.jsx'
import SetUsername from './SetUsername.jsx'

export default function AppWrapper() {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [guest, setGuest] = useState(false)
  const [searchParams] = useSearchParams()
  const groupId = searchParams.get('group')

  async function handleUser(u) {
    setUser(u)
    if (u) {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', u.id)
        .maybeSingle()
      setProfile(data || null)
    } else {
      setProfile(null)
    }
    setLoading(false)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      handleUser(session?.user || null)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      handleUser(session?.user || null)
    })
    return () => subscription.unsubscribe()
  }, [])

  if (loading) return <div style={{ padding: '2rem' }}>Loading...</div>

  // not logged in
  if (!user) {
    if (guest) return <App user={null} groupId={null} />
    return <Auth onGuest={() => setGuest(true)} />
  }

  // logged in but no username yet → force the username screen
  if (!profile) {
    return (
      <SetUsername
        user={user}
        onDone={username => setProfile({ id: user.id, username, email: user.email })}
      />
    )
  }

  // logged in with a username
  if (groupId) return <App user={user} groupId={groupId} profile={profile} />
  return <Home user={user} profile={profile} />
}
