import { controlClass } from '@/components/ui/Field'

/**
 * Compare controls: a plain GET form. Pick two to five surveys, a shared
 * date range and version, and optional per-survey overrides (range_i,
 * from_i, to_i, version_i, by position in the selection).
 */

export type PickerSurvey = { id: string; title: string }
export type PickerSelected = { id: string; title: string; versions: { id: string; version_no: number }[] }

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-muted">
        {label}
      </label>
      {children}
    </div>
  )
}

function RangeSelect({ id, name, value, inherit }: { id: string; name: string; value: string; inherit?: boolean }) {
  return (
    <select id={id} name={name} defaultValue={value} className={controlClass}>
      {inherit ? <option value="">Same as shared</option> : null}
      <option value="all">All time</option>
      <option value="7d">Last 7 days</option>
      <option value="30d">Last 30 days</option>
      <option value="90d">Last 90 days</option>
      <option value="custom">Custom</option>
    </select>
  )
}

export function ComparePicker({
  action,
  surveys,
  selected,
  params,
}: {
  action: string
  surveys: PickerSurvey[]
  selected: PickerSelected[]
  params: URLSearchParams
}) {
  const chosen = new Set(selected.map((s) => s.id))
  const g = (k: string) => params.get(k) ?? ''
  return (
    <form method="get" action={action} aria-label="Pick surveys to compare" className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 print:hidden">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-semibold text-fg">Surveys (two to five, the first is the baseline)</legend>
        <div className="grid max-h-56 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
          {selected.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm text-fg">
              <input type="checkbox" name="surveys" value={s.id} defaultChecked />
              <span className="truncate">{s.title}</span>
            </label>
          ))}
          {surveys
            .filter((s) => !chosen.has(s.id))
            .map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm text-fg">
                <input type="checkbox" name="surveys" value={s.id} />
                <span className="truncate">{s.title}</span>
              </label>
            ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field id="cp-range" label="Date range, all surveys">
          <RangeSelect id="cp-range" name="range" value={g('range') || 'all'} />
        </Field>
        <Field id="cp-from" label="From (custom)">
          <input id="cp-from" type="date" name="from" defaultValue={g('from')} className={controlClass} />
        </Field>
        <Field id="cp-to" label="To (custom)">
          <input id="cp-to" type="date" name="to" defaultValue={g('to')} className={controlClass} />
        </Field>
        <Field id="cp-version" label="Version, all surveys">
          <select id="cp-version" name="version" defaultValue={g('version') || 'latest'} className={controlClass}>
            <option value="latest">Latest published</option>
            <option value="all">All versions</option>
          </select>
        </Field>
        <Field id="cp-status" label="Status">
          <select id="cp-status" name="status" defaultValue={g('status') || 'complete'} className={controlClass}>
            <option value="complete">Complete only</option>
            <option value="all">Include partials</option>
          </select>
        </Field>
      </div>
      {selected.length ? (
        <details>
          <summary className="cursor-pointer text-sm text-accent">Per survey dates and versions</summary>
          <div className="mt-3 flex flex-col gap-3">
            {selected.map((s, i) => (
              <fieldset key={s.id} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <legend className="mb-1 text-sm font-medium text-fg">{s.title}</legend>
                <Field id={`cp-range-${i}`} label="Date range">
                  <RangeSelect id={`cp-range-${i}`} name={`range_${i}`} value={g(`range_${i}`)} inherit />
                </Field>
                <Field id={`cp-from-${i}`} label="From (custom)">
                  <input id={`cp-from-${i}`} type="date" name={`from_${i}`} defaultValue={g(`from_${i}`)} className={controlClass} />
                </Field>
                <Field id={`cp-to-${i}`} label="To (custom)">
                  <input id={`cp-to-${i}`} type="date" name={`to_${i}`} defaultValue={g(`to_${i}`)} className={controlClass} />
                </Field>
                <Field id={`cp-version-${i}`} label="Version">
                  <select id={`cp-version-${i}`} name={`version_${i}`} defaultValue={g(`version_${i}`)} className={controlClass}>
                    <option value="">Same as shared</option>
                    <option value="latest">Latest published</option>
                    <option value="all">All versions</option>
                    {s.versions.map((v) => (
                      <option key={v.id} value={v.id}>
                        v{v.version_no}
                      </option>
                    ))}
                  </select>
                </Field>
              </fieldset>
            ))}
            <p className="text-xs text-muted">Per survey settings follow the order above. Changing which surveys are picked can shift them.</p>
          </div>
        </details>
      ) : null}
      <div>
        <button type="submit" className="h-8 rounded-md bg-accent px-3 text-sm font-medium text-accent-fg hover:opacity-90">
          Compare
        </button>
      </div>
    </form>
  )
}
