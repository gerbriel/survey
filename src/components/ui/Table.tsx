import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react'
import { cx } from './cx'

/** Semantic table parts with shared styling. Pass a caption for screen readers. */
export function Table({ caption, className, children, ...rest }: HTMLAttributes<HTMLTableElement> & { caption?: string }) {
  return (
    <div className="w-full overflow-x-auto rounded-md border border-border">
      <table className={cx('w-full border-collapse text-left text-sm', className)} {...rest}>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        {children}
      </table>
    </div>
  )
}

export function THead(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead {...props} className={cx('bg-surface-muted text-muted', props.className)} />
}

export function TBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} className={cx('divide-y divide-border', props.className)} />
}

export function Tr(props: HTMLAttributes<HTMLTableRowElement>) {
  return <tr {...props} />
}

export function Th({ scope = 'col', className, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th scope={scope} className={cx('px-3 py-2 font-medium', className)} {...rest} />
}

export function Td({ className, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cx('px-3 py-2', className)} {...rest} />
}
