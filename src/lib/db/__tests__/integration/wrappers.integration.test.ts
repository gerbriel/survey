// Needs the Supabase stack (supabase start, db reset; env SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY); skips itself otherwise.
import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Database } from '@/types/database'
import type { AdminClient, AnonClient, UserClient } from '@/lib/supabase/types'
import type { DbResult } from '../../errors'
import * as admin from '../../admin'
import * as contacts from '../../contacts'
import * as events from '../../events'
import * as exportsDb from '../../exports'
import * as invites from '../../invites'
import * as limits from '../../limits'
import * as privacy from '../../privacy'
import * as profiles from '../../profiles'
import * as publicRead from '../../publicRead'
import * as publish from '../../publish'
import * as reports from '../../reports'
import * as responses from '../../responses'
import * as submission from '../../submission'
import * as surveys from '../../surveys'
import * as workspaces from '../../workspaces'

const URL_ = process.env.SUPABASE_URL
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY

type Role = 'viewer' | 'editor' | 'admin' | 'owner' | 'pa'
const ROLES: Role[] = ['viewer', 'editor', 'admin', 'owner', 'pa']
const RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2, owner: 3, pa: -1 }
const AUTH_CODES = ['not_authorized', 'not_authenticated', 'permission_denied']
const RUN = Date.now().toString(36)
const RANDOM_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'

type Ctx = {
  ws: { id: string; slug: string }
  users: Record<Role, { id: string; client: UserClient }>
  serviceRole: AdminClient
  anon: AnonClient
  /** Fresh survey, created by the editor. */
  newSurvey: () => Promise<{ id: string; draftId: string }>
  /** Fresh live contact, created by the editor. */
  newContact: () => Promise<string>
  importId: string
}

/**
 * Expectation per role: 'allow' means the call is not refused for
 * authorization (it may still fail for state, which proves it got past the
 * role check); 'deny' means an authorization code.
 */
type Expect = (role: Role) => 'allow' | 'deny'
const atLeast = (min: Exclude<Role, 'pa'>, pa: 'allow' | 'deny' = 'deny'): Expect => (role) =>
  role === 'pa' ? pa : RANK[role] >= RANK[min] ? 'allow' : 'deny'
const everyone: Expect = () => 'allow'
const paOnly: Expect = (role) => (role === 'pa' ? 'allow' : 'deny')

type Case = { name: string; expect: Expect; run: (c: UserClient, ctx: Ctx, role: Role) => Promise<DbResult<unknown>> }

