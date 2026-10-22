import { describe, expect, it } from 'vitest'
import * as admin from '../admin'
import * as contacts from '../contacts'
import * as events from '../events'
import * as exportsDb from '../exports'
import * as invites from '../invites'
import * as limits from '../limits'
import * as privacy from '../privacy'
import * as publicRead from '../publicRead'
import * as publish from '../publish'
import * as reports from '../reports'
import * as responses from '../responses'
import * as submission from '../submission'
import * as surveys from '../surveys'
import * as workspaces from '../workspaces'
import { fakeClient, throwingClient } from './fake-client'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const SEED = '00000000-0000-0000-0000-000000000001'
const DEF = { schema_version: 1, pages: [], questions: {} }

describe('zod input schemas', () => {
  it('saveDraftInput', () => {
    expect(surveys.saveDraftInput.safeParse({ versionId: A, expectedRevision: 3, definition: DEF }).success).toBe(true)
    expect(surveys.saveDraftInput.safeParse({ versionId: SEED, expectedRevision: 0, definition: DEF }).success).toBe(true)
    expect(surveys.saveDraftInput.safeParse({ versionId: 'nope', expectedRevision: 3, definition: DEF }).success).toBe(false)
    expect(surveys.saveDraftInput.safeParse({ versionId: A, expectedRevision: -1, definition: DEF }).success).toBe(false)
    expect(surveys.saveDraftInput.safeParse({ versionId: A, expectedRevision: 1.5, definition: DEF }).success).toBe(false)
    expect(surveys.saveDraftInput.safeParse({ versionId: A, expectedRevision: 1, definition: { pages: {} } }).success).toBe(false)
    // Extra definition keys are kept, not stripped.
    const r = surveys.saveDraftInput.parse({ versionId: A, expectedRevision: 1, definition: { ...DEF, theme: { x: 1 } } })
    expect(r.definition).toHaveProperty('theme')
  })

  it('submitPayload', () => {
    const base = {
      action: 'complete',
      survey_id: A,
      survey_version_id: B,
      idempotency_key: A,
      answers: { q_abcdefgh: 'x' },
      visible_keys: ['q_abcdefgh'],
    } as const
    const parsed = submission.submitPayload.parse(base)
    expect(parsed.metadata).toEqual({})
    expect(parsed.file_ids).toEqual([])
    expect(submission.submitPayload.safeParse({ ...base, action: 'final' }).success).toBe(false)
    expect(submission.submitPayload.safeParse({ ...base, resume_token_hash: 'plain-secret' }).success).toBe(false)
    expect(submission.submitPayload.safeParse({ ...base, resume_token_hash: 'a'.repeat(64) }).success).toBe(true)
    expect(submission.submitPayload.safeParse({ ...base, survey_id: undefined }).success).toBe(false)
  })

  it('mergeContactsInput', () => {
    expect(contacts.mergeContactsInput.safeParse({ survivorId: A, mergedIds: [B] }).success).toBe(true)
    expect(contacts.mergeContactsInput.safeParse({ survivorId: A, mergedIds: [] }).success).toBe(false)
    expect(contacts.mergeContactsInput.safeParse({ survivorId: A, mergedIds: [B, B, B, B, B] }).success).toBe(false)
    expect(contacts.mergeContactsInput.safeParse({ survivorId: A, mergedIds: [B], fieldChoices: { email: 'x' } }).success).toBe(false)
  })

  it('setLimitsInput refuses unknown limit keys and blank notes', () => {
    expect(admin.setLimitsInput.safeParse({ workspaceId: A, limits: { max_questions: 500 }, note: 'Big intake form' }).success).toBe(true)
    expect(admin.setLimitsInput.safeParse({ workspaceId: A, limits: { max_widgets: 5 }, note: 'x' }).success).toBe(false)
    expect(admin.setLimitsInput.safeParse({ workspaceId: A, limits: {}, note: '   ' }).success).toBe(false)
  })

  it('workspace slug rules match the SQL check', () => {
    expect(admin.createWorkspaceInput.safeParse({ name: 'HR', slug: 'human-resources', ownerId: A }).success).toBe(true)
    expect(admin.createWorkspaceInput.parse({ name: 'HR', slug: ' HR-Team ', ownerId: A }).slug).toBe('hr-team')
    expect(admin.createWorkspaceInput.safeParse({ name: 'HR', slug: 'hr--x', ownerId: A }).success).toBe(false)
    expect(admin.createWorkspaceInput.safeParse({ name: 'HR', slug: 'ab', ownerId: A }).success).toBe(false)
    expect(admin.createWorkspaceInput.safeParse({ name: '', slug: 'abc', ownerId: A }).success).toBe(false)
  })

  it('recordEventsInput caps the batch at 50 and known types', () => {
    const e = { survey_id: A, survey_version_id: B, type: 'view' as const }
    expect(events.recordEventsInput.safeParse(Array(50).fill(e)).success).toBe(true)
    expect(events.recordEventsInput.safeParse(Array(51).fill(e)).success).toBe(false)
    expect(events.recordEventsInput.safeParse([{ ...e, type: 'complete' }]).success).toBe(false)
  })
})

