import { useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'
import { useAppStore } from '../store'

// These are safe to expose — they are public anon keys
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    flowType: 'implicit',          // Chrome extension: tokens kommen direkt im Hash zurück
    detectSessionInUrl: false,     // Side Panel hat keine echte URL — manuell setzen
    persistSession: true,
    storage: {
      // Speichere Session in chrome.storage.local für SW-Zugriff
      getItem: (key) => new Promise((resolve) => chrome.storage.local.get(key, (r) => resolve(r[key] ?? null))),
      setItem: (key, val) => new Promise((resolve) => chrome.storage.local.set({ [key]: val }, resolve)),
      removeItem: (key) => new Promise((resolve) => chrome.storage.local.remove(key, resolve)),
    },
  },
})

export function useAuth() {
  const { setUser } = useAppStore()

  useEffect(() => {
    // Restore session on mount
    supabase.auth.getSession().then(({ data }) => {
      const session = data.session
      if (session?.user) {
        syncUser(session.access_token, session.user.id, session.user.email ?? '')
      }
    })

    // Listen for auth state changes
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        syncUser(session.access_token, session.user.id, session.user.email ?? '')
      } else {
        setUser(null)
        chrome.storage.local.remove('supabase_token')
      }
    })

    return () => listener.subscription.unsubscribe()
  }, [setUser])
}

async function syncUser(token: string, id: string, email: string) {
  // Persist token for background service worker to use
  chrome.storage.local.set({ supabase_token: token })

  useAppStore.getState().setUser({ id, email })
}
