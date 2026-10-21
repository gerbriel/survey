import type { AdminClient, AnonClient, UserClient } from '@/lib/supabase/types'

/** Records rpc calls and answers each with a fixed PostgREST-style result. */
export function fakeClient(result: { data: unknown; error: unknown } = { data: null, error: null }) {
  const calls: { fn: string; args: unknown }[] = []
  const builder = () => {
    const p = Promise.resolve(result)
    return { then: p.then.bind(p), maybeSingle: () => Promise.resolve(result) }
  }
  const client = {
    rpc(fn: string, args?: unknown) {
      calls.push({ fn, args })
      return builder()
    },
  }
  return {
    calls,
    user: client as unknown as UserClient,
    anon: client as unknown as AnonClient,
    admin: client as unknown as AdminClient,
  }
}

/** A client whose rpc throws, like fetch failing. */
export function throwingClient(error: unknown) {
  const client = {
    rpc() {
      throw error
    },
  }
  return client as unknown as UserClient
}
