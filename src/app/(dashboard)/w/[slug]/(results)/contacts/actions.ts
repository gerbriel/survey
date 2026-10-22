'use server'

import { revalidatePath } from 'next/cache'
import { requireMember } from '@/lib/auth'
import {
  finishImport,
  importContactsChunk,
  mergeContacts,
  setContactCustom,
  addNote,
  createContact,
  createContactView,
  createFieldDef,
  createImport,
  deleteContactView,
  deleteNote,
  dismissDuplicate,
  editNote,
  listContactsByIds,
  updateContact,
  updateFieldDef,
  type Contact,
  type ContactPatch,
  type ContactNote,
} from '@/lib/db/contacts'
import type { ContactFilters, ImportChunkResult } from '@/lib/db/contacts'
import { normalizeEmail, normalizeTag } from '@/lib/crm/email'
import { prepareImportRows, type ImportOptions } from '@/lib/crm/importServer'
import { generateLinks } from '@/lib/crm/tokens'
import { logExport } from '@/lib/db/exports'
import { normalizePhone } from '@/lib/crm/phone'
import type { Mapping, ImportRow } from '@/lib/crm/import'

/**
 * Contact mutations. Each action runs requireMember for UX; RLS and the SQL
 * functions are the authorization. Viewers never reach these from the UI.
 */
export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; message: string }

const fail = (message: string): { ok: false; message: string } => ({ ok: false, message })
const base = (slug: string) => `/w/${slug}/contacts`

export async function updateContactAction(
  slug: string,
  contactId: string,
  patch: ContactPatch,
): Promise<ActionResult<Contact>> {
  const { supabase, workspace } = await requireMember(slug, 'editor')
  const clean: ContactPatch = { ...patch }
  if ('email' in clean && clean.email) {
    const e = normalizeEmail(clean.email)
    if (!e) return fail('Enter a valid email address.')
    clean.email = e
  }
  if ('phone' in clean && clean.phone) {
    const p = normalizePhone(clean.phone, workspace.default_country)
    if (!p) return fail(`That phone number could not be read for country ${workspace.default_country}.`)
    clean.phone = p
  }
  if (clean.tags) clean.tags = [...new Set(clean.tags.map(normalizeTag).filter(Boolean))]
  const r = await updateContact(supabase, { contactId, patch: clean })
  if (!r.ok) return fail(r.error.code === 'unique_violation' ? 'Another contact already has that email.' : r.error.message)
  revalidatePath(`${base(slug)}/${contactId}`)
  return { ok: true, data: r.data }
}

export async function setCustomAction(
  slug: string,
  contactId: string,
  values: Record<string, unknown>,
): Promise<ActionResult<Record<string, unknown>>> {
  const { supabase } = await requireMember(slug, 'editor')
  const r = await setContactCustom(supabase, { contactId, values })
  if (!r.ok) {
    // D-14: the canned message only; SQL detail stays in the server log.
    if (r.error.detail) console.error('set_contact_custom failed', r.error.code, r.error.detail)
    return fail(r.error.message)
  }
  revalidatePath(`${base(slug)}/${contactId}`)
  return { ok: true, data: r.data }
}

export async function addNoteAction(slug: string, contactId: string, body: string): Promise<ActionResult<ContactNote>> {
  const { supabase, workspace, user } = await requireMember(slug, 'editor')
  const r = await addNote(supabase, { workspaceId: workspace.id, contactId, author: user.id, body })
  if (!r.ok) return fail(r.error.message)
  revalidatePath(`${base(slug)}/${contactId}`)
  return { ok: true, data: r.data }
}

export async function editNoteAction(slug: string, contactId: string, noteId: string, body: string): Promise<ActionResult> {
  const { supabase } = await requireMember(slug, 'editor')
  const r = await editNote(supabase, { noteId, body })
  if (!r.ok) return fail(r.error.message)
  revalidatePath(`${base(slug)}/${contactId}`)
  return { ok: true, data: undefined }
}

export async function deleteNoteAction(slug: string, contactId: string, noteId: string): Promise<ActionResult> {
  const { supabase } = await requireMember(slug, 'editor')
  const r = await deleteNote(supabase, { noteId })
  if (!r.ok) return fail('Only the author or an admin can delete this note.')
  revalidatePath(`${base(slug)}/${contactId}`)
  return { ok: true, data: undefined }
}

