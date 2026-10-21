'use client'

import { useActionState, useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Table, TBody, THead, Td, Th, Tr } from '@/components/ui/Table'
import { Checkbox, FormStatus, SubmitButton, TextArea, fieldError } from '@/components/dashboard/form'
import { InlineAction } from '@/components/dashboard/InlineAction'
import { IDLE, type ActionState } from '@/lib/admin/forms'
import {
  PIXEL_TYPE_LABELS,
  PIXEL_TYPES,
  PIXEL_VALUE_HINTS,
  RAW_SCRIPT_WARNING,
  isRawScriptType,
  rawScriptStateText,
  type PixelType,
} from '@/lib/admin/pixels'

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>

export type PixelView = { id: string; type: PixelType; value: string; label: string; enabled: boolean }

/**
 * Add or edit one pixel (doc 05 section 5.4). GTM and custom script are
 * disabled when the platform admin kill switch is off
 * (effective_limits.raw_script_pixels_allowed); the trigger enforces it too.
 */
export function PixelForm({
  action,
  pixel,
  rawAllowed,
  onDone,
}: {
  action: Action
  pixel?: PixelView
  rawAllowed: boolean
  onDone?: () => void
}) {
  const [type, setType] = useState<PixelType>(pixel?.type ?? 'ga4')
  const [state, run] = useActionState(async (prev: ActionState, form: FormData) => {
    const r = await action(prev, form)
    if (r.status === 'success') onDone?.()
    return r
  }, IDLE)
  const raw = isRawScriptType(type)
  const blocked = raw && !rawAllowed

  return (
    <form action={run} className="flex flex-col gap-4">
      {pixel ? <input type="hidden" name="pixelId" value={pixel.id} /> : null}
      <Select
        label="Type"
        name="type"
        value={type}
        onChange={(e) => setType(e.target.value as PixelType)}
        options={PIXEL_TYPES.map((t) => ({
          value: t,
          label: !rawAllowed && isRawScriptType(t) ? `${PIXEL_TYPE_LABELS[t]} (turned off by a platform admin)` : PIXEL_TYPE_LABELS[t],
          disabled: !rawAllowed && isRawScriptType(t) && pixel?.type !== t,
        }))}
        error={fieldError(state, 'type')}
      />
      {raw ? (
        // S3 (R16): kill switch state and the cross-workspace exposure warning.
        <div role="note" className="flex flex-col gap-2 rounded-md border border-warning p-3 text-sm">
          <p className="font-medium">{rawScriptStateText(rawAllowed)}</p>
          <p>{RAW_SCRIPT_WARNING}</p>
        </div>
      ) : null}
      {type === 'custom_script' ? (
        <TextArea
          label="Script"
          name="value"
          rows={8}
          maxLength={10000}
          spellCheck={false}
          className="font-mono text-xs"
          defaultValue={pixel?.type === 'custom_script' ? pixel.value : ''}
          hint={PIXEL_VALUE_HINTS[type]}
          error={fieldError(state, 'value')}
          required
        />
      ) : (
        <Input
          label="ID"
          name="value"
          defaultValue={pixel && pixel.type === type ? pixel.value : ''}
          hint={PIXEL_VALUE_HINTS[type]}
          error={fieldError(state, 'value')}
          autoComplete="off"
          required
        />
      )}
      <Input label="Label" name="label" defaultValue={pixel?.label ?? ''} maxLength={80} required error={fieldError(state, 'label')} />
      <Checkbox
        label="Enabled"
        name="enabled"
        defaultChecked={pixel ? pixel.enabled && !blocked : !blocked}
        disabled={blocked}
        hint={blocked ? 'Script pixels are turned off for this workspace.' : 'Loads on every public survey unless a survey excludes it.'}
      />
      <FormStatus state={state} />
      <div>
        <SubmitButton>{pixel ? 'Save pixel' : 'Add pixel'}</SubmitButton>
      </div>
    </form>
  )
}

function EditPixel({ action, pixel, rawAllowed }: { action: Action; pixel: PixelView; rawAllowed: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Edit
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Edit ${pixel.label}`}>
        {open ? <PixelForm action={action} pixel={pixel} rawAllowed={rawAllowed} onDone={() => setOpen(false)} /> : null}
      </Dialog>
    </>
  )
}

export function PixelsTable({
  pixels,
  canEdit,
  rawAllowed,
  save,
  remove,
}: {
  pixels: PixelView[]
  canEdit: boolean
  rawAllowed: boolean
  save: Action
  remove: Action
}) {
  return (
    <Table caption="Tracking pixels">
      <THead>
        <Tr>
          <Th>Label</Th>
          <Th>Type</Th>
          <Th>ID</Th>
          <Th>Status</Th>
          {canEdit ? (
            <Th>
              <span className="sr-only">Actions</span>
            </Th>
          ) : null}
        </Tr>
      </THead>
      <TBody>
        {pixels.map((p) => (
          <Tr key={p.id}>
            <Td className="font-medium">{p.label}</Td>
            <Td>{PIXEL_TYPE_LABELS[p.type]}</Td>
            <Td className="max-w-[16rem] truncate font-mono text-xs">{p.type === 'custom_script' ? 'Script' : p.value}</Td>
            <Td>
              <Badge tone={p.enabled ? 'success' : 'neutral'}>{p.enabled ? 'Enabled' : 'Off'}</Badge>
              {!rawAllowed && isRawScriptType(p.type) ? (
                <span className="ml-2 text-xs text-warning">Blocked on public pages</span>
              ) : null}
            </Td>
            {canEdit ? (
              <Td>
                <div className="flex flex-wrap items-center gap-2">
                  <EditPixel action={save} pixel={p} rawAllowed={rawAllowed} />
                  <InlineAction
                    action={remove}
                    fields={{ pixelId: p.id }}
                    label="Delete"
                    variant="danger"
                    confirm={`Delete ${p.label}? It stops loading on every public survey.`}
                  />
                </div>
              </Td>
            ) : null}
          </Tr>
        ))}
      </TBody>
    </Table>
  )
}