const cases: Case[] = [
  { name: 'profiles.getProfile', expect: everyone, run: (c, x, r) => profiles.getProfile(c, { userId: x.users[r].id }) },
  { name: 'profiles.isPlatformAdmin', expect: everyone, run: (c) => profiles.isPlatformAdmin(c) },
  { name: 'workspaces.getWorkspaceBySlug', expect: everyone, run: (c, x) => workspaces.getWorkspaceBySlug(c, { slug: x.ws.slug }) },
  { name: 'workspaces.listMemberships', expect: everyone, run: (c, x, r) => workspaces.listMemberships(c, { userId: x.users[r].id }) },
  { name: 'workspaces.isMember', expect: everyone, run: (c, x) => workspaces.isMember(c, { workspaceId: x.ws.id, minRole: 'editor' }) },
  { name: 'workspaces.isWorkspaceSlugAvailable', expect: everyone, run: (c) => workspaces.isWorkspaceSlugAvailable(c, { slug: `free-${RUN}` }) },
  { name: 'workspaces.renameWorkspaceSlug (same slug, no-op)', expect: atLeast('admin'), run: (c, x) => workspaces.renameWorkspaceSlug(c, { workspaceId: x.ws.id, slug: x.ws.slug }) },
  { name: 'workspaces.transferWorkspaceOwnership (to current owner)', expect: atLeast('owner', 'allow'), run: (c, x) => workspaces.transferWorkspaceOwnership(c, { workspaceId: x.ws.id, newOwnerId: x.users.owner.id }) },
  { name: 'workspaces.requestWorkspaceDeletion (not archived long enough)', expect: atLeast('owner', 'allow'), run: (c, x) => workspaces.requestWorkspaceDeletion(c, { workspaceId: x.ws.id, confirmSlug: 'wrong-slug' }) },
  { name: 'limits.getEffectiveLimits', expect: everyone, run: (c, x) => limits.getEffectiveLimits(c, { workspaceId: x.ws.id }) },
  { name: 'invites.claimPendingInvite', expect: everyone, run: (c) => invites.claimPendingInvite(c) },
  { name: 'invites.claimPlatformInvite (bogus)', expect: everyone, run: (c) => invites.claimPlatformInvite(c, { token: 'bogus-token-123' }) },
  { name: 'invites.acceptWorkspaceInvite (bogus)', expect: everyone, run: (c) => invites.acceptWorkspaceInvite(c, { token: 'bogus-token-123' }) },
  { name: 'surveys.createSurvey', expect: atLeast('editor'), run: (c, x) => surveys.createSurvey(c, { workspaceId: x.ws.id, title: 'Matrix' }) },
  { name: 'surveys.setSurveyAlias (clear)', expect: atLeast('editor'), run: async (c, x) => surveys.setSurveyAlias(c, { surveyId: (await x.newSurvey()).id, alias: null }) },
  { name: 'surveys.takeDraftLock', expect: atLeast('editor'), run: async (c, x) => surveys.takeDraftLock(c, { versionId: (await x.newSurvey()).draftId }) },
  { name: 'surveys.releaseDraftLock', expect: everyone, run: async (c, x) => surveys.releaseDraftLock(c, { versionId: (await x.newSurvey()).draftId }) },
  { name: 'surveys.saveDraft (no lock)', expect: atLeast('editor'), run: async (c, x) => surveys.saveDraft(c, { versionId: (await x.newSurvey()).draftId, expectedRevision: 0, definition: { pages: [] } }) },
  { name: 'publish.publishSurveyVersion (stale revision)', expect: atLeast('editor'), run: async (c, x) => publish.publishSurveyVersion(c, { versionId: (await x.newSurvey()).draftId, expectedRevision: 99, publicDefinition: { pages: [] } }) },
  { name: 'surveys.deleteSurvey', expect: atLeast('admin'), run: async (c, x) => surveys.deleteSurvey(c, { surveyId: (await x.newSurvey()).id }) },
  { name: 'responses.filteredResponses', expect: everyone, run: async (c, x) => responses.filteredResponses(c, { surveyId: (await x.newSurvey()).id }) },
  { name: 'responses.versionQuestions', expect: everyone, run: async (c, x) => responses.versionQuestions(c, { versionId: (await x.newSurvey()).draftId }) },
  { name: 'contacts.searchContacts', expect: everyone, run: (c, x) => contacts.searchContacts(c, { workspaceId: x.ws.id }) },
  { name: 'contacts.contactDuplicateCandidates', expect: everyone, run: (c, x) => contacts.contactDuplicateCandidates(c, { workspaceId: x.ws.id }) },
  { name: 'contacts.setContactCustom', expect: atLeast('editor'), run: async (c, x) => contacts.setContactCustom(c, { contactId: await x.newContact(), values: {} }) },
  { name: 'contacts.importContactsChunk', expect: atLeast('editor'), run: (c, x) => contacts.importContactsChunk(c, { importId: x.importId, rows: [] }) },
  { name: 'contacts.mergeContacts', expect: atLeast('editor'), run: async (c, x) => contacts.mergeContacts(c, { survivorId: await x.newContact(), mergedIds: [await x.newContact()] }) },
  { name: 'privacy.exportRespondentData', expect: atLeast('editor'), run: async (c, x) => privacy.exportRespondentData(c, { contactId: await x.newContact() }) },
  { name: 'privacy.eraseRespondent', expect: atLeast('admin'), run: async (c, x) => privacy.eraseRespondent(c, { contactId: await x.newContact(), mode: 'anonymize' }) },
  { name: 'admin.adminCreateWorkspace', expect: paOnly, run: (c, x, r) => admin.adminCreateWorkspace(c, { name: 'Matrix', slug: `m-${r}-${RUN}`, ownerId: x.users.owner.id }) },
  { name: 'admin.adminSetWorkspaceLimits', expect: paOnly, run: (c, x) => admin.adminSetWorkspaceLimits(c, { workspaceId: x.ws.id, limits: {}, note: 'matrix test' }) },
  { name: 'admin.adminCloseSurvey', expect: paOnly, run: async (c, x) => admin.adminCloseSurvey(c, { surveyId: (await x.newSurvey()).id, reason: 'matrix test' }) },
  { name: 'admin.adminApproveAccessRequest (unknown)', expect: paOnly, run: (c) => admin.adminApproveAccessRequest(c, { requestId: RANDOM_ID }) },
  { name: 'admin.restoreWorkspace (not deleted)', expect: paOnly, run: (c, x) => admin.restoreWorkspace(c, { workspaceId: x.ws.id }) },
  { name: 'admin.platformStorageUsage', expect: paOnly, run: (c) => admin.platformStorageUsage(c) },
  // Lifecycle last: archive then unarchive leaves the workspace as it was.
  { name: 'workspaces.archiveWorkspace', expect: atLeast('owner', 'allow'), run: (c, x) => workspaces.archiveWorkspace(c, { workspaceId: x.ws.id }) },
  { name: 'workspaces.unarchiveWorkspace', expect: atLeast('owner', 'allow'), run: (c, x) => workspaces.unarchiveWorkspace(c, { workspaceId: x.ws.id }) },
]

