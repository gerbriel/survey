import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

// Everything under src/app: no service-role client and no raw Supabase
// libraries. Pages, layouts, actions and route handlers reach the database
// through src/lib/db (AGENTS.md "Data access"); the admin client is created
// only inside server-only library code under src/lib.
const appPatterns = [
  {
    group: ['@/lib/supabase/admin', '**/lib/supabase/admin'],
    message:
      'The service-role client is never imported under src/app. Call a server-only module in src/lib that uses it (AGENTS.md "Data access").',
  },
  {
    group: ['@supabase/supabase-js', '@supabase/ssr'],
    allowTypeImports: true,
    message: 'Use the clients in src/lib/supabase and the wrappers in src/lib/db, never the Supabase libraries directly.',
  },
]

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ['src/app/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: appPatterns }] },
  },
  {
    // Origin isolation (R15, doc 02 section 1). Public pages run next to
    // workspace pixels and custom scripts, so they must never touch the
    // cookie-bound clients, the proxy session helper, the auth guards, or the
    // RLS-bypassing admin client. Repeats appPatterns: in flat config the
    // last matching block wins for a rule.
    files: ['src/app/(public)/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...appPatterns,
            {
              group: [
                '@/lib/supabase/server',
                '@/lib/supabase/browser',
                '@/lib/supabase/proxy',
                '**/lib/supabase/server',
                '**/lib/supabase/browser',
                '**/lib/supabase/proxy',
                '@/lib/auth',
                '@/lib/auth/*',
                '**/lib/auth',
                '**/lib/auth/*',
              ],
              message:
                'Public pages use src/lib/supabase/anon.ts only. Server, browser, proxy and auth helpers are dashboard only (doc 02 section 1).',
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
            ...appPatterns,
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
