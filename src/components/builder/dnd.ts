/** Native HTML5 drag and drop payload types shared by the palette and canvas. */
export const DND_TYPE = 'application/x-survey-type'
export const DND_QUESTION = 'application/x-survey-question'
export const DND_PAGE = 'application/x-survey-page'

export function hasType(e: { dataTransfer: DataTransfer | null }, type: string): boolean {
  return !!e.dataTransfer && Array.from(e.dataTransfer.types).includes(type)
}
