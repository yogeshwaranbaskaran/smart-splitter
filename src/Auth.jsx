import { supabase } from './supabase'

export default function Auth() {
  async function loginWithGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin
      }
    })
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '400px', margin: '4rem auto', textAlign: 'center' }}>
      <h1>Smart Splitter</h1>
      <p style={{ color: '#888', marginBottom: '2rem' }}>Split bills with your friends easily</p>
      <button
        onClick={loginWithGoogle}
        style={{
          padding: '0.75rem 2rem',
          fontSize: '1rem',
          cursor: 'pointer',
          background: '#fff',
          border: '1px solid #ddd',
          borderRadius: '8px',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          margin: '0 auto'
        }}
      >
        <img src="https://www.google.com/favicon.ico" width="20" height="20" />
        Sign in with Google
      </button>
    </div>
  )
}