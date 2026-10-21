'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Table, TBody, THead, Td, Th, Tr } from '@/components/ui/Table'
import { useToast } from '@/components/ui/Toast'

export type ShareItem = {
  id: string
  url: string
  expires_at: string | null
  revoked_at: string | null
  has_password: boolean
  view_count: number
  last_viewed_at: string | null
  created_at: string
  /** Computed on the server so render stays pure. */
  state: 'active' | 'expired' | 'revoked'
}

type Result = { ok: true; url?: string } | { ok: false; error: string }

/**
 * Public share links for a report (doc 04 section 5.4): create with expiry
 * (default 30 days) and an optional password (hashed on the server), copy,
 * revoke at once, view counts. Editors only; the page hides this otherwise.
 */
export function ShareManager({
  shares,
  create,
  revoke,
}: {
  shares: ShareItem[]
  create: (input: { expiresDays: 0 | 7 | 30 | 90 | 365; password: string }) => Promise<Result>
  revoke: (shareId: string) => Promise<Result>
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [pending, start] = useTransition()
  const [days, setDays] = useState<0 | 7 | 30 | 90 | 365>(30)
  const [password, setPassword] = useState('')
  const [fresh, setFresh] = useState<string | null>(null)

  function status(s: ShareItem): { label: string; tone: 'success' | 'neutral' | 'danger' } {
    if (s.state === 'revoked') return { label: 'Revoked', tone: 'danger' }
    if (s.state === 'expired') return { label: 'Expired', tone: 'neutral' }
    return { label: 'Active', tone: 'success' }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      toast('Link copied', 'success')
    } catch {
      toast('Copy failed. Select the link and copy it by hand.', 'error')
    }
  }

  return (
    <section aria-label="Share links" className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 print:hidden">
      <div>
        <h2 className="text-base font-semibold text-fg">Share links</h2>
        <p className="text-xs text-muted">
          Anyone with the link sees this report&apos;s charts with its saved filters. Counts under 3 show as &quot;&lt;3&quot;, and open text answers are never shown.
        </p>
      </div>
      <form
        className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault()
          start(async () => {
            const r = await create({ expiresDays: days, password })
            if (r.ok) {
              setFresh(r.url ?? null)
              setPassword('')
              router.refresh()
            } else toast(r.error, 'error')
          })
        }}
      >
        <Select
          label="Expires"
          value={String(days)}
          onChange={(e) => setDays(Number(e.target.value) as 0 | 7 | 30 | 90 | 365)}
          options={[
            { value: '7', label: 'In 7 days' },
            { value: '30', label: 'In 30 days' },
            { value: '90', label: 'In 90 days' },
            { value: '365', label: 'In 1 year' },
            { value: '0', label: 'Never' },
          ]}
        />
        <Input label="Password (optional)" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} hint="At least 6 characters" />
        <Button type="submit" size="md" loading={pending} className="self-end">
          Create link
        </Button>
      </form>
      {fresh ? (
        <p role="status" className="flex flex-wrap items-center gap-2 text-sm">
          New link: <code className="break-all rounded bg-surface-muted px-1">{fresh}</code>
          <Button size="sm" variant="secondary" onClick={() => copy(fresh)}>
            Copy
          </Button>
        </p>
      ) : null}
      {shares.length ? (
        <Table caption="Share links">
          <THead>
            <Tr>
              <Th>Link</Th>
              <Th>Status</Th>
              <Th>Expires</Th>
              <Th>Password</Th>
              <Th className="text-right">Views</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </Tr>
          </THead>
          <TBody>
            {shares.map((s) => {
              const st = status(s)
              return (
                <Tr key={s.id}>
                  <Td className="max-w-[16rem] truncate">
                    <code title={s.url}>{s.url}</code>
                  </Td>
                  <Td>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </Td>
                  <Td>{s.expires_at ? new Date(s.expires_at).toLocaleDateString('en-US') : 'Never'}</Td>
                  <Td>{s.has_password ? 'Yes' : 'No'}</Td>
                  <Td className="text-right tabular-nums">{s.view_count}</Td>
                  <Td className="flex gap-1">
                    {st.label === 'Active' ? (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => copy(s.url)}>
                          Copy
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            start(async () => {
                              const r = await revoke(s.id)
                              if (r.ok) {
                                toast('Link revoked', 'success')
                                router.refresh()
                              } else toast(r.error, 'error')
                            })
                          }
                        >
                          Revoke
                        </Button>
                      </>
                    ) : null}
                  </Td>
                </Tr>
              )
            })}
          </TBody>
        </Table>
      ) : (
        <p className="text-sm text-muted">No share links yet.</p>
      )}
    </section>
  )
}
