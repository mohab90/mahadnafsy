export const IMAGE_DATA_URL_MAX_BYTES = 320_000;
export const IMAGE_SOURCE_MAX_BYTES = 5_000_000;

export function dataUrlByteLength(value: string): number {
  const comma = value.indexOf(',');
  const payload = comma >= 0 ? value.slice(comma + 1) : value;
  return Math.ceil((payload.length * 3) / 4);
}

export async function compressImageFile(
  file: File,
  options: { maxPx?: number; quality?: number; maxBytes?: number } = {},
): Promise<string> {
  const maxPx = options.maxPx ?? 900;
  const maxBytes = options.maxBytes ?? IMAGE_DATA_URL_MAX_BYTES;
  const sourceLimit = Math.max(IMAGE_SOURCE_MAX_BYTES, maxBytes * 4);
  if (file.size > sourceLimit) {
    throw new Error(`image-source-too-large:${file.size}`);
  }

  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('file-read-failed'));
    reader.onload = event => resolve(String(event.target?.result || ''));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = document.createElement('img');
    element.onerror = () => reject(new Error('image-load-failed'));
    element.onload = () => resolve(element);
    element.src = source;
  });

  let width = img.naturalWidth || img.width;
  let height = img.naturalHeight || img.height;
  if (!width || !height) return source;
  if (width > maxPx || height > maxPx) {
    if (width > height) {
      height = Math.round((height / width) * maxPx);
      width = maxPx;
    } else {
      width = Math.round((width / height) * maxPx);
      height = maxPx;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return source;
  ctx.drawImage(img, 0, 0, width, height);

  const qualities = [options.quality ?? 0.78, 0.68, 0.58, 0.48, 0.38];
  for (const quality of qualities) {
    const output = canvas.toDataURL('image/jpeg', quality);
    if (dataUrlByteLength(output) <= maxBytes) return output;
  }
  throw new Error(`image-budget-exceeded:${dataUrlByteLength(canvas.toDataURL('image/jpeg', 0.38))}`);
}