describe('wrappers call the exact SQL function and argument names', () => {
  const cases: [string, (f: ReturnType<typeof fakeClient>) => Promise<unknown>, string, unknown][] = [
    ['createSurvey', (f) => surveys.createSurvey(f.user, { workspaceId: A, title: 'T' }), 'create_survey', { p_workspace_id: A, p_title: 'T' }],
    ['createSurvey template', (f) => surveys.createSurvey(f.user, { workspaceId: A, title: 'T', templateId: B }), 'create_survey', { p_workspace_id: A, p_title: 'T', p_template_id: B }],
    ['setSurveyAlias clear', (f) => surveys.setSurveyAlias(f.user, { surveyId: A, alias: null }), 'set_survey_alias', { p_survey_id: A, p_alias: null }],
    ['takeDraftLock', (f) => surveys.takeDraftLock(f.user, { versionId: A }), 'take_draft_lock', { p_version_id: A, p_force: false }],
    ['releaseDraftLock', (f) => surveys.releaseDraftLock(f.user, { versionId: A }), 'release_draft_lock', { p_version_id: A }],
    ['saveDraft', (f) => surveys.saveDraft(f.user, { versionId: A, expectedRevision: 2, definition: DEF }), 'save_draft', { p_version_id: A, p_expected_revision: 2, p_definition: DEF }],
    ['deleteSurvey', (f) => surveys.deleteSurvey(f.user, { surveyId: A }), 'delete_survey', { p_survey_id: A }],
    ['publish', (f) => publish.publishSurveyVersion(f.user, { versionId: A, expectedRevision: 2, publicDefinition: DEF }), 'publish_survey_version', { p_version_id: A, p_expected_revision: 2, p_public_definition: DEF }],
    ['resolvePublicSurvey', (f) => publicRead.resolvePublicSurvey(f.anon, { key: 'abc' }), 'resolve_public_survey', { p_key: 'abc' }],
    ['getPublicDefinition', (f) => publicRead.getPublicDefinition(f.anon, { versionId: A, key: 'abc' }), 'get_public_definition', { p_version_id: A, p_key: 'abc' }],
    ['claimPendingInvite', (f) => invites.claimPendingInvite(f.user), 'claim_pending_invite', undefined],
    ['claimPlatformInvite', (f) => invites.claimPlatformInvite(f.user, { token: 'tok12345' }), 'claim_platform_invite', { p_token: 'tok12345' }],
    ['acceptWorkspaceInvite', (f) => invites.acceptWorkspaceInvite(f.user, { token: 'tok12345' }), 'accept_workspace_invite', { p_token: 'tok12345' }],
    ['transfer', (f) => workspaces.transferWorkspaceOwnership(f.user, { workspaceId: A, newOwnerId: B }), 'transfer_workspace_ownership', { p_workspace_id: A, p_new_owner: B }],
    ['rename', (f) => workspaces.renameWorkspaceSlug(f.user, { workspaceId: A, slug: 'new-slug' }), 'rename_workspace_slug', { p_workspace_id: A, p_slug: 'new-slug' }],
    ['archive', (f) => workspaces.archiveWorkspace(f.user, { workspaceId: A }), 'archive_workspace', { p_workspace_id: A }],
    ['unarchive', (f) => workspaces.unarchiveWorkspace(f.user, { workspaceId: A }), 'unarchive_workspace', { p_workspace_id: A }],
    ['requestDeletion', (f) => workspaces.requestWorkspaceDeletion(f.user, { workspaceId: A, confirmSlug: 'hr' }), 'request_workspace_deletion', { p_workspace_id: A, p_confirm_slug: 'hr' }],
    ['slugAvailable', (f) => workspaces.isWorkspaceSlugAvailable(f.user, { slug: 'abc' }), 'workspace_slug_available', { p_slug: 'abc' }],
    ['isMember', (f) => workspaces.isMember(f.user, { workspaceId: A }), 'is_member', { p_workspace_id: A, p_min_role: 'viewer' }],
    ['adminCreateWorkspace', (f) => admin.adminCreateWorkspace(f.user, { name: 'HR', slug: 'hr-team', ownerId: A }), 'admin_create_workspace', { p_name: 'HR', p_slug: 'hr-team', p_owner: A }],
    ['adminSetWorkspaceLimits', (f) => admin.adminSetWorkspaceLimits(f.user, { workspaceId: A, limits: { max_questions: 9 }, note: 'n' }), 'admin_set_workspace_limits', { p_workspace_id: A, p_limits: { max_questions: 9 }, p_note: 'n' }],
    ['adminCloseSurvey', (f) => admin.adminCloseSurvey(f.user, { surveyId: A, reason: 'spam' }), 'admin_close_survey', { p_survey_id: A, p_reason: 'spam' }],
    ['adminApproveAccessRequest', (f) => admin.adminApproveAccessRequest(f.user, { requestId: A }), 'admin_approve_access_request', { p_request_id: A }],
    ['restoreWorkspace', (f) => admin.restoreWorkspace(f.user, { workspaceId: A }), 'restore_workspace', { p_workspace_id: A }],
    ['platformStorageUsage', (f) => admin.platformStorageUsage(f.user), 'platform_storage_usage', undefined],
    ['workspacePurgeDue', (f) => admin.workspacePurgeDue(f.admin), 'workspace_purge_due', { p_limit: 10 }],
    ['purgeWorkspace', (f) => admin.purgeWorkspace(f.admin, { workspaceId: A }), 'purge_workspace', { p_workspace_id: A }],
    ['setContactCustom', (f) => contacts.setContactCustom(f.user, { contactId: A, values: { k: 1 } }), 'set_contact_custom', { p_contact_id: A, p_values: { k: 1 } }],
    ['searchContacts', (f) => contacts.searchContacts(f.user, { workspaceId: A }), 'search_contacts', { p_workspace_id: A, p_filters: {}, p_limit: 50 }],
    ['duplicates', (f) => contacts.contactDuplicateCandidates(f.user, { workspaceId: A }), 'contact_duplicate_candidates', { p_workspace_id: A }],
    ['import', (f) => contacts.importContactsChunk(f.user, { importId: A, rows: [{ email: 'a@b.co' }] }), 'import_contacts_chunk', { p_import_id: A, p_rows: [{ email: 'a@b.co' }] }],
    ['merge', (f) => contacts.mergeContacts(f.user, { survivorId: A, mergedIds: [B] }), 'merge_contacts', { p_survivor: A, p_merged: [B], p_field_choices: {} }],
    ['filteredResponses', (f) => responses.filteredResponses(f.user, { surveyId: A }), 'filtered_responses', { p_survey_id: A, p_filters: {} }],
    ['versionQuestions', (f) => responses.versionQuestions(f.user, { versionId: A }), 'version_questions', { p_version_id: A }],
    ['erase', (f) => privacy.eraseRespondent(f.user, { contactId: A, mode: 'hard' }), 'erase_respondent', { p_contact_id: A, p_mode: 'hard' }],
    ['exportRespondentData', (f) => privacy.exportRespondentData(f.user, { contactId: A }), 'export_respondent_data', { p_contact_id: A }],
    ['retention', (f) => privacy.retentionBatch(f.admin, { workspaceId: A }), 'retention_batch', { p_workspace_id: A, p_limit: 1000 }],
    ['sweep', (f) => exportsDb.storageSweepBatch(f.admin), 'storage_sweep_batch', { p_limit: 500 }],
    ['completeDeletions', (f) => exportsDb.completeStorageDeletions(f.admin, { done: [1] }), 'complete_storage_deletions', { p_done: [1], p_failed: [] }],
    ['sharedReport', (f) => reports.sharedReportPayload(f.admin, { token: 'tok12345' }), 'shared_report_payload', { p_token: 'tok12345', p_password: null }],
    ['recordEvents', (f) => events.recordEvents(f.admin, []), 'record_events', { p_events: [] }],
    ['rateLimitHit', (f) => submission.rateLimitHit(f.admin, { bucket: 'submit', key: 'ip', window: '1 hour', max: 20 }), 'rate_limit_hit', { p_bucket: 'submit', p_key: 'ip', p_window: '1 hour', p_max: 20 }],
    ['effectiveLimits', (f) => limits.getEffectiveLimits(f.user, { workspaceId: A }), 'effective_limits', { p_workspace_id: A }],
    // Migration 0018
    ['logExport', (f) => exportsDb.logExport(f.user, { workspaceId: A, kind: 'summary', scope: { survey_id: B }, rowCount: 3 }), 'log_export', { p_workspace_id: A, p_kind: 'summary', p_scope: { survey_id: B }, p_row_count: 3 }],
    ['finishImport', (f) => contacts.finishImport(f.user, { importId: A }), 'finish_import', { p_import_id: A, p_summary: { status: 'done' } }],
    ['adminWorkspaceStats', (f) => admin.adminWorkspaceStats(f.user), 'admin_workspace_stats', undefined],
    ['invitePreview', (f) => invites.invitePreview(f.user, { token: 'tok12345' }), 'invite_preview', { p_token: 'tok12345' }],
    ['membersWithEmail', (f) => workspaces.listMembersWithEmail(f.user, { workspaceId: A }), 'workspace_members_with_email', { p_workspace_id: A }],
    ['pendingStorageDeletions', (f) => admin.pendingStorageDeletions(f.admin, { workspaceId: A }), 'pending_storage_deletions', { p_workspace_id: A }],
    ['issuePlatformInvite', (f) => admin.adminIssuePlatformInvite(f.user, { email: 'A@b.co', note: null, expiresInDays: 7 }), 'admin_issue_platform_invite', { p_email: 'a@b.co', p_expires_in_days: 7 }],
    ['revokePlatformInvite', (f) => admin.adminRevokePlatformInvite(f.user, { inviteId: A }), 'admin_revoke_platform_invite', { p_invite_id: A }],
    ['updatePrivacyNotice', (f) => admin.adminUpdatePrivacyNotice(f.user, { markdown: '# N' }), 'admin_update_privacy_notice', { p_markdown: '# N' }],
    ['dismissAccess', (f) => admin.adminDismissAccessRequest(f.user, { requestId: A }), 'admin_dismiss_access_request', { p_request_id: A }],
    ['dismissWorkspace', (f) => admin.adminDismissWorkspaceRequest(f.user, { requestId: A }), 'admin_dismiss_workspace_request', { p_request_id: A }],
    ['hashSharePassword', (f) => reports.hashSharePassword(f.user, { password: 'secret12' }), 'hash_share_password', { p_password: 'secret12' }],
    ['shareGate', (f) => reports.reportShareGate(f.admin, { token: 'tok12345' }), 'report_share_gate', { p_token: 'tok12345' }],
    ['shareGate password', (f) => reports.reportShareGate(f.admin, { token: 'tok12345', password: 'pw' }), 'report_share_gate', { p_token: 'tok12345', p_password: 'pw' }],
  ]

  it.each(cases)('%s', async (_name, run, fn, args) => {
    const f = fakeClient()
    const r = (await run(f)) as { ok: boolean }
    expect(r.ok).toBe(true)
    expect(f.calls).toEqual([{ fn, args }])
  })

  it('submitResponse sends one jsonb payload with defaults applied', async () => {
    const f = fakeClient({ data: { ok: false, code: 'cap_reached' }, error: null })
    const r = await submission.submitResponse(f.admin, {
      action: 'save',
      survey_id: A,
      survey_version_id: B,
      idempotency_key: A,
      answers: {},
      visible_keys: [],
    })
    expect(f.calls[0]?.fn).toBe('submit_response')
    expect(f.calls[0]?.args).toEqual({
      p_payload: { action: 'save', survey_id: A, survey_version_id: B, idempotency_key: A, answers: {}, visible_keys: [], metadata: {}, file_ids: [] },
    })
    expect(r).toEqual({ ok: true, data: { ok: false, code: 'cap_reached' } })
  })
})

