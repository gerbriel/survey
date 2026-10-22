import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RESULTS_FILTERS,
  metadataColumn,
  parseResultsFilters,
  parseResultsFiltersObject,
  resultsFiltersToQuery,
  toResultsQuery,
  versionArgFor,
} from '../results-filters'
import { selectSurveys } from '../results'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const NOW = new Date('2026-10-21T12:00:00Z')
const VERSIONS = [
  { id: 'aaaaaaaa-0000-4000-8000-000000000001', version_no: 1 },
  { id: 'aaaaaaaa-0000-4000-8000-000000000002', version_no: 2 },
]

describe('results filters', () => {
  it('defaults: every survey, all statuses, all versions', () => {
    expect(parseResultsFilters({})).toEqual(DEFAULT_RESULTS_FILTERS)
    expect(toResultsQuery(DEFAULT_RESULTS_FILTERS, VERSIONS, NOW)).toEqual({ rpc: { version: 'all', status: 'all', identity: 'all' }, where: [], text: null })
  })

  it('parses and round trips every field', () => {
    const qs = `surveys=${A},${B},nope&range=custom&from=2026-01-01&to=2026-01-31&status=partial&version=v2&identity=identified&lead=new,bogus&tags=vip&owner=${A}&mk=hidden.src&mv=mail&q=slow%20checkout`
    const f = parseResultsFilters(new URLSearchParams(qs))
    expect(f).toMatchObject({ surveys: [A, B], range: 'custom', status: 'partial', version: 2, lead: ['new'], meta: { key: 'hidden.src', value: 'mail' }, text: 'slow checkout' })
    expect(parseResultsFilters(new URLSearchParams(resultsFiltersToQuery(f)))).toEqual(f)
    expect(parseResultsFiltersObject({ surveys: [A], status: 'complete' })).toMatchObject({ surveys: [A], status: 'complete' })
    expect(parseResultsFiltersObject('junk')).toEqual(DEFAULT_RESULTS_FILTERS)
  })

  it('translates to the filtered_responses jsonb plus row conditions', () => {
    const f = parseResultsFilters(new URLSearchParams(`range=custom&from=2026-01-01&to=2026-01-31&status=partial&version=2&identity=token&lead=lost&tags=a,b&owner=${A}&mk=utm_source&mv=news&q=hello`))
    expect(toResultsQuery(f, VERSIONS, NOW)).toEqual({
      rpc: {
        version: VERSIONS[1]!.id,
        status: 'all',
        identity: 'token',
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-02-01T00:00:00.000Z',
        contact: { lead_status: ['lost'], tags: ['a', 'b'], owner_ids: [A] },
      },
      where: [
        { column: 'status', value: 'partial' },
        { column: 'metadata->>utm_source', value: 'news' },
      ],
      text: 'hello',
    })
    expect(toResultsQuery({ ...f, status: 'complete' }, VERSIONS, NOW)!.rpc.status).toBe('complete')
  })

  it('relative ranges, version per survey, and skipping a survey without that version', () => {
    expect(toResultsQuery({ ...DEFAULT_RESULTS_FILTERS, range: '7d' }, VERSIONS, NOW)!.rpc.from).toBe('2026-10-14T12:00:00.000Z')
    expect(versionArgFor({ ...DEFAULT_RESULTS_FILTERS, version: 'latest' }, VERSIONS)).toBe('latest')
    expect(toResultsQuery({ ...DEFAULT_RESULTS_FILTERS, version: 3 }, VERSIONS, NOW)).toBeNull()
  })

  it('metadata keys: hidden params nest under hidden, unsafe keys are refused', () => {
    expect(metadataColumn('hidden.src')).toBe('metadata->hidden->>src')
    expect(metadataColumn('utm_campaign')).toBe('metadata->>utm_campaign')
    expect(metadataColumn('hidden.a,b')).toBeNull()
    expect(parseResultsFilters({ mk: 'device', mv: 'x' }).meta).toBeNull()
  })

  it('bounds the free text search', () => {
    expect(parseResultsFilters({ q: 'a' }).text).toBeNull()
    expect(parseResultsFilters({ q: 'x'.repeat(300) }).text).toHaveLength(100)
  })
})

describe('survey selection', () => {
  const s = (id: string, state: string, published: boolean) => ({
    id,
    workspace_id: A,
    title: id,
    slug: 'abcdefghij',
    state,
    latest_published_version_id: published ? A : null,
    closes_at: null,
    complete_count: 0,
    archived_at: null,
    created_at: '2026-01-01T00:00:00Z',
  })
  it('default set excludes drafts and unpublished surveys; explicit ids stay in the workspace', () => {
    const all = [s('open', 'open', true), s('closed', 'closed', true), s('draft', 'draft', true), s('new', 'open', false)] as Parameters<typeof selectSurveys>[0]
    expect(selectSurveys(all, []).map((x) => x.id)).toEqual(['open', 'closed'])
    expect(selectSurveys(all, ['draft', 'elsewhere']).map((x) => x.id)).toEqual(['draft'])
  })
})
