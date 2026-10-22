import { describe, expect, it } from 'vitest'
import { filterPeople } from '../PersonPicker'
import { listHref } from '@/components/builder/survey-list-href'

describe('filterPeople', () => {
  const people = [
    { id: '1', name: 'Ann Lee', detail: 'Editor' },
    { id: '2', name: 'Bo Diaz', detail: null },
    { id: '3', name: 'Cy Park' },
  ]
  it('matches name and detail, case-insensitive', () => {
    expect(filterPeople(people, '').map((p) => p.id)).toEqual(['1', '2', '3'])
    expect(filterPeople(people, '  ann ').map((p) => p.id)).toEqual(['1'])
    expect(filterPeople(people, 'EDITOR').map((p) => p.id)).toEqual(['1'])
    expect(filterPeople(people, 'zzz')).toEqual([])
  })
})

describe('survey list href', () => {
  it('keeps the archived view and the assignment filter together', () => {
    expect(listHref('/w/a/surveys', false, 'all')).toBe('/w/a/surveys')
    expect(listHref('/w/a/surveys', true, 'all')).toBe('/w/a/surveys?archived=1')
    expect(listHref('/w/a/surveys', true, 'owned')).toBe('/w/a/surveys?archived=1&assigned=owned')
    expect(listHref('/w/a/surveys', false, 'unassigned')).toBe('/w/a/surveys?assigned=unassigned')
  })
})
