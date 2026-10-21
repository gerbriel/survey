import { createHash, randomBytes } from 'node:crypto'

/**
 * Share link password hashing (doc 04 section 5.4).
 *
 * shared_report_payload checks `extensions.crypt(p_password, password_hash)`,
 * so the stored hash must be a format pgcrypto crypt() understands. The repo
 * has no bcrypt library and no SQL function that hashes a share password, so
 * this writes MD5-crypt (`$1$`), which crypt() verifies natively.
 *
 * TODO(foundation): replace with a SQL function that stores
 * crypt(p_password, gen_salt('bf')) (see the foundation change request in the
 * Phase 2E report). MD5-crypt is weaker than bcrypt; attempts are rate limited
 * (5 per 15 minutes per token and IP) and the hash is visible only to editors.
 */

const ITOA64 = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

function md5(...parts: Buffer[]): Buffer {
  const h = createHash('md5')
  for (const p of parts) h.update(p)
  return h.digest()
}

function to64(v: number, n: number): string {
  let s = ''
  for (let i = 0; i < n; i++) {
    s += ITOA64[v & 0x3f]
    v >>= 6
  }
  return s
}

export function md5Crypt(password: string, salt: string): string {
  const pw = Buffer.from(password, 'utf8')
  const sl = Buffer.from(salt.slice(0, 8), 'utf8')
  const magic = Buffer.from('$1$')
  let alt = md5(pw, sl, pw)
  const parts: Buffer[] = [pw, magic, sl]
  for (let pl = pw.length; pl > 0; pl -= 16) parts.push(alt.subarray(0, Math.min(pl, 16)))
  for (let i = pw.length; i; i >>= 1) parts.push(i & 1 ? Buffer.from([0]) : pw.subarray(0, 1))
  let fin = md5(...parts)
  for (let i = 0; i < 1000; i++) {
    const p: Buffer[] = []
    p.push(i & 1 ? pw : fin)
    if (i % 3) p.push(sl)
    if (i % 7) p.push(pw)
    p.push(i & 1 ? fin : pw)
    fin = md5(...p)
  }
  alt = fin
  const f = alt
  let out = ''
  out += to64((f[0]! << 16) | (f[6]! << 8) | f[12]!, 4)
  out += to64((f[1]! << 16) | (f[7]! << 8) | f[13]!, 4)
  out += to64((f[2]! << 16) | (f[8]! << 8) | f[14]!, 4)
  out += to64((f[3]! << 16) | (f[9]! << 8) | f[15]!, 4)
  out += to64((f[4]! << 16) | (f[10]! << 8) | f[5]!, 4)
  out += to64(f[11]!, 2)
  return `$1$${salt.slice(0, 8)}$${out}`
}

export function hashSharePassword(password: string): string {
  const bytes = randomBytes(8)
  let salt = ''
  for (const b of bytes) salt += ITOA64[b & 0x3f]
  return md5Crypt(password, salt)
}

export const SHARE_PASSWORD_MIN = 6
export const SHARE_PASSWORD_MAX = 200
