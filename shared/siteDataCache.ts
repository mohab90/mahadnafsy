type CachePayload = Record<string, unknown>;

function stripLargeInlineAssets(payload: CachePayload): CachePayload {
  const stripped = structuredClone(payload);
  if (Array.isArray(stripped.courses)) {
    stripped.courses = stripped.courses.map(course => {
      if (!course || typeof course !== 'object') return course;
      const item = course as CachePayload;
      return {
        ...item,
        galleryImages: Array.isArray(item.galleryImages)
          ? item.galleryImages.filter(image => typeof image !== 'string' || !image.startsWith('data:'))
          : [],
        certificateTemplateUrl: typeof item.certificateTemplateUrl === 'string'
          && item.certificateTemplateUrl.startsWith('data:')
          ? ''
          : item.certificateTemplateUrl,
      };
    });
  }
  if (Array.isArray(stripped.therapists)) {
    stripped.therapists = stripped.therapists.map(therapist => {
      if (!therapist || typeof therapist !== 'object') return therapist;
      const item = therapist as CachePayload;
      return {
        ...item,
        image: typeof item.image === 'string' && item.image.startsWith('data:') ? '' : item.image,
      };
    });
  }
  return stripped;
}

export function readVersionedCache<T extends object>(storageKey: string, version: number): Partial<T> | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || (parsed as CachePayload)._dataVersion !== version) {
      localStorage.removeItem(storageKey);
      return null;
    }
    return parsed as Partial<T>;
  } catch {
    localStorage.removeItem(storageKey);
    return null;
  }
}

export function writeVersionedCache(storageKey: string, version: number, payload: CachePayload): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ ...payload, _dataVersion: version }));
  } catch (error) {
    if (!(error instanceof DOMException)
      || (error.name !== 'QuotaExceededError' && error.name !== 'NS_ERROR_DOM_QUOTA_REACHED')) return;
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ ...stripLargeInlineAssets(payload), _dataVersion: version }),
      );
    } catch {
      // Cache failure must never replace or block the server-owned source of truth.
    }
  }
}
