import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://vgnyjllyfuknslagkxbg.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZnbnlqbGx5ZnVrbnNsYWdreGJnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxMzQ3NDQsImV4cCI6MjA5MTcxMDc0NH0.sOm03KG1cxOviKLE2imdCY3Cltq37hEBGBt1Et_M8js'

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true
  }
})