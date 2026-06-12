import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('⚠️  Variables Supabase manquantes. Copiez .env.example en .env et remplissez vos clés.')
}

export const supabase = createClient(supabaseUrl, supabaseKey)
