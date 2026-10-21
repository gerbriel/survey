'use client'

import { useActionState, useState } from 'react'
import { Tabs } from '@/components/ui/Tabs'
import { FormStatus, SubmitButton, TextArea, fieldError } from '@/components/dashboard/form'
import { IDLE, type ActionState } from '@/lib/admin/forms'
import { MarkdownView } from './MarkdownView'

/** Markdown textarea with a live preview tab (doc 05 section 7.1). */
export function PrivacyNoticeEditor({ action, initial }: { action: (prev: ActionState, form: FormData) => Promise<ActionState>; initial: string }) {
  const [state, run] = useActionState(action, IDLE)
  const [text, setText] = useState(initial)
  const [tab, setTab] = useState('write')
  return (
    <form action={run} className="flex flex-col gap-4">
      {/* The textarea stays mounted (hidden on preview) so the value always submits. */}
      <input type="hidden" name="markdown" value={text} />
      <Tabs
        label="Privacy notice editor"
        value={tab}
        onChange={setTab}
        items={[
          {
            id: 'write',
            label: 'Write',
            content: (
              <TextArea
                label="Notice (Markdown)"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={20}
                maxLength={50000}
                hint="Headings with #, lists with -, **bold**, *italic*, [links](https://example.org)."
                error={fieldError(state, 'markdown')}
              />
            ),
          },
          {
            id: 'preview',
            label: 'Preview',
            content: (
              <div className="rounded-md border border-border p-4">
                <MarkdownView source={text} />
              </div>
            ),
          },
        ]}
      />
      <FormStatus state={state} />
      <div>
        <SubmitButton>Save notice</SubmitButton>
      </div>
    </form>
  )
}
