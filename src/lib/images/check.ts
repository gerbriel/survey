import { sniffImage, type SniffedImage } from '@/lib/admin/image'

/**
 * Library image checks (doc 03 section 8.1): PNG, JPEG or WebP sniffed from
 * the bytes (never the declared type or the extension), max 2 MB. SVG is
 * refused because it can carry script. Pure, unit tested.
 * Decision: no minimum size (a small logo is fine); at most 8000 pixels per
 * side, so a tiny file that decodes to a huge bitmap is refused.
 */
export const IMAGE_UPLOAD_MAX_BYTES = 2_097_152
export const IMAGE_UPLOAD_MAX_SIDE = 8000

export type LibraryImageCheck = { ok: true; image: SniffedImage } | { ok: false; message: string }

export function checkLibraryImage(bytes: Uint8Array): LibraryImageCheck {
  if (bytes.length === 0) return { ok: false, message: 'Choose an image file.' }
  if (bytes.length > IMAGE_UPLOAD_MAX_BYTES) return { ok: false, message: 'Images must be 2 MB or smaller.' }
  const image = sniffImage(bytes)
  if (!image) return { ok: false, message: 'Use a PNG, JPEG or WebP image. SVG is not accepted.' }
  if (image.width < 1 || image.height < 1) return { ok: false, message: 'The image size could not be read. Try another file.' }
  if (image.width > IMAGE_UPLOAD_MAX_SIDE || image.height > IMAGE_UPLOAD_MAX_SIDE) {
    return { ok: false, message: `Images must be at most ${IMAGE_UPLOAD_MAX_SIDE} pixels on each side.` }
  }
  return { ok: true, image }
}
