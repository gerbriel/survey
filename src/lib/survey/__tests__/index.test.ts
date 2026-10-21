import { describe, expect, it } from 'vitest'
import * as api from '../index'

describe('public API', () => {
  it('re-exports the documented names', () => {
    for (const name of [
      'QUESTION_TYPES',
      'CURRENT_SCHEMA_VERSION',
      'STORAGE_COLUMN',
      'migrateDefinition',
      'evaluate',
      'operatorsFor',
      'validateSubmission',
      'splitDefinition',
      'SERVER_ONLY_KEYS',
      'containsServerOnlyKeys',
      'lintDefinition',
      'diffDefinitions',
      'generateQuestionKey',
      'generateOptionId',
      'isQuestionKey',
      'resolvePipes',
      'pipeText',
      'toAnswerRow',
      'orderOptions',
    ]) {
      expect(api).toHaveProperty(name)
    }
    expect(api.QUESTION_TYPES).toHaveLength(23)
    expect(Object.keys(api.STORAGE_COLUMN).sort()).toEqual([...api.QUESTION_TYPES].sort())
  })
})
