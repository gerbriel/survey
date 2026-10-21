'use client'

import {
  MAX_CONDITION_DEPTH,
  operatorsForField,
  type Condition,
  type Leaf,
  type LeafField,
  type Operand,
  type Operator,
  type Question,
  type QuestionType,
  type SurveyDefinition,
} from '@/lib/survey'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Check } from './fields'
import { plain } from './model'

export const OPERATOR_LABELS: Record<Operator, string> = {
  eq: 'is',
  neq: 'is not',
  gt: 'is greater than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
  between: 'is between',
  contains: 'contains',
  not_contains: 'does not contain',
  starts_with: 'starts with',
  ends_with: 'ends with',
  matches: 'matches pattern',
  is_answered: 'is answered',
  is_not_answered: 'is not answered',
  includes_any: 'includes any of',
  includes_all: 'includes all of',
  includes_none: 'includes none of',
  before: 'is before',
  after: 'is after',
  on: 'is on',
}

export interface FieldChoice {
  value: string
  label: string
  field: LeafField
  /** Question type, 'matrix_row' for a matrix row, 'hidden' for a URL param. */
  type: QuestionType | 'matrix_row'
  options?: { id: string; label: string }[]
}

export function fieldKey(f: LeafField): string {
  if (f.kind === 'hidden') return `hidden:${f.param}`
  if (f.kind === 'calc') return `calc:${f.id}`
  return f.row_id ? `q:${f.id}:${f.row_id}` : `q:${f.id}`
}

/** Fields a condition may read: the given questions (earlier ones), every hidden field, calculations. */
export function fieldChoices(def: SurveyDefinition, questions: Question[]): FieldChoice[] {
  const out: FieldChoice[] = []
  for (const q of questions) {
    const name = plain(q.label.text, 40) || q.question_key
    if (q.type === 'statement' || q.type === 'image' || q.type === 'hidden') continue
    if (q.type === 'calculated') {
      out.push({ value: `calc:${q.id}`, label: `Calculation: ${name}`, field: { kind: 'calc', id: q.id }, type: 'calculated' })
      continue
    }
    if (q.type === 'matrix') {
      out.push({ value: `q:${q.id}`, label: name, field: { kind: 'question', id: q.id }, type: 'matrix' })
      for (const r of q.settings.rows) {
        out.push({
          value: `q:${q.id}:${r.id}`,
          label: `${name} / ${r.label}`,
          field: { kind: 'question', id: q.id, row_id: r.id },
          type: 'matrix_row',
          options: q.settings.columns,
        })
      }
      continue
    }
    const options = 'options' in q.settings ? q.settings.options : undefined
    out.push({ value: `q:${q.id}`, label: name, field: { kind: 'question', id: q.id }, type: q.type, ...(options ? { options } : {}) })
  }
  for (const q of Object.values(def.questions)) {
    if (q.type === 'hidden' && q.settings.param) {
      out.push({ value: `hidden:${q.settings.param}`, label: `Hidden field: ${q.settings.param}`, field: { kind: 'hidden', param: q.settings.param }, type: 'hidden' })
    }
  }
  return out
}

function opsFor(c: FieldChoice | undefined): readonly Operator[] {
  if (!c) return []
  if (c.type === 'matrix_row') return operatorsForField('matrix', true)
  return operatorsForField(c.type, false)
}

const NUMERIC = new Set<string>(['number', 'rating', 'nps', 'calculated'])

function defaultOperand(c: FieldChoice | undefined, op: Operator): Operand | undefined {
  if (!c || op === 'is_answered' || op === 'is_not_answered') return undefined
  if (op === 'between') return ['', '']
  if (op.startsWith('includes')) return []
  if (c.options) return c.options[0]?.id ?? ''
  if (c.type === 'yes_no' || c.type === 'consent') return 1
  if (NUMERIC.has(c.type)) return 0
  return ''
}

type Group = { all: Condition[] } | { any: Condition[] }