describe.skipIf(!URL_ || !ANON || !SERVICE)('src/lib/db wrappers against the Supabase stack', () => {
  const ctx = {} as Ctx
  const createdUsers: string[] = []

  beforeAll(async () => {
    const opts = { auth: { persistSession: false, autoRefreshToken: false } }
    const service = createClient<Database>(URL_!, SERVICE!, opts)
    ctx.serviceRole = service as unknown as AdminClient
    ctx.anon = createClient<Database>(URL_!, ANON!, opts) as unknown as AnonClient
    ctx.users = {} as Ctx['users']

    for (const role of ROLES) {
      const email = `${role}-${RUN}@matrix.test`
      const password = `pw-${RUN}-${role}-Aa1!`
      const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true })
      if (error || !data.user) throw error ?? new Error('createUser failed')
      createdUsers.push(data.user.id)
      await service.from('profiles').update({ status: 'active' }).eq('id', data.user.id)
      if (role === 'pa') await service.from('profiles').update({ is_platform_admin: true }).eq('id', data.user.id)
      const client = createClient<Database>(URL_!, ANON!, opts)
      const signIn = await client.auth.signInWithPassword({ email, password })
      if (signIn.error) throw signIn.error
      ctx.users[role] = { id: data.user.id, client: client as unknown as UserClient }
    }

    const slug = `matrix-${RUN}`
    const created = await admin.adminCreateWorkspace(ctx.users.pa.client, { name: 'Matrix', slug, ownerId: ctx.users.owner.id })
    if (!created.ok) throw new Error(created.error.code)
    ctx.ws = { id: created.data, slug }

    const owner = ctx.users.owner.client
    for (const role of ['admin', 'editor', 'viewer'] as const) {
      const inv = await owner
        .from('workspace_invites')
        .insert({ workspace_id: ctx.ws.id, role, created_by: ctx.users.owner.id })
        .select('token')
        .single()
      if (inv.error) throw inv.error
      const r = await invites.acceptWorkspaceInvite(ctx.users[role].client, { token: inv.data.token })
      if (!r.ok || r.data.status !== 'joined') throw new Error(`join ${role} failed`)
    }

    const editor = ctx.users.editor.client
    ctx.newSurvey = async () => {
      const s = await surveys.createSurvey(editor, { workspaceId: ctx.ws.id, title: 'Fixture' })
      if (!s.ok) throw new Error(s.error.code)
      const row = await editor.from('surveys').select('current_draft_version_id').eq('id', s.data).single()
      if (row.error || !row.data.current_draft_version_id) throw row.error ?? new Error('no draft')
      return { id: s.data, draftId: row.data.current_draft_version_id }
    }
    let n = 0
    ctx.newContact = async () => {
      n += 1
      const row = await editor
        .from('contacts')
        .insert({ workspace_id: ctx.ws.id, email: `c${n}-${RUN}@matrix.test`, created_by: ctx.users.editor.id })
        .select('id')
        .single()
      if (row.error) throw row.error
      return row.data.id
    }
    const imp = await editor
      .from('contact_imports')
      .insert({ workspace_id: ctx.ws.id, created_by: ctx.users.editor.id })
      .select('id')
      .single()
    if (imp.error) throw imp.error
    ctx.importId = imp.data.id
  }, 60_000)

  afterAll(async () => {
    if (!ctx.serviceRole) return
    const service = ctx.serviceRole
    for (const id of createdUsers) await service.auth.admin.deleteUser(id).catch(() => undefined)
  })

  for (const c of cases) {
    for (const role of ROLES) {
      const want = c.expect(role)
      it(`${c.name} as ${role}: ${want}`, async () => {
        const r = await c.run(ctx.users[role].client, ctx, role)
        if (want === 'deny') {
          expect(r.ok).toBe(false)
          if (!r.ok) expect(AUTH_CODES).toContain(r.error.code)
        } else if (!r.ok) {
          expect(AUTH_CODES).not.toContain(r.error.code)
        }
      })
    }
  }

  describe('service role wrappers', () => {
    it('submitResponse refuses an unknown survey with a code, not an error', async () => {
      const r = await submission.submitResponse(ctx.serviceRole, {
        action: 'save',
        survey_id: RANDOM_ID,
        survey_version_id: RANDOM_ID,
        idempotency_key: RANDOM_ID,
        answers: {},
        visible_keys: [],
      })
      expect(r).toEqual({ ok: true, data: { ok: false, code: 'not_found' } })
    })
    it('createUpload', async () => {
      const r = await submission.createUpload(ctx.serviceRole, {
        survey_id: RANDOM_ID,
        survey_version_id: RANDOM_ID,
        question_key: 'q_abcdefgh',
        name: 'a.pdf',
        size: 10,
        mime: 'application/pdf',
      })
      expect(r).toEqual({ ok: true, data: { ok: false, code: 'not_found' } })
    })
    it('rateLimitHit', async () => {
      const r = await submission.rateLimitHit(ctx.serviceRole, { bucket: 'matrix', key: RUN, window: '1 minute', max: 1 })
      expect(r).toEqual({ ok: true, data: true })
    })
    it('recordEvents drops events for unknown surveys', async () => {
      const r = await events.recordEvents(ctx.serviceRole, [{ survey_id: RANDOM_ID, survey_version_id: RANDOM_ID, type: 'view' }])
      expect(r).toEqual({ ok: true, data: 0 })
    })
    it('sharedReportPayload returns null for an unknown token', async () => {
      expect(await reports.sharedReportPayload(ctx.serviceRole, { token: 'unknown-token' })).toEqual({ ok: true, data: null })
    })
    it('retention, sweep, deletions, purge', async () => {
      expect((await privacy.retentionBatch(ctx.serviceRole, { workspaceId: ctx.ws.id })).ok).toBe(true)
      expect((await exportsDb.storageSweepBatch(ctx.serviceRole)).ok).toBe(true)
      expect((await exportsDb.completeStorageDeletions(ctx.serviceRole, { done: [] })).ok).toBe(true)
      expect((await admin.workspacePurgeDue(ctx.serviceRole)).ok).toBe(true)
      const purge = await admin.purgeWorkspace(ctx.serviceRole, { workspaceId: ctx.ws.id })
      expect(purge).toMatchObject({ ok: false, error: { code: 'not_due' } })
    })
    it('a member cannot call service-role functions', async () => {
      const r = await submission.submitResponse(ctx.users.owner.client as unknown as AdminClient, {
        action: 'save',
        survey_id: RANDOM_ID,
        survey_version_id: RANDOM_ID,
        idempotency_key: RANDOM_ID,
        answers: {},
        visible_keys: [],
      })
      expect(r).toMatchObject({ ok: false, error: { code: 'permission_denied' } })
    })
  })

  describe('anon', () => {
    it('resolvePublicSurvey and getPublicDefinition return null for unknown keys', async () => {
      expect(await publicRead.resolvePublicSurvey(ctx.anon, { key: 'zzzzzzzzzz' })).toEqual({ ok: true, data: null })
      expect(await publicRead.getPublicDefinition(ctx.anon, { versionId: RANDOM_ID, key: 'zzzzzzzzzz' })).toEqual({
        ok: true,
        data: null,
      })
    })
    it('anon cannot call member functions', async () => {
      const r = await surveys.createSurvey(ctx.anon as unknown as UserClient, { workspaceId: ctx.ws.id, title: 'x' })
      expect(r).toMatchObject({ ok: false, error: { code: 'permission_denied' } })
    })
  })
})
