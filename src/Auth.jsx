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
    <div className="page-narrow center">
      <div className="hero">
        <div className="hero-emoji">🧾</div>
        <h1>Smart Splitter</h1>
        <p className="hero-sub">Split bills, stay friends.</p>
      </div>

      <button onClick={loginWithGoogle} className="btn btn-lg btn-block">
        Sign in with Google
      </button>

      <div className="mt-2">
        <button onClick={onGuest} className="btn-ghost" style={{ background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontFamily: 'inherit', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
          Continue as guest
        </button>
        <p className="faint" style={{ marginTop: '0.5rem' }}>
          Guests can scan bills and create a split, but can't use groups or invite friends.
        </p>
      </div>
    </div>
  )
}
