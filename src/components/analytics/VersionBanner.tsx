/**
 * Cross-version banner (doc 04 section 4.4): shown when option sets, matrix
 * rows or columns, scale bounds or the type differ between versions in scope.
 */
export function VersionBanner({ messages, refused }: { messages: string[]; refused?: boolean }) {
  if (messages.length === 0) return null
  return (
    <div role="note" className="rounded-md border border-warning bg-surface-muted px-3 py-2 text-xs text-fg">
      <p className="font-medium text-warning">{refused ? 'Cannot combine versions' : 'Changed between versions'}</p>
      <ul className="mt-1 list-disc pl-4">
        {messages.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
    </div>
  )
}