/** Bulk add or remove tags. One update per contact under RLS (no bulk SQL function exists). */
export async function bulkTagAction(
  slug: string,
  contactIds: string[],
  add: string[],
  remove: string[],
): Promise<ActionResult<{ updated: number; failed: number }>> {
  const { supabase, workspace } = await requireMember(slug, 'editor')
  const addT = add.map(normalizeTag).filter(Boolean)
  const remT = new Set(remove.map(normalizeTag).filter(Boolean))
  const list = await listContactsByIds(supabase, { workspaceId: workspace.id, ids: contactIds.slice(0, 500) })
  if (!list.ok) return fail(list.error.message)
  let updated = 0
  let failed = 0
  for (const c of list.data) {
    const tags = [...new Set([...c.tags, ...addT])].filter((t) => !remT.has(t))
    if (tags.length === c.tags.length && tags.every((t) => c.tags.includes(t))) continue
    const r = await updateContact(supabase, { contactId: c.id, patch: { tags } })
    if (r.ok) updated++
    else failed++
  }
  revalidatePath(base(slug))
  return { ok: true, data: { updated, failed } }
}

export async function createContactAction(
  slug: string,
  input: { email: string; first_name: string; last_name: string; company: string; phone: string },
): Promise<ActionResult<string>> {
  const { supabase, workspace } = await requireMember(slug, 'editor')
  const email = input.email.trim() ? normalizeEmail(input.email) : null
  if (input.email.trim() && !email) return fail('Enter a valid email address.')
  const phone = input.phone.trim() ? normalizePhone(input.phone, workspace.default_country) : null
  if (input.phone.trim() && !phone) return fail('That phone number could not be read.')
  if (!email && !input.first_name.trim() && !input.last_name.trim()) return fail('Give the contact an email or a name.')
  const r = await createContact(supabase, {
    workspaceId: workspace.id,
    email,
    first_name: input.first_name,
    last_name: input.last_name,
    company: input.company,
    phone,
  })
  if (!r.ok) return fail(r.error.code === 'unique_violation' ? 'A contact with that email already exists.' : r.error.message)
  revalidatePath(base(slug))
  return { ok: true, data: r.data }
}

export async function saveViewAction(
  slug: string,
  input: { name: string; shared: boolean; filters: ContactFilters; columns: string[] },
): Promise<ActionResult<string>> {
  const { supabase, workspace, user } = await requireMember(slug, 'viewer')
  const r = await createContactView(supabase, {
    workspaceId: workspace.id,
    createdBy: user.id,
    name: input.name,
    shared: input.shared,
    filters: input.filters as Record<string, unknown>,
    columns: input.columns,
  })
  if (!r.ok) return fail(input.shared ? 'Only editors can save shared views.' : r.error.message)
  revalidatePath(base(slug))
  return { ok: true, data: r.data }
}

export async function deleteViewAction(slug: string, viewId: string): Promise<ActionResult> {
  const { supabase } = await requireMember(slug, 'viewer')
  const r = await deleteContactView(supabase, { viewId })
  if (!r.ok) return fail('This view cannot be deleted.')
  revalidatePath(base(slug))
  return { ok: true, data: undefined }
}

export async function createFieldDefAction(
  slug: string,
  input: { key: string; label: string; type: string; options: string[]; position: number },
): Promise<ActionResult> {
  const { supabase, workspace } = await requireMember(slug, 'editor')
  const r = await createFieldDef(supabase, {
    workspaceId: workspace.id,
    key: input.key,
    label: input.label,
    type: input.type as 'text',
    ...(input.type === 'select' || input.type === 'multiselect' ? { options: input.options } : {}),
    position: input.position,
  })
  if (!r.ok) return fail(r.error.code === 'unique_violation' ? 'That key is already used.' : r.error.message)
  revalidatePath(`${base(slug)}/fields`)
  return { ok: true, data: undefined }
}