function children(g: Group): Condition[] {
  return 'all' in g ? g.all : g.any
}
function withChildren(g: Group, list: Condition[]): Group {
  return 'all' in g ? { all: list } : { any: list }
}

/** Root is always a group so the All/Any toggle has somewhere to live. */
export function asGroup(c: Condition | undefined): Group {
  if (!c) return { all: [] }
  if ('all' in c || 'any' in c) return c
  return { all: [c] }
}

function LeafRow({ leaf, choices, onChange, onRemove, disabled }: { leaf: Leaf; choices: FieldChoice[]; onChange: (l: Leaf) => void; onRemove: () => void; disabled?: boolean }) {
  const choice = choices.find((c) => c.value === fieldKey(leaf.field))
  const ops = opsFor(choice)
  const v = leaf.value
  const multi = leaf.op.startsWith('includes')
  let valueInput = null
  if (leaf.op === 'is_answered' || leaf.op === 'is_not_answered') valueInput = null
  else if (leaf.op === 'between') {
    const [lo, hi] = Array.isArray(v) ? v : ['', '']
    valueInput = (
      <div className="flex gap-2">
        <Input label="From" value={lo ?? ''} disabled={disabled} onChange={(e) => onChange({ ...leaf, value: [e.target.value, hi ?? ''] })} />
        <Input label="To" value={hi ?? ''} disabled={disabled} onChange={(e) => onChange({ ...leaf, value: [lo ?? '', e.target.value] })} />
      </div>
    )
  } else if (choice?.options && multi) {
    const sel = new Set(Array.isArray(v) ? v : [])
    valueInput = (
      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-medium">Options</legend>
        {choice.options.map((o) => (
          <Check
            key={o.id}
            label={o.label || o.id}
            checked={sel.has(o.id)}
            disabled={disabled}
            onChange={(on) => onChange({ ...leaf, value: on ? [...sel, o.id] : [...sel].filter((x) => x !== o.id) })}
          />
        ))}
      </fieldset>
    )
  } else if (choice?.options) {
    valueInput = (
      <Select
        label="Value"
        options={choice.options.map((o) => ({ value: o.id, label: o.label || o.id }))}
        value={typeof v === 'string' ? v : ''}
        disabled={disabled}
        onChange={(e) => onChange({ ...leaf, value: e.target.value })}
      />
    )
  } else if (choice && (choice.type === 'yes_no' || choice.type === 'consent')) {
    valueInput = (
      <Select
        label="Value"
        options={[
          { value: '1', label: choice.type === 'consent' ? 'Agreed' : 'Yes' },
          { value: '0', label: choice.type === 'consent' ? 'Not agreed' : 'No' },
        ]}
        value={String(v ?? 1)}
        disabled={disabled}
        onChange={(e) => onChange({ ...leaf, value: Number(e.target.value) })}
      />
    )
  } else if (choice && NUMERIC.has(choice.type)) {
    valueInput = (
      <Input label="Value" type="number" value={typeof v === 'number' ? v : ''} disabled={disabled} onChange={(e) => onChange({ ...leaf, value: e.target.value === '' ? 0 : Number(e.target.value) })} />
    )
  } else {
    valueInput = (
      <Input
        label="Value"
        type={choice?.type === 'date' ? 'date' : choice?.type === 'time' ? 'time' : 'text'}
        value={typeof v === 'string' ? v : ''}
        disabled={disabled}
        onChange={(e) => onChange({ ...leaf, value: e.target.value })}
      />
    )
  }
  return (
    <li className="flex flex-col gap-2 rounded-md border border-border p-2">
      <Select
        label="Field"
        options={choices.map((c) => ({ value: c.value, label: c.label }))}
        value={fieldKey(leaf.field)}
        disabled={disabled}
        onChange={(e) => {
          const c = choices.find((x) => x.value === e.target.value)
          if (!c) return
          const op = opsFor(c)[0] ?? 'is_answered'
          onChange({ field: c.field, op, ...(defaultOperand(c, op) !== undefined ? { value: defaultOperand(c, op) } : {}) })
        }}
      />
      <Select
        label="Operator"
        options={ops.map((o) => ({ value: o, label: OPERATOR_LABELS[o] }))}
        value={leaf.op}
        disabled={disabled}
        onChange={(e) => {
          const op = e.target.value as Operator
          const value = defaultOperand(choice, op)
          onChange({ field: leaf.field, op, ...(value !== undefined ? { value } : {}) })
        }}
      />
      {valueInput}
      {!disabled ? (
        <Button size="sm" variant="ghost" onClick={onRemove} className="self-start">
          Remove condition
        </Button>
      ) : null}
    </li>
  )
}

