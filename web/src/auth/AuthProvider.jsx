import { useEffect, useState, useCallback, useRef, useContext } from 'react'
import { supabase } from '../supabase/client'
import { AuthContext } from './AuthContext'
import { devLog } from '../utils/devLog'

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

// Helper: create a fresh per-query timeout (fixes the shared timeout bug where
// both queries raced the same promise and the second always had 0ms left)
const withTimeout = (promise, ms = 8000) => {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Profile fetch timeout')), ms)
  )
  return Promise.race([promise, timeout])
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const mounted = useRef(true)
  // Tracks the last auth user id we fetched a profile for -- prevents duplicate
  // fetches when Supabase fires SIGNED_IN multiple times for the same session
  const lastFetchedUid = useRef(null)
  // Tracks if a fetch is currently in flight -- prevents concurrent fetches
  const fetchInProgress = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const fetchUserProfile = useCallback(async (authUser, force = false) => {
    if (!mounted.current) return
    if (!authUser?.id) return

    // Skip if we already have this user's profile loaded and it's not forced
    if (!force && lastFetchedUid.current === authUser.id && fetchInProgress.current === false) {
      devLog('Auth: Profile already loaded for', authUser.id, '-- skipping refetch')
      return
    }

    // Skip if a fetch is already in progress for this user
    if (fetchInProgress.current) {
      devLog('Auth: Fetch already in progress -- skipping duplicate')
      return
    }

    fetchInProgress.current = true
    devLog('Auth: Fetching profile for', authUser.id)

    try {
      // Fresh 8s timeout per query (not shared)
      const { data, error } = await withTimeout(
        supabase.from('users').select('*').eq('id', authUser.id).single()
      )
      if (error) throw error

      const { data: vehicles, error: vehiclesError } = await withTimeout(
        supabase
          .from('user_vehicles')
          .select('*')
          .eq('user_id', authUser.id)
          .order('is_primary', { ascending: false })
      )
      if (vehiclesError) throw vehiclesError

      const profile = {
        fullName: data.full_name,
        address: data.address,
        carType: data.car_type,
        registrationNumber: data.registration_number,
        vehicleColor: data.vehicle_color,
        avatarUrl: data.avatar_url,
        role: data.role,
        sopVersionAccepted: data.sop_version_accepted,
        sopAcceptedAt: data.sop_accepted_at,
        createdAt: data.created_at,
        vehicles: vehicles || [],
      }

      if (mounted.current) {
        lastFetchedUid.current = authUser.id
        setUser({ ...authUser, ...profile, uid: authUser.id })
        devLog('Auth: Profile loaded successfully for', authUser.id)
      }
    } catch (err) {
      console.error('Auth: Error fetching profile:', err)
      if (mounted.current) {
        setUser(prev => {
          // Already have a profile loaded -- preserve it, don't wipe on timeout
          if (prev?.uid && (prev?.fullName !== undefined || prev?.vehicles !== undefined)) {
            console.warn('Auth: Profile refetch failed -- preserving existing data.')
            return prev
          }
          // First load failed -- minimal fallback so app does not get stuck
          console.warn('Auth: Initial profile load failed -- minimal fallback.')
          return { ...authUser, uid: authUser.id, sopVersionAccepted: '1.0' }
        })
      }
    } finally {
      fetchInProgress.current = false
    }
  }, [])

  const refreshUser = useCallback(async () => {
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (authUser && mounted.current) {
      await fetchUserProfile(authUser, true) // force = true to bypass dedup
    }
  }, [fetchUserProfile])

  // localStorage availability check
  useEffect(() => {
    try {
      localStorage.setItem('auth_test', 'test')
      localStorage.removeItem('auth_test')
    } catch (e) {
      console.warn('localStorage is not available:', e)
    }
  }, [])

  // Auth initialisation
  useEffect(() => {
    const initAuth = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession()
        if (error) throw error
        if (!mounted.current) return

        if (session?.user) {
          devLog('Auth: Session found, fetching profile for', session.user.id)
          await fetchUserProfile(session.user)
        } else {
          devLog('Auth: No session found')
          if (mounted.current) setUser(null)
        }
      } catch (error) {
        console.error('Auth: Error getting session:', error)
        if (mounted.current) setUser(null)
      } finally {
        if (mounted.current) setLoading(false)
      }
    }

    initAuth()

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      devLog('Auth: onAuthStateChange triggered', _event, session?.user?.id)
      if (!mounted.current) return

      if (_event === 'TOKEN_REFRESHED') {
        // Token refreshed -- DO NOT refetch profile (causes wipe + subscription death).
        // Supabase realtime handles JWT rotation internally from v2.x onwards,
        // so we no longer need to manually disconnect/reconnect.
        devLog('Auth: Token refreshed -- no action needed.')
        if (mounted.current) setLoading(false)
        return
      }

      if (_event === 'SIGNED_IN') {
        // SIGNED_IN fires on every page load, tab focus, and token refresh in some
        // Supabase versions. The dedup check in fetchUserProfile prevents redundant
        // fetches -- if profile is already loaded for this uid, it's a no-op.
        if (session?.user) {
          await fetchUserProfile(session.user)
        }
        if (mounted.current) setLoading(false)
        return
      }

      if (_event === 'SIGNED_OUT') {
        if (mounted.current) {
          lastFetchedUid.current = null
          setUser(null)
          setLoading(false)
        }
        return
      }

      // Handle any other events (PASSWORD_RECOVERY, USER_UPDATED, etc.)
      try {
        if (session?.user) {
          await fetchUserProfile(session.user, true)
        } else {
          if (mounted.current) setUser(null)
        }
      } catch (error) {
        console.error('Auth: Error in auth state change:', error)
      } finally {
        if (mounted.current) setLoading(false)
      }
    })

    return () => {
      listener?.subscription.unsubscribe()
    }
  }, [fetchUserProfile])

  const value = {
    user,
    loading,
    refreshUser,
    signIn: (email, password) => supabase.auth.signInWithPassword({ email, password }),
    signOut: async () => {
      await supabase.auth.signOut()
    },
    signUp: (email, password, options) => 
      supabase.auth.signUp({ 
        email, 
        password, 
        options: {
          data: options?.data,
          emailRedirectTo: `${window.location.origin}/login`
        } 
      }),
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