describe('0018 wrappers map results', () => {
  it('reportShareGate reads status and hides report_id unless open', async () => {
    const open = fakeClient({ data: { status: 'open', report_id: A }, error: null })
    expect(await reports.reportShareGate(open.admin, { token: 'tok12345' })).toEqual({ ok: true, data: { status: 'open', report_id: A } })
    const pw = fakeClient({ data: { status: 'needs_password', report_id: null }, error: null })
    expect(await reports.reportShareGate(pw.admin, { token: 'tok12345' })).toEqual({ ok: true, data: { status: 'needs_password', report_id: null } })
    const odd = fakeClient({ data: { status: 'weird', report_id: A }, error: null })
    expect(await reports.reportShareGate(odd.admin, { token: 'tok12345' })).toEqual({ ok: true, data: { status: 'not_found', report_id: null } })
  })

  it('logExport refuses an unknown kind before the network', async () => {
    const f = fakeClient()
    const r = await exportsDb.logExport(f.user, { workspaceId: A, kind: 'everything' as never, rowCount: 1 })
    expect(r.ok).toBe(false)
    expect(f.calls).toEqual([])
  })

  it('hashSharePassword enforces 6 to 200 characters', async () => {
    const f = fakeClient()
    expect((await reports.hashSharePassword(f.user, { password: 'short' })).ok).toBe(false)
    expect(f.calls).toEqual([])
  })
})