export async function updateFieldDefAction(
  slug: string,
  defId: string,
  patch: { label?: string; options?: string[]; position?: number; archived?: boolean },
): Promise<ActionResult> {
  const { supabase } = await requireMember(slug, 'editor')
  const r = await updateFieldDef(supabase, { defId, patch })
  if (!r.ok) return fail(r.error.message)
  revalidatePath(`${base(slug)}/fields`)
  return { ok: true, data: undefined }
}

export async function dismissDuplicateAction(slug: string, a: string, b: string): Promise<ActionResult> {
  const { supabase, workspace, user } = await requireMember(slug, 'editor')
  const r = await dismissDuplicate(supabase, { workspaceId: workspace.id, a, b, userId: user.id })
  if (!r.ok && r.error.code !== 'unique_violation') return fail(r.error.message)
  revalidatePath(`${base(slug)}/duplicates`)
  return { ok: true, data: undefined }
}

export async function mergeAction(
  slug: string,
  survivorId: string,
  mergedIds: string[],
  fieldChoices: Record<string, string>,
): Promise<ActionResult> {
  const { supabase } = await requireMember(slug, 'editor')
  const r = await mergeContacts(supabase, { survivorId, mergedIds, fieldChoices })
  if (!r.ok) return fail(r.error.message)
  revalidatePath(base(slug))
  return { ok: true, data: undefined }
}

export async function startImportAction(
  slug: string,
  mapping: { headers: string[]; mapping: Mapping },
  options: ImportOptions,
): Promise<ActionResult<string>> {
  const { supabase, workspace, user } = await requireMember(slug, 'editor')
  const r = await createImport(supabase, {
    workspaceId: workspace.id,
    createdBy: user.id,
    mapping: mapping as unknown as Record<string, unknown>,
    options: {
      on_match: options.on_match,
      default_tags: options.default_tags.map(normalizeTag).filter(Boolean),
      ...(options.default_status ? { default_status: options.default_status } : {}),
      ...(options.default_owner ? { default_owner: options.default_owner } : {}),
    },
  })
  if (!r.ok) return fail(r.error.message)
  return { ok: true, data: r.data }
}

export async function importChunkAction(
  slug: string,
  importId: string,
  rows: ImportRow[],
): Promise<ActionResult<ImportChunkResult & { contactEmails: string[] }>> {
  const { supabase, workspace } = await requireMember(slug, 'editor')
  const prepared = prepareImportRows(rows, workspace.default_country)
  if (!prepared.ok) return fail(prepared.message)
  const r = await importContactsChunk(supabase, { importId, rows: prepared.rows })
  if (!r.ok) return fail(r.error.message)
  revalidatePath(base(slug))
  return { ok: true, data: { ...r.data, contactEmails: prepared.rows.map((x) => x.email) } }
}

/** Closes the import job with the wizard's final counts (finish_import). */
export async function finishImportAction(
  slug: string,
  importId: string,
  summary: { created: number; updated: number; skipped: number; invalid: number },
): Promise<ActionResult> {
  const { supabase } = await requireMember(slug, 'editor')
  const r = await finishImport(supabase, { importId, summary: { status: 'done', ...summary } })
  if (!r.ok) return fail(r.error.message)
  revalidatePath(base(slug))
  return { ok: true, data: undefined }
}

export async function generateLinksAction(
  slug: string,
  input: { surveyId: string; contactIds?: string[]; emails?: string[]; maxResponses: number },
): Promise<ActionResult<{ csv: string; count: number; skipped: number }>> {
  const { supabase, workspace } = await requireMember(slug, 'editor')
  const r = await generateLinks(supabase, { workspaceId: workspace.id, ...input })
  if (!r.ok) return fail(r.message)
  // S8 (D-04): the personalized link CSV is an export of contact data and
  // tokens. log_export (0018) accepts only responses, contacts, summary and
  // report, so it is logged as kind contacts with scope export = links.
  // Fail closed: no CSV leaves without its activity row.
  const log = await logExport(supabase, {
    workspaceId: workspace.id,
    kind: 'contacts',
    scope: { export: 'links', survey_id: input.surveyId, max_responses: input.maxResponses },
    rowCount: r.data.count,
  })
  if (!log.ok) {
    console.error('link export log failed', log.error.code)
    return fail('Could not record the export. Try again.')
  }
  return { ok: true, data: r.data }
}
