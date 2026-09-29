/**
 * Every picture uploaded anywhere on the system, made as small as it can be
 * while it still looks right: «اي صورة تترفع علي السيستم لازم يتم تصغيرها
 * لاقصي درجة وتظهر كويس».
 *
 * The picture is scaled to fit its kind's size and encoded as WebP where the
 * browser can (Safari cannot, and gets JPEG). The quality steps down until the
 * picture fits its kind's budget, then the size does, so an upload never fails
 * because the photo was large. A file that is already smaller than any
 * re-encoding is kept as it is.
 */
export type ImageKind = 'cover' | 'gallery' | 'photo' | 'avatar' | 'receipt' | 'certificate';

export const IMAGE_KINDS: Record<ImageKind, { maxPx: number; maxBytes: number; quality: number }> = {
  // An event's picture, a course's gallery: shown wide.
  cover: { maxPx: 1280, maxBytes: 160_000, quality: 0.8 },
  gallery: { maxPx: 1280, maxBytes: 160_000, quality: 0.78 },
  // An instructor, a member of staff: shown in a card or a circle.
  photo: { maxPx: 640, maxBytes: 45_000, quality: 0.8 },
  avatar: { maxPx: 320, maxBytes: 30_000, quality: 0.8 },
  // A transfer receipt has to stay readable to whoever reviews it.
  receipt: { maxPx: 1600, maxBytes: 350_000, quality: 0.82 },
  // The certificate template is drawn on at its own size.
  certificate: { maxPx: 1200, maxBytes: 300_000, quality: 0.85 },
};

/** Larger than any phone photo; beyond it the browser is asked to decode too much. */
export const IMAGE_SOURCE_MAX_BYTES = 15_000_000;

export function dataUrlByteLength(value: string): number {
  const comma = value.indexOf(',');
  return Math.ceil(((comma >= 0 ? value.length - comma - 1 : value.length) * 3) / 4);
}

const readAsDataUrl = (file: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error('file-read-failed'));
  reader.onload = () => resolve(String(reader.result || ''));
  reader.readAsDataURL(file);
});

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('image-load-failed'));
  image.src = src;
});

let webpEncodes: boolean | null = null;
function canEncodeWebp() {
  if (webpEncodes === null) {
    const probe = document.createElement('canvas');
    probe.width = probe.height = 1;
    webpEncodes = probe.toDataURL('image/webp').startsWith('data:image/webp');
  }
  return webpEncodes;
}

export async function compressImage(file: File, kind: ImageKind): Promise<string> {
  const { maxPx, maxBytes, quality } = IMAGE_KINDS[kind];
  if (file.size > IMAGE_SOURCE_MAX_BYTES) throw new Error(`image-source-too-large:${file.size}`);

  const source = URL.createObjectURL(file);
  try {
    const image = await loadImage(source);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!width || !height) throw new Error('image-load-failed');
    const fits = Math.max(width, height) <= maxPx;
    const type = canEncodeWebp() ? 'image/webp' : 'image/jpeg';
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('image-load-failed');

    let scale = Math.min(1, maxPx / Math.max(width, height));
    let smallest = '';
    for (let resize = 0; resize < 4; resize++, scale *= 0.8) {
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      // JPEG has no transparency: a transparent PNG would turn black.
      if (type === 'image/jpeg') { context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); }
      else context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (let step = 0; step < 4; step++) {
        const output = canvas.toDataURL(type, Math.max(0.4, quality - step * 0.1));
        if (!smallest || output.length < smallest.length) smallest = output;
        if (dataUrlByteLength(output) <= maxBytes) {
          const keepOriginal = fits && resize === 0 && /^image\/(jpeg|webp)$/.test(file.type) && file.size <= dataUrlByteLength(output);
          return keepOriginal ? await readAsDataUrl(file) : output;
        }
      }
    }
    return smallest;
  } finally {
    URL.revokeObjectURL(source);
  }
}
