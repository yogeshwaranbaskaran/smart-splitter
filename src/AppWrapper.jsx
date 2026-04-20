import { useEffect, useState } from 'react'
import { useParams, useSearchParams, useLocation } from 'react-router-dom'
import { supabase } from './supabase'
import Auth from './Auth.jsx'
import Home from './Home.jsx'
import GroupView from './GroupView.jsx'
import App from './App.jsx'

export default function AppWrapper() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const groupId = searchParams.get('group')
  const location = useLocation()

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user || null)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser(session.user)
      }
      setLoading(false)
    })
    return () => subscription.unsubscribe()
  }, [])

  if (loading) return <div style={{ padding: '2rem' }}>Loading...</div>
  if (!user) return <Auth />

  const isGroupPage = location.pathname.startsWith('/group/')
  
  if (isGroupPage) return <GroupView user={user} />
  if (groupId) return <App user={user} groupId={groupId} />
  return <Home user={user} />
}// trigger deploy
