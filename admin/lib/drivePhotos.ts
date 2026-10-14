import { useEffect, useState } from 'react';
import { compressImage } from '../../shared/imageCompress';
import { mysqlAdmin } from './mysqlapi';

/**
 * The pictures asked for with a certificate or a carnet: «لما اختار اي شهاده
 * اضافيه او كارنيه لازم يظهر مساحه ارفع صورة … الصورة تروح لجوجل درايف ويبقى على
 * السيستم لينك الصورة فقط». The picture goes to Google Drive (api/lib/googleDrive.js);
 * the system keeps the link, on the client, and the payment carries it there.
 */
export type PhotoKind = 'personal' | 'id';

/** What the picker offers: the types the API accepts (and a phone's HEIC is converted by the browser's picker). */
export const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp';
export type { PhotoLinks } from './paymentPhotos';
export { attachPhotosToNextPayment, takePendingPhotos } from './paymentPhotos';
export type { PhotoNeed } from './photoNeeds';
export { photoNeeds } from './photoNeeds';

/** A picture, compressed here and sent to Drive; resolves its link. */
export async function uploadClientPhoto(file: File, kind: PhotoKind, who: { clientCode?: string; clientName?: string }): Promise<string> {
  const dataUrl = await compressImage(file, 'receipt');
  const { url } = await mysqlAdmin.adminPost<{ url: string }>('/admin/drive/photo', {
    dataUrl, kind, clientCode: who.clientCode, clientName: who.clientName,
  });
  return url;
}

let configured: boolean | null = null;
let asking: Promise<boolean> | null = null;

/** Whether Drive is set up; null while it is being asked. Asked once per page load. */
export function useDriveConfigured(): boolean | null {
  const [value, setValue] = useState<boolean | null>(configured);
  useEffect(() => {
    if (configured !== null) return undefined;
    let alive = true;
    asking ||= mysqlAdmin.adminGet<{ configured: boolean }>('/admin/drive/status')
      .then(answer => { configured = Boolean(answer.configured); return configured; })
      .catch(() => { asking = null; return false; });
    asking.then(answer => { if (alive) setValue(answer); });
    return () => { alive = false; };
  }, []);
  return value;
}

/** The links already on a client's file (so a picture is asked for once). */
export function fetchClientPhotoLinks(subscriberId: string): Promise<{ personal: string | null; id: string | null }> {
  return mysqlAdmin.adminGet<{ personal: string | null; id: string | null }>(`/admin/subscribers/${encodeURIComponent(subscriberId)}/photos`)
    .catch(() => ({ personal: null, id: null }));
}
