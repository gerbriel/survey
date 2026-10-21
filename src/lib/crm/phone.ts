import { isSupportedCountry, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js'

/**
 * Phone normalization for contacts (doc 04 section 2.2): libphonenumber-js
 * with the workspace default country, stored as E.164. Returns null when the
 * value cannot be parsed into a valid number; callers keep the raw text out
 * of contacts.phone in that case.
 */
export function normalizePhone(raw: string | null | undefined, defaultCountry = 'US'): string | null {
  if (!raw) return null
  const text = raw.trim()
  if (!text) return null
  const country = isSupportedCountry(defaultCountry) ? (defaultCountry as CountryCode) : undefined
  const intl = text.startsWith('00') ? `+${text.slice(2)}` : text
  const parsed = parsePhoneNumberFromString(intl, country)
  if (!parsed || !parsed.isValid()) return null
  return parsed.number
}
