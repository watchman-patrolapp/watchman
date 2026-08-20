import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../auth/useAuth'

/**
 * useSupabaseQuery
 * A stable data-fetching hook for Supabase queries that handles auth,
 * mounting state, and prevents infinite loops from inline queryFn references.
 *
 * Usage:
 *   const { data, loading, error, refetch } = useSupabaseQuery(
 *     () => supabase.from('table').select('*'),
 *     [someDepThatShouldRetrigger]
 *   )
 */
export function useSupabaseQuery(queryFn, deps = [], options = {}) {
  const { enabled = true } = options
  const { user } = useAuth()

  const [data, setData] = useState(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null) // always string | null

  // Stable ref for queryFn — prevents infinite loops when caller passes inline
  // arrow functions, which are recreated on every render
  const queryFnRef = useRef(queryFn)
  useEffect(() => {
    queryFnRef.current = queryFn
  })

  // isMounted tracks whether the hook is still active — initialised here (not
  // inside the effect) so concurrent async calls don't reset each other's flag
  const isMounted = useRef(true)
  const fetchGen = useRef(0)
  useEffect(() => {
    isMounted.current = true
    return () => {
      isMounted.current = false
    }
  }, [])

  const fetchData = useCallback(async () => {
    const gen = ++fetchGen.current
    if (!enabled) {
      if (isMounted.current && gen === fetchGen.current) {
        setLoading(false)
      }
      return
    }

    if (!user) {
      if (isMounted.current && gen === fetchGen.current) {
        setData(undefined)
        setError('Not authenticated')
        setLoading(false)
      }
      return
    }

    if (isMounted.current && gen === fetchGen.current) {
      setLoading(true)
      setError(null)
    }

    try {
      const result = await queryFnRef.current()
      if (isMounted.current && gen === fetchGen.current) {
        setData(result)
        setError(null)
      }
    } catch (err) {
      if (isMounted.current && gen === fetchGen.current) {
        console.error('useSupabaseQuery error:', err)
        setError(err.message || 'An error occurred')
        setData(undefined)
      }
    } finally {
      if (isMounted.current && gen === fetchGen.current) {
        setLoading(false)
      }
    }
  }, [user, enabled])
  // Note: queryFnRef is intentionally excluded — it's a ref, always stable.

  // Single effect: user/enabled (via fetchData) + caller deps — avoids double-fetch on mount.
  useEffect(() => {
    fetchData()
  }, [fetchData, ...deps])

  const refetch = useCallback(() => {
    fetchData()
  }, [fetchData])

  return { data, loading, error, refetch }
}
