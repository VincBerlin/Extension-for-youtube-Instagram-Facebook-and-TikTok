import { useEffect } from 'react'
import { supabase } from './useAuth'
import { useAppStore } from '../store'
import type { UserProfile } from '@shared/types'

/**
 * Loads the user's full profile from `profiles` table when a user is signed in,
 * and keeps it in the Zustand store. The profile row is created on signup via
 * the `handle_new_user` trigger (migration 003).
 */
export function useProfile() {
  const user = useAppStore((s) => s.user)
  const setProfile = useAppStore((s) => s.setProfile)

  useEffect(() => {
    if (!user) {
      setProfile(null)
      return
    }
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, display_name, preferred_language, default_mode, plan, created_at, updated_at')
        .eq('id', user.id)
        .maybeSingle()
      if (cancelled) return
      if (error) {
        console.warn('[useProfile] load failed:', error.message)
        return
      }
      if (data) {
        setProfile(data as UserProfile)
      }
    })()
    return () => { cancelled = true }
  }, [user, setProfile])
}

export async function updateProfile(patch: Partial<Pick<UserProfile, 'display_name' | 'preferred_language' | 'default_mode'>>): Promise<UserProfile | null> {
  const user = useAppStore.getState().user
  if (!user) return null
  const { data, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', user.id)
    .select('id, email, display_name, preferred_language, default_mode, plan, created_at, updated_at')
    .single()
  if (error) {
    console.warn('[updateProfile] failed:', error.message)
    return null
  }
  useAppStore.getState().setProfile(data as UserProfile)
  return data as UserProfile
}
