import { Button } from '@/components/ui/Button'

/** A form so it works without JavaScript. `action` is the signOut server action from /login. */
export function SignOutButton({ action, label = 'Sign out' }: { action: () => Promise<void>; label?: string }) {
  return (
    <form action={action}>
      <Button type="submit" variant="ghost" size="sm">
        {label}
      </Button>
    </form>
  )
}
