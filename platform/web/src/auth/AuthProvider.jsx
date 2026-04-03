import { useEffect, useState, useCallback, useRef, useContext } from 'react'
import { Capacitor } from '@capacitor/core'
import { supabase } from '../supabase/client'
import { clearAllSupabaseAuthKeys } from '../supabase/authStorage'
import { AuthContext } from './AuthContext'
import { devLog } from '../utils/devLog'
import { isRpcNotFoundError } from '../utils/isRpcNotFound'
import { registerEmergencyChatPush } from '../utils/emergencyChatPush'
import { permissionsPrimerWasDismissed } from '../utils/permissionsPrimerStorage'
import { sessionUserForAppState } from './appRole'

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

/** One budget for users + vehicles (sequential queries share a single deadline). */
const PROFILE_FETCH_TIMEOUT_MS = 45000

/**
 * Never keep the app on "Signing you in…" forever (Capacitor/WebView resume, hung profile
 * fetch, or stuck in-flight await). After this, UI unlocks; profile may still complete in background.
 */
/** If INITIAL_SESSION never fires (WebView resume quirk), unlock before this. */
const NATIVE_SESSION_READY_FALLBACK_MS = 14000

const AUTH_BOOTSTRAP_CAP_MS = 35000

/** Don’t block forever waiting for another in-flight profile fetch (deadlock). */
const AWAIT_IN_FLIGHT_PROFILE_MS = 28000

const AUTH_BOOT_LABEL = 'Auth bootstrap'

const withTimeout = (promise, ms = PROFILE_FETCH_TIMEOUT_MS) => {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Profile fetch timeout')), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function buildPhase1Profile(data, authUser) {
  return {
    fullName: data.full_name,
    address: data.address,
    phone: data.phone ?? authUser.user_metadata?.phone ?? null,
    carType: data.car_type,
    registrationNumber: data.registration_number,
    vehicleColor: data.vehicle_color,
    avatarUrl: data.avatar_url,
    role: data.role,
    sopVersionAccepted: data.sop_version_accepted,
    sopAcceptedAt: data.sop_accepted_at,
    createdAt: data.created_at,
    vehicles: [],
    requiredSopVersion: null,
  }
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  /** True only after first INITIAL_SESSION completes — avoids login form / redirect flash on refresh */
  const [sessionReady, setSessionReady] = useState(false)
  const sessionReadyRef = useRef(false)
  const mounted = useRef(true)
  // Tracks the last auth user id we fetched a profile for -- prevents duplicate
  // fetches when Supabase fires SIGNED_IN multiple times for the same session
  const lastFetchedUid = useRef(null)
  // Tracks if a fetch is currently in flight -- prevents concurrent fetches
  const fetchInProgress = useRef(false)
  /** When a second caller hits "already fetching", await this so we don't setLoading before user exists */
  const profileFetchPromiseRef = useRef(null)
  const bootstrapStartedAtRef = useRef(0)

  useEffect(() => {
    mounted.current = true
    bootstrapStartedAtRef.current = Date.now()
    devLog(`${AUTH_BOOT_LABEL}: start`)
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    sessionReadyRef.current = sessionReady
  }, [sessionReady])

  const fetchUserProfile = useCallback(async (authUser, force = false) => {
    if (!mounted.current) return
    if (!authUser?.id) return

    // Skip if we already have this user's profile loaded and it's not forced
    if (!force && lastFetchedUid.current === authUser.id && fetchInProgress.current === false) {
      devLog('Auth: Profile already loaded for', authUser.id, '-- skipping refetch')
      return
    }

    // Another INITIAL_SESSION / SIGNED_IN is already loading this profile — must await it or
    // the duplicate caller returns immediately and setLoading(false) runs before setUser().
    if (fetchInProgress.current && profileFetchPromiseRef.current) {
      devLog('Auth: Profile fetch in progress — awaiting')
      const inflight = profileFetchPromiseRef.current
      try {
        await Promise.race([
          inflight,
          new Promise((_, rej) =>
            setTimeout(() => rej(new Error('await_inflight_profile_timeout')), AWAIT_IN_FLIGHT_PROFILE_MS)
          ),
        ])
      } catch (e) {
        if (e?.message === 'await_inflight_profile_timeout') {
          console.warn('Auth: in-flight profile fetch wait timed out — continuing')
        } else {
          throw e
        }
      }
      return
    }

    if (fetchInProgress.current) {
      return
    }

    fetchInProgress.current = true
    devLog('Auth: Fetching profile for', authUser.id)

    const loadPromise = (async () => {
      const loadUserCore = async () => {
        const { data, error } = await supabase
          .from('users')
          .select('*')
          .eq('id', authUser.id)
          .single()
        if (error) throw error
        return data
      }

      const loadUserExtras = async () => {
        const [{ data: vehicles, error: vehiclesError }, { data: sopRow }] = await Promise.all([
          supabase
            .from('user_vehicles')
            .select('*')
            .eq('user_id', authUser.id)
            .order('is_primary', { ascending: false }),
          supabase.from('sop_versions').select('version').eq('active', true).maybeSingle(),
        ])
        if (vehiclesError) throw vehiclesError

        let syncedPhone = null
        const { data: rpcPhone, error: syncPhoneErr } = await supabase.rpc('sync_my_phone_from_auth')
        if (!syncPhoneErr && typeof rpcPhone === 'string' && rpcPhone.trim().length > 0) {
          syncedPhone = rpcPhone.trim()
        } else if (syncPhoneErr && !isRpcNotFoundError(syncPhoneErr)) {
          devLog('Auth: sync_my_phone_from_auth', syncPhoneErr.message)
        }

        return { vehicles: vehicles || [], requiredSopVersion: sopRow?.version ?? null, syncedPhone }
      }

      try {
        const data = await withTimeout(loadUserCore())
        const phase1 = buildPhase1Profile(data, authUser)
        if (mounted.current) {
          lastFetchedUid.current = authUser.id
          setUser((prev) => ({ ...(prev || authUser), ...phase1, uid: authUser.id }))
          devLog('Auth: Profile phase 1 loaded for', authUser.id)
        }

        void (async () => {
          try {
            const { vehicles, requiredSopVersion, syncedPhone } = await withTimeout(loadUserExtras())
            if (!mounted.current) return
            setUser((prev) => {
              if (!prev?.uid || prev.uid !== authUser.id) return prev
              return {
                ...prev,
                vehicles,
                requiredSopVersion,
                phone: syncedPhone ?? prev.phone,
              }
            })
            devLog('Auth: Profile phase 2 loaded for', authUser.id)
          } catch (e) {
            console.warn('Auth: Profile phase 2 error:', e)
          }
        })()
      } catch (err) {
        console.error('Auth: Error fetching profile:', err)
        if (mounted.current) {
          setUser((prev) => {
            if (prev?.uid && (prev?.fullName !== undefined || prev?.vehicles !== undefined)) {
              console.warn('Auth: Profile refetch failed -- preserving existing data.')
              return prev
            }
            console.warn('Auth: Initial profile load failed -- minimal fallback.')
            return (
              sessionUserForAppState(authUser, {
                sopVersionAccepted: null,
                requiredSopVersion: null,
              }) ?? { uid: authUser.id }
            )
          })
        }
      }
    })()

    profileFetchPromiseRef.current = loadPromise
    try {
      await loadPromise
    } finally {
      fetchInProgress.current = false
      if (profileFetchPromiseRef.current === loadPromise) {
        profileFetchPromiseRef.current = null
      }
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
        const t0 = performance.now()
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession()
        devLog(`${AUTH_BOOT_LABEL}: getSession ${Math.round(performance.now() - t0)}ms`)
        if (error) throw error
        if (!mounted.current) return

        // Do NOT call fetchUserProfile here — INITIAL_SESSION runs the same fetch. Racing them
        // caused the second call to "skip duplicate" and return before setUser, while
        // INITIAL_SESSION still ran setLoading(false) → /login on every refresh.
        devLog('Auth: getSession', session?.user?.id ? `uid=${session.user.id}` : 'empty — wait INITIAL_SESSION')
      } catch (error) {
        // Do not clear user or loading — INITIAL_SESSION may still deliver the session
        // after storage/network quirks; clearing here caused false redirects to /login.
        console.error('Auth: Error getting session (waiting for INITIAL_SESSION):', error)
      }
    }

    initAuth()

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      devLog('Auth: onAuthStateChange triggered', _event, session?.user?.id)
      if (!mounted.current) return

      if (_event === 'TOKEN_REFRESHED') {
        // Token refreshed -- DO NOT refetch profile (causes wipe + subscription death).
        // Never setLoading(false) here: this can run before INITIAL_SESSION on cold load,
        // which left user=null + loading=false and forced /login.
        devLog('Auth: Token refreshed -- no action needed.')
        return
      }

      // Emitted once per subscriber when the client restores session — do NOT force refetch
      // (catch-all used to call force:true and duplicated initAuth + caused timeouts).
      if (_event === 'INITIAL_SESSION') {
        let bootstrapDone = false
        const finishBootstrap = () => {
          if (!mounted.current || bootstrapDone) return
          bootstrapDone = true
          setLoading(false)
          setSessionReady(true)
          devLog(`${AUTH_BOOT_LABEL}: ready in ${Date.now() - bootstrapStartedAtRef.current}ms`)
        }
        const safetyTimer = setTimeout(async () => {
          if (!mounted.current || bootstrapDone) return
          console.warn(
            'Auth: bootstrap safety timeout — ensuring minimal session so UI can load'
          )
          try {
            const {
              data: { session: s },
            } = await supabase.auth.getSession()
            if (!mounted.current || bootstrapDone) return
            if (s?.user && lastFetchedUid.current !== s.user.id) {
              lastFetchedUid.current = s.user.id
              setUser(
                sessionUserForAppState(s.user, {
                  sopVersionAccepted: null,
                  requiredSopVersion: null,
                })
              )
            } else if (!s?.user && mounted.current) {
              setUser(null)
            }
          } catch (e) {
            console.warn('Auth: bootstrap safety getSession:', e)
          }
          finishBootstrap()
        }, AUTH_BOOTSTRAP_CAP_MS)
        try {
          if (session?.user) {
            // Fast path: unlock UI immediately on restored auth session.
            // Full profile hydration runs in background and updates user state later.
            if (lastFetchedUid.current !== session.user.id) {
              setUser((prev) => {
                if (prev?.uid === session.user.id) return prev
                return sessionUserForAppState(session.user, {
                  sopVersionAccepted: prev?.sopVersionAccepted ?? null,
                  requiredSopVersion: prev?.requiredSopVersion ?? null,
                })
              })
            }
            finishBootstrap()
            void fetchUserProfile(session.user).catch((e) =>
              console.warn('Auth: INITIAL_SESSION background profile error:', e)
            )
            return
          } else if (mounted.current) {
            setUser(null)
          }
        } catch (e) {
          console.error('Auth: INITIAL_SESSION profile error:', e)
        } finally {
          clearTimeout(safetyTimer)
          finishBootstrap()
        }
        return
      }

      if (_event === 'SIGNED_IN') {
        // SIGNED_IN fires on every page load, tab focus, and token refresh in some
        // Supabase versions. The dedup check in fetchUserProfile prevents redundant
        // fetches -- if profile is already loaded for this uid, it's a no-op.
        try {
          if (session?.user) {
            await fetchUserProfile(session.user)
          }
        } catch (e) {
          console.error('Auth: SIGNED_IN profile error:', e)
        } finally {
          if (mounted.current) setLoading(false)
          if (!sessionReadyRef.current && mounted.current) {
            setSessionReady(true)
            devLog(`${AUTH_BOOT_LABEL}: ready from SIGNED_IN in ${Date.now() - bootstrapStartedAtRef.current}ms`)
          }
        }
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

      // PASSWORD_RECOVERY may need a fresh row; USER_UPDATED fires on password change too — that
      // does not change public.users, and forcing refetch here raced the profile timeout with updateUser’s
      // lock/notifications in embedded browsers (spurious "Profile fetch timeout" in F12).
      const forceRefetch = _event === 'PASSWORD_RECOVERY'
      try {
        if (session?.user) {
          await fetchUserProfile(session.user, forceRefetch)
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

  // After backgrounding (e.g. browser on same device, then back to Capacitor), nudge the
  // client to refresh the session so we don’t sit on a stale client while storage is valid.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'visible') return
      void supabase.auth.getSession().then(({ error }) => {
        if (error) console.warn('Auth: getSession on foreground:', error.message)
      })
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  /**
   * Android WebView often skips or delays INITIAL_SESSION on cold start. If it never fires in time,
   * unblock the UI the same way INITIAL_SESSION does: minimal user from JWT + sessionReady, then
   * hydrate profile in the background. Previously this path awaited fetchUserProfile (up to ~45s),
   * which matched user reports of 30–60s stuck on "Signing you in…" after kill + reopen.
   */
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let cancelled = false
    const t = setTimeout(() => {
      void (async () => {
        if (cancelled || !mounted.current || sessionReadyRef.current) return
        try {
          const {
            data: { session },
          } = await supabase.auth.getSession()
          if (cancelled || !mounted.current || sessionReadyRef.current) return
          if (!session?.user) {
            if (mounted.current) setUser(null)
            setSessionReady(true)
            setLoading(false)
            return
          }
          if (lastFetchedUid.current !== session.user.id) {
            setUser((prev) => {
              if (prev?.uid === session.user.id) return prev
              return sessionUserForAppState(session.user, {
                sopVersionAccepted: prev?.sopVersionAccepted ?? null,
                requiredSopVersion: prev?.requiredSopVersion ?? null,
              })
            })
          }
          setSessionReady(true)
          setLoading(false)
          void fetchUserProfile(session.user).catch((e) =>
            console.warn('Auth: native session fallback background profile error:', e)
          )
        } catch (e) {
          console.warn('Auth: native session fallback:', e)
          if (mounted.current) {
            setSessionReady(true)
            setLoading(false)
          }
        }
      })()
    }, NATIVE_SESSION_READY_FALLBACK_MS)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [fetchUserProfile])

  /**
   * Capacitor app resume: explicitly reload session from Preferences and unblock UI.
   * document.visibilityState is unreliable in Android WebView after backgrounding.
   */
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let cancelled = false
    let sub
    ;(async () => {
      try {
        const { App } = await import('@capacitor/app')
        if (cancelled) return
        sub = await App.addListener('resume', async () => {
          try {
            const {
              data: { session },
              error,
            } = await supabase.auth.getSession()
            if (error) console.warn('Auth: resume getSession:', error.message)
            if (!mounted.current) return
            if (session?.user) {
              void fetchUserProfile(session.user).catch((e) => console.warn('Auth: resume profile:', e))
            } else {
              setUser(null)
            }
            setSessionReady(true)
            setLoading(false)
          } catch (e) {
            console.warn('Auth: resume handler:', e)
            if (mounted.current) {
              setSessionReady(true)
              setLoading(false)
            }
          }
        })
      } catch (e) {
        console.warn('Auth: @capacitor/app not available:', e)
      }
    })()
    return () => {
      cancelled = true
      void sub?.remove?.()
    }
  }, [fetchUserProfile])

  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    void (async () => {
      const flowDone = await permissionsPrimerWasDismissed()
      if (cancelled || !flowDone) return
      await registerEmergencyChatPush(user.id, { requestPermission: false })
    })()
    return () => {
      cancelled = true
    }
  }, [user?.id])

  const value = {
    user,
    loading,
    sessionReady,
    refreshUser,
    signIn: (email, password) => supabase.auth.signInWithPassword({ email, password }),
    signOut: async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession()
        if (session?.user?.id) {
          await supabase.from('user_push_tokens').delete().eq('user_id', session.user.id)
        }
      } catch (e) {
        console.warn('Push token cleanup:', e)
      }
      await supabase.auth.signOut()
      clearAllSupabaseAuthKeys()
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