describe('result and error flow', () => {
  it('invalid input never reaches the network', async () => {
    const f = fakeClient()
    const r = await surveys.saveDraft(f.user, { versionId: 'x', expectedRevision: 1, definition: DEF })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.code).toBe('invalid_input')
      expect(r.error.detail).toContain('versionId')
    }
    expect(f.calls).toHaveLength(0)
  })

  it('maps a SQL exception into DbError', async () => {
    const f = fakeClient({ data: null, error: { message: 'revision_conflict', code: 'P0001', details: null, hint: null } })
    const r = await surveys.saveDraft(f.user, { versionId: A, expectedRevision: 1, definition: DEF })
    expect(r).toMatchObject({ ok: false, error: { code: 'revision_conflict', category: 'conflict' } })
  })

  it('maps a thrown fetch error to network', async () => {
    const r = await surveys.releaseDraftLock(throwingClient(new TypeError('fetch failed')), { versionId: A })
    expect(r).toMatchObject({ ok: false, error: { code: 'network' } })
  })

  it('public reads return null for an unknown key', async () => {
    const f = fakeClient({ data: null, error: null })
    expect(await publicRead.resolvePublicSurvey(f.anon, { key: 'zzzzzzzzzz' })).toEqual({ ok: true, data: null })
    expect(await publicRead.getPublicDefinition(f.anon, { versionId: A, key: 'zz' })).toEqual({ ok: true, data: null })
  })

  it('invite claims fall back to invalid on an unexpected shape', async () => {
    const good = fakeClient({ data: { status: 'joined', workspace_id: A }, error: null })
    expect(await invites.acceptWorkspaceInvite(good.user, { token: 'tok12345' })).toEqual({
      ok: true,
      data: { status: 'joined', workspace_id: A },
    })
    const bad = fakeClient({ data: { status: 'weird' }, error: null })
    expect(await invites.acceptWorkspaceInvite(bad.user, { token: 'tok12345' })).toEqual({
      ok: true,
      data: { status: 'invalid', workspace_id: null },
    })
  })
})