function GroupEditor({
  group,
  choices,
  depth,
  onChange,
  onRemove,
  disabled,
}: {
  group: Group
  choices: FieldChoice[]
  depth: number
  onChange: (g: Group) => void
  onRemove?: () => void
  disabled?: boolean
}) {
  const list = children(group)
  const set = (i: number, c: Condition) => onChange(withChildren(group, list.map((x, j) => (j === i ? c : x))))
  const remove = (i: number) => onChange(withChildren(group, list.filter((_, j) => j !== i)))
  const first = choices[0]
  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed border-border p-2">
      <Select
        label="Match"
        options={[
          { value: 'all', label: 'All of these' },
          { value: 'any', label: 'Any of these' },
        ]}
        value={'all' in group ? 'all' : 'any'}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === 'all' ? { all: list } : { any: list })}
      />
      <ul className="flex flex-col gap-2">
        {list.map((c, i) =>
          'all' in c || 'any' in c ? (
            <li key={i}>
              <GroupEditor group={c} choices={choices} depth={depth + 1} onChange={(g) => set(i, g)} onRemove={() => remove(i)} disabled={disabled} />
            </li>
          ) : 'not' in c ? (
            <li key={i} className="text-sm text-muted">
              A negated group (edit it in JSON import). <Button size="sm" variant="ghost" onClick={() => remove(i)}>Remove</Button>
            </li>
          ) : (
            <LeafRow key={i} leaf={c} choices={choices} onChange={(l) => set(i, l)} onRemove={() => remove(i)} disabled={disabled} />
          ),
        )}
      </ul>
      {!disabled ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={!first}
            onClick={() => {
              if (!first) return
              const op = opsFor(first)[0] ?? 'is_answered'
              const value = defaultOperand(first, op)
              onChange(withChildren(group, [...list, { field: first.field, op, ...(value !== undefined ? { value } : {}) }]))
            }}
          >
            Add condition
          </Button>
          {depth < MAX_CONDITION_DEPTH ? (
            <Button size="sm" variant="secondary" disabled={!first} onClick={() => onChange(withChildren(group, [...list, { any: [] }]))}>
              Add group
            </Button>
          ) : null}
          {onRemove ? (
            <Button size="sm" variant="ghost" onClick={onRemove}>
              Remove group
            </Button>
          ) : null}
        </div>
      ) : null}
      {!first ? <p className="text-xs text-muted">No earlier questions to build a condition from.</p> : null}
    </div>
  )
}

/** "Show when" builder: rows of field, operator, value, with All/Any and nested groups up to depth 3. */
export function ConditionEditor({
  value,
  choices,
  onChange,
  disabled,
}: {
  value: Condition | undefined
  choices: FieldChoice[]
  onChange: (c: Condition) => void
  disabled?: boolean
}) {
  return <GroupEditor group={asGroup(value)} choices={choices} depth={1} onChange={onChange} disabled={disabled} />
}

export function isEmptyCondition(c: Condition | undefined): boolean {
  if (!c) return true
  if ('all' in c) return c.all.length === 0
  if ('any' in c) return c.any.length === 0
  return false
}
