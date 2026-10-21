import type { AnswerValue, Question } from '@/lib/survey'
import { choiceIds } from '@/lib/survey'
import { choiceLabels, filesOf, matrixCells, summarizeAnswer } from './answers'

/**
 * One answer rendered by question type: choice labels from the version's
 * public definition, matrix as a table, ranking as an ordered list, files as
 * links through the authenticated redirect route, signatures as an image.
 */
export function AnswerView({
  question,
  value,
  fileHref,
}: {
  question: Question | undefined
  value: AnswerValue | undefined
  /** Builds the authenticated redirect URL for a file id. */
  fileHref: (fileId: string, inline?: boolean) => string
}) {
  if (value === undefined || value === null || value === '') return <p className="text-sm text-muted">No answer</p>
  if (!question) return <p className="text-sm">{summarizeAnswer(undefined, value)}</p>

  switch (question.type) {
    case 'multiple_choice': {
      const labels = choiceLabels(question.settings.options, value)
      return (
        <ul className="list-disc pl-5 text-sm">
          {labels.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      )
    }
    case 'ranking': {
      const opts = question.settings.options
      return (
        <ol className="list-decimal pl-5 text-sm">
          {choiceIds(value).map((cid) => (
            <li key={cid}>{opts.find((o) => o.id === cid)?.label ?? cid}</li>
          ))}
        </ol>
      )
    }
    case 'matrix': {
      const cells = matrixCells(question, value)
      return (
        <table className="w-full max-w-lg border-collapse text-left text-sm">
          <caption className="sr-only">Matrix answer</caption>
          <thead>
            <tr className="text-muted">
              <th scope="col" className="border-b border-border py-1 pr-4 font-medium">
                Row
              </th>
              <th scope="col" className="border-b border-border py-1 font-medium">
                Answer
              </th>
            </tr>
          </thead>
          <tbody>
            {cells.map((c) => (
              <tr key={c.row}>
                <th scope="row" className="py-1 pr-4 font-normal">
                  {c.row}
                </th>
                <td className="py-1">{c.column}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )
    }
    case 'file_upload': {
      const files = filesOf(value)
      return (
        <ul className="text-sm">
          {files.map((f) => (
            <li key={f.file_id}>
              <a href={fileHref(f.file_id)} className="text-accent underline">
                {f.name}
              </a>
              {f.size ? <span className="ml-2 text-muted">{Math.ceil(f.size / 1024)} KB</span> : null}
            </li>
          ))}
        </ul>
      )
    }
    case 'signature': {
      const f = filesOf(value)[0]
      if (!f) return <p className="text-sm text-muted">No signature</p>
      return (
        // eslint-disable-next-line @next/next/no-img-element -- signed Storage redirect, not an optimizable asset
        <img
          src={fileHref(f.file_id, true)}
          alt="Signature"
          className="max-h-40 rounded border border-border bg-white"
        />
      )
    }
    case 'long_text':
      return <p className="whitespace-pre-wrap text-sm">{String(value)}</p>
    default:
      return <p className="text-sm">{summarizeAnswer(question, value)}</p>
  }
}
