import { supabase } from './supabase'

export default function Auth({ onGuest }) {
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
        Sign in with Google
      </button>

      <div style={{ marginTop: '1.5rem' }}>
        <button
          onClick={onGuest}
          style={{
            padding: '0.5rem 1rem',
            fontSize: '0.9rem',
            cursor: 'pointer',
            background: 'transparent',
            border: 'none',
            color: '#888',
            textDecoration: 'underline'
          }}
        >
          Continue as guest
        </button>
        <p style={{ color: '#aaa', fontSize: '0.75rem', marginTop: '0.5rem' }}>
          Guests can scan bills and create a split, but can't use groups or invite friends.
        </p>
      </div>
    </div>
  )
}