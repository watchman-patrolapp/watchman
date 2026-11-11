import { useEffect, useState, useCallback, useRef, useContext } from 'react'
import { Capacitor } from '@capacitor/core'
import { supabase } from '../supabase/client'
import { clearAllSupabaseAuthKeys } from '../supabase/authStorage'
import { AuthContext } from './AuthContext'
import { devLog } from '../utils/devLog'
import { isRpcNotFoundError } from '../utils/isRpcNotFound'
import { registerEmergencyChatPush } from '../utils/emergencyChatPush'
import { permissionsPrimerWasDismissed } from '../utils/permissionsPrimerStorage'
import { hasHydratedAppRole, sessionUserForAppState } from './appRole'
import { nextProfileLoadStep, profileLoadAttemptPlan } from './profileLoadRetry'
import { isOfflineOrNetworkError } from '../offline/policy'
import { readProfileSnapshot, saveProfileSnapshot } from '../offline/snapshots'
import { clearOfflineSession } from '../offline/sessionCleanup'
import { syncCarSessionFromAuth } from '../geo/carSessionSync'

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function browserIsOnline() {
  if (typeof navigator === 'undefined') return true
  return navigator.onLine !== false
}

function profileFailureFrom(err, code) {
  const message = err?.message || 'Could not load profile'
  if (code === 'offline') return { code: 'offline', message }
  if (String(message).toLowerCase().includes('timeout')) return { code: 'timeout', message }
  return { code: code || 'exhausted', message }
}

function buildPhase1Profile(data, authUser) {
  return {
    fullName: data.full_name,
    address: data.address,
    phone: data.phone ?? authUser.user_metadata?.contact_phone ?? authUser.user_metadata?.phone ?? null,
    carType: data.car_type,
    registrationNumber: data.registration_number,
    vehicleColor: data.vehicle_color,
    avatarUrl: data.avatar_url,
    role: data.role,
    sopVersionAccepted: data.sop_version_accepted,
    sopAcceptedAt: data.sop_accepted_at,
    createdAt: data.created_at,
    organizationId: data.organization_id ?? null,
    activeOrganizationId: data.active_organization_id ?? null,
    homeSuburbId: data.home_suburb_id ?? null,
    patrollerSuburbId: data.patroller_suburb_id ?? null,
    homeLat: data.home_lat ?? null,
    homeLng: data.home_lng ?? null,
    homePinSetAt: data.home_pin_set_at ?? null,
    isVerifiedResident: Boolean(data.verified),
    verificationMethod: data.verification_method ?? "pending",
    platformRole: data.platform_role ?? "none",
    emergencyContactName: data.emergency_contact_name ?? null,
    emergencyContactPhone: data.emergency_contact_phone ?? null,
    emergencyContactUserId: data.emergency_contact_user_id ?? null,
    emergencyContactRelationship: data.emergency_contact_relationship ?? null,
    emergencyContact2Name: data.emergency_contact_2_name ?? null,
    emergencyContact2Phone: data.emergency_contact_2_phone ?? null,
    emergencyContact2UserId: data.emergency_contact_2_user_id ?? null,
    emergencyContact2Relationship: data.emergency_contact_2_relationship ?? null,
    vehicles: [],
    requiredSopVersion: null,
    profileLoaded: true,
  }
}

async function syncResidentSecurityMembershipFromMetadata(authUser, profileData) {
  const membershipFlag = authUser?.user_metadata?.security_membership
  const companyId = String(authUser?.user_metadata?.security_company_id || '').trim()
  const companyName = String(authUser?.user_metadata?.security_company_name || '').trim()
  if (membershipFlag !== 'yes' && !companyId) return

  let securityCompanyId = companyId || null
  if (securityCompanyId) {
    const { data: existingCompany } = await supabase
      .from('organizations')
      .select('id')
      .eq('id', securityCompanyId)
      .eq('type', 'security_company')
      .maybeSingle()
    if (!existingCompany?.id) return
    securityCompanyId = existingCompany.id
  } else if (companyName) {
    const { data: existingCompany } = await supabase
      .from('organizations')
      .select('id')
      .eq('type', 'security_company')
      .ilike('name', companyName)
      .maybeSingle()
    if (!existingCompany?.id) return
    securityCompanyId = existingCompany.id
  } else {
    return
  }

  if (!securityCompanyId || !profileData?.id) return

  const { error } = await supabase.rpc('claim_security_company', {
    p_company_id: securityCompanyId,
    p_member_reference: authUser?.user_metadata?.security_membership_reference || null,
  })
  if (error && !String(error.message || '').includes('transfer_required')) {
    console.warn('syncResidentSecurityMembershipFromMetadata:', error.message)
  }
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  /** Set when public.users cannot be loaded. Role stays unhydrated so guards can recover. */
  const [profileError, setProfileError] = useState(null)
  /** Bumps on each profile fetch so the access skeleton cap restarts on Try again. */
  const [profileLoadEpoch, setProfileLoadEpoch] = useState(0)
  /** True only after first INITIAL_SESSION completes — avoids login form / redirect flash on refresh */
  const [sessionReady, setSessionReady] = useState(false)
  const sessionReadyRef = useRef(false)
  const mounted = useRef(true)
  const userRef = useRef(null)
  const profileErrorRef = useRef(null)
  const profileFetchGenRef = useRef(0)
  // Tracks the last auth user id we fetched a profile for -- prevents duplicate
  // fetches when Supabase fires SIGNED_IN multiple times for the same session
  const lastFetchedUid = useRef(null)
  // Tracks if a fetch is currently in flight -- prevents concurrent fetches
  const fetchInProgress = useRef(false)
  /** When a second caller hits "already fetching", await this so we don't setLoading before user exists */
  const profileFetchPromiseRef = useRef(null)
  const bootstrapStartedAtRef = useRef(0)
  const profileCacheRetryRef = useRef(false)

  useEffect(() => {
    mounted.current = true
    bootstrapStartedAtRef.current = Date.now()
    devLog(`${AUTH_BOOT_LABEL}: start`)
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    sessionReadyRef.current = sessionReady
  }, [sessionReady])

  useEffect(() => {
    userRef.current = user
  }, [user])

  useEffect(() => {
    profileErrorRef.current = profileError
  }, [profileError])

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
    // A forced retry (Try again / back online) starts a new attempt instead of waiting out
    // a hung read. The generation token drops the stale result.
    if (!force && fetchInProgress.current && profileFetchPromiseRef.current) {
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

    if (!force && fetchInProgress.current) {
      return
    }

    const gen = ++profileFetchGenRef.current
    fetchInProgress.current = true
    setProfileLoadEpoch((n) => n + 1)
    if (force) setProfileError(null)
    devLog('Auth: Fetching profile for', authUser.id)
    const stillCurrent = () => mounted.current && profileFetchGenRef.current === gen

    const loadPromise = (async () => {
      if (browserIsOnline()) {
        try {
          const { error: signupErr } = await withTimeout(
            supabase.rpc('apply_my_signup_profile'),
            8000
          )
          if (signupErr && !isRpcNotFoundError(signupErr)) {
            console.warn('Auth: apply_my_signup_profile', signupErr.message)
          }
        } catch (signupApplyError) {
          if (!isRpcNotFoundError(signupApplyError)) {
            console.warn('Auth: apply_my_signup_profile', signupApplyError)
          }
        }
      }
      if (!stillCurrent()) return

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

      let data = null
      let failure = null
      let attempt = 0
      while (stillCurrent()) {
        if (!browserIsOnline()) {
          failure = profileFailureFrom(null, 'offline')
          break
        }
        const plan = profileLoadAttemptPlan(attempt)
        if (!plan) {
          failure = failure || profileFailureFrom(null, 'exhausted')
          break
        }
        if (plan.delayMs > 0) {
          await sleep(plan.delayMs)
          if (!stillCurrent()) return
          if (!browserIsOnline()) {
            failure = profileFailureFrom(null, 'offline')
            break
          }
        }
        try {
          data = await withTimeout(loadUserCore(), plan.timeoutMs)
          failure = null
          break
        } catch (err) {
          console.warn(`Auth: profile load attempt ${attempt + 1} failed`, err)
          const decision = nextProfileLoadStep(attempt, browserIsOnline())
          if (decision.action === 'fail') {
            failure = profileFailureFrom(err, decision.code)
            break
          }
          attempt = decision.attemptIndex
        }
      }

      if (!stillCurrent()) return

      if (data) {
        const phase1 = buildPhase1Profile(data, authUser)
        const nextUser = { ...(userRef.current || authUser), ...phase1, uid: authUser.id }
        userRef.current = nextUser
        lastFetchedUid.current = authUser.id
        setProfileError(null)
        setUser(nextUser)
        void saveProfileSnapshot(nextUser)
        devLog('Auth: Profile phase 1 loaded for', authUser.id)

        void (async () => {
          try {
            const { vehicles, requiredSopVersion, syncedPhone } = await withTimeout(loadUserExtras())
            if (!stillCurrent()) return
            try {
              await syncResidentSecurityMembershipFromMetadata(authUser, data)
            } catch (membershipSyncError) {
              console.warn('Auth: security membership sync', membershipSyncError)
            }
            setUser((prev) => {
              if (!prev?.uid || prev.uid !== authUser.id) return prev
              const next = {
                ...prev,
                vehicles,
                requiredSopVersion,
                phone: syncedPhone ?? prev.phone,
              }
              userRef.current = next
              return next
            })
            if (userRef.current?.uid === authUser.id) void saveProfileSnapshot(userRef.current)
            devLog('Auth: Profile phase 2 loaded for', authUser.id)
          } catch (e) {
            console.warn('Auth: Profile phase 2 error:', e)
          }
        })()
        return
      }

      if (!failure) return
      console.error('Auth: Error fetching profile:', failure.message)
      if (failure.code === 'offline' || isOfflineOrNetworkError(failure)) {
        const cached = await withTimeout(readProfileSnapshot(authUser.id), 3000).catch(() => null)
        if (cached?.data?.role && stillCurrent()) {
          const restored = {
            ...(sessionUserForAppState(authUser, { profileLoaded: true }) || {}),
            ...cached.data,
            uid: authUser.id,
            profileLoaded: true,
            profileFromCache: true,
            profileSavedAt: cached.savedAt,
          }
          userRef.current = restored
          lastFetchedUid.current = authUser.id
          setProfileError(null)
          setUser(restored)
          devLog('Auth: Profile restored from offline cache for', authUser.id)
          if (browserIsOnline() && !profileCacheRetryRef.current && typeof window !== 'undefined') {
            profileCacheRetryRef.current = true
            window.setTimeout(() => {
              if (!mounted.current || !userRef.current?.profileFromCache) return
              void fetchUserProfile(authUser, true)
            }, 8000)
          }
          return
        }
      }
      const prev = userRef.current
      if (prev && (prev.uid === authUser.id || prev.id === authUser.id) && hasHydratedAppRole(prev.role)) {
        console.warn('Auth: Profile refetch failed -- preserving existing data.')
        return
      }
      const fallback =
        sessionUserForAppState(authUser, {
          sopVersionAccepted: null,
          requiredSopVersion: null,
          profileLoaded: false,
        }) ?? { uid: authUser.id, profileLoaded: false }
      userRef.current = fallback
      setUser((prevUser) => {
        if (
          prevUser &&
          (prevUser.uid === authUser.id || prevUser.id === authUser.id) &&
          hasHydratedAppRole(prevUser.role)
        ) {
          return prevUser
        }
        return fallback
      })
      setProfileError(failure)
    })()

    profileFetchPromiseRef.current = loadPromise
    try {
      await loadPromise
    } finally {
      if (profileFetchGenRef.current === gen) {
        fetchInProgress.current = false
        if (profileFetchPromiseRef.current === loadPromise) {
          profileFetchPromiseRef.current = null
        }
      }
    }
  }, [])

  const refreshUser = useCallback(async () => {
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (authUser && mounted.current) {
      await fetchUserProfile(authUser, true) // force = true to bypass dedup
    }
  }, [fetchUserProfile])

  const retryProfile = useCallback(async () => {
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser()
      if (authUser && mounted.current) {
        await fetchUserProfile(authUser, true)
      }
    } catch (err) {
      console.warn('Auth: retryProfile', err)
    }
  }, [fetchUserProfile])

  // A dropped connection should recover on its own once the browser is online again.
  useEffect(() => {
    const onOnline = () => {
      const current = userRef.current
      if (!current?.uid && !current?.id) return
      if (hasHydratedAppRole(current.role) && !profileErrorRef.current && !current.profileFromCache) return
      void retryProfile()
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [retryProfile])

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

    const handleAuthEvent = async (_event, session) => {
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
        // Do not block on the profile: a slow or hung fetch must never hold the UI on "Signing you in…".
        if (mounted.current) setLoading(false)
        if (!sessionReadyRef.current && mounted.current) {
          setSessionReady(true)
          devLog(`${AUTH_BOOT_LABEL}: ready from SIGNED_IN in ${Date.now() - bootstrapStartedAtRef.current}ms`)
        }
        if (session?.user) {
          void fetchUserProfile(session.user).catch((e) =>
            console.warn('Auth: SIGNED_IN background profile error:', e)
          )
        }
        return
      }

      if (_event === 'SIGNED_OUT') {
        const previousId = userRef.current?.uid || userRef.current?.id
        void clearOfflineSession(previousId)
        if (mounted.current) {
          lastFetchedUid.current = null
          profileFetchGenRef.current += 1
          userRef.current = null
          setProfileError(null)
          setUser(null)
          setLoading(false)
        }
        return
      }

      // PASSWORD_RECOVERY may need a fresh row; USER_UPDATED fires on password change too — that
      // does not change public.users, and forcing refetch here raced the profile timeout with updateUser’s
      // lock/notifications in embedded browsers (spurious "Profile fetch timeout" in F12).
      const forceRefetch = _event === 'PASSWORD_RECOVERY'
      if (session?.user) {
        void fetchUserProfile(session.user, forceRefetch).catch((error) =>
          console.warn('Auth: Error in auth state change:', error)
        )
      } else if (mounted.current) {
        setUser(null)
      }
      if (mounted.current) setLoading(false)
    }

    // Must stay synchronous and await nothing: supabase-js holds its auth lock while it calls us,
    // so any supabase.* call awaited here deadlocks. Real work is deferred to a timer.
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted.current) return

      // Android Auto hand-off. Runs first so TOKEN_REFRESHED is still synced.
      void syncCarSessionFromAuth(_event, session)

      // Prime a minimal user now so Login's navigate('/dashboard') is not bounced back to /login.
      if (_event === 'SIGNED_IN' && session?.user && lastFetchedUid.current !== session.user.id) {
        setUser((prev) =>
          prev?.uid === session.user.id
            ? prev
            : sessionUserForAppState(session.user, {
                sopVersionAccepted: prev?.sopVersionAccepted ?? null,
                requiredSopVersion: prev?.requiredSopVersion ?? null,
              })
        )
      }

      setTimeout(() => {
        void handleAuthEvent(_event, session)
      }, 0)
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
          void syncCarSessionFromAuth('INITIAL_SESSION', session)
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
            // A failed read is not "signed out"; only sync a known session state.
            if (!error) void syncCarSessionFromAuth('INITIAL_SESSION', session)
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
      // Prompt for POST_NOTIFICATIONS (Android 13+) / iOS when not yet granted; no-op if already granted.
      await registerEmergencyChatPush(user.id, { requestPermission: true })
    })()
    return () => {
      cancelled = true
    }
  }, [user?.id])

  const value = {
    user,
    loading,
    sessionReady,
    profileError,
    profileLoadEpoch,
    refreshUser,
    retryProfile,
    signIn: (email, password) => supabase.auth.signInWithPassword({ email, password }),
    signOut: async () => {
      let userId = userRef.current?.uid || userRef.current?.id || null
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession()
        if (session?.user?.id) {
          userId = session.user.id
          await withTimeout(
            supabase.from('user_push_tokens').delete().eq('user_id', session.user.id),
            5000
          )
        }
      } catch (e) {
        console.warn('Push token cleanup:', e)
      }
      await withTimeout(clearOfflineSession(userId), 3000).catch(() => {})
      try {
        await supabase.auth.signOut()
      } catch (e) {
        console.warn('Auth: signOut:', e)
        try {
          await supabase.auth.signOut({ scope: 'local' })
        } catch {
          /* local keys are cleared below either way */
        }
      }
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

