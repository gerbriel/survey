/**
 * Regex safety for author-supplied patterns (doc 03 section 4: "no nested
 * quantifiers", length limit 200). A conservative static check, not a full
 * RE2 parser.
 */

export const MAX_REGEX_LENGTH = 200

/**
 * True when the pattern compiles, is at most 200 chars, has no backreferences
 * or lookarounds, and has no quantified group that itself contains a quantifier
 * (the `(a+)+` family that causes catastrophic backtracking).
 */
export function isSafeRegex(src: string): boolean {
  if (typeof src !== 'string' || src.length === 0 || src.length > MAX_REGEX_LENGTH) return false
  try {
    new RegExp(src)
  } catch {
    return false
  }
  if (/\\[1-9]|\\k<|\(\?<?[=!]/.test(src)) return false
  // Walk groups; track whether each group's body contains a quantifier.
  const stack: boolean[] = []
  let inClass = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (ch === '\\') {
      i++
      continue
    }
    if (inClass) {
      if (ch === ']') inClass = false
      continue
    }
    if (ch === '[') {
      inClass = true
      continue
    }
    if (ch === '(') {
      stack.push(false)
      continue
    }
    const isQuant = ch === '*' || ch === '+' || ch === '?' || ch === '{'
    if (ch === ')') {
      const hadQuant = stack.pop() ?? false
      const next = src[i + 1]
      const quantified = next === '*' || next === '+' || next === '{'
      if (hadQuant && quantified) return false
      if (hadQuant && stack.length > 0) stack[stack.length - 1] = true
      continue
    }
    if (isQuant && stack.length > 0) {
      // `?` right after `(` is a group modifier, not a quantifier.
      if (!(ch === '?' && src[i - 1] === '(')) stack[stack.length - 1] = true
    }
  }
  return true
}
