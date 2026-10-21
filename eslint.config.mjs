import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Origin isolation (R15, doc 02 section 1). Public pages run next to
    // workspace pixels and custom scripts, so they must never touch the
    // cookie-bound server client or the RLS-bypassing admin client.
    files: ['src/app/(public)/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/lib/supabase/server',
                '@/lib/supabase/admin',
                '**/lib/supabase/server',
                '**/lib/supabase/admin',
              ],
              message:
                'Public pages use src/lib/supabase/anon.ts only. Server and admin clients are dashboard or route-handler only (doc 02 section 1).',
            },
          ],
        },
      ],
    },
  },
  {
    // Pixels render only from the public layout; the dashboard CSP would
    // refuse them anyway (doc 02 section 7).
    files: ['src/app/(dashboard)/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/components/public/pixels', '@/components/public/pixels/*', '**/components/public/pixels/**'],
              message: 'Tracking pixels never load on the dashboard host (R15).',
            },
          ],
        },
      ],
    },
  },
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts', 'src/types/database.ts']),
])

export default eslintConfig
