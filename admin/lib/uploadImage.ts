import { compressImage } from '../../shared/imageCompress';
import { mysqlAdmin } from './mysqlapi';

type PublicImageKind = 'cover' | 'gallery' | 'photo' | 'certificate';

/**
 * A picture the site shows, compressed here and stored as a file on the
 * server (api/lib/mediaImages.js); what comes back is its address.
 */
export async function uploadImage(file: File, kind: PublicImageKind): Promise<string> {
  const dataUrl = await compressImage(file, kind);
  const { url } = await mysqlAdmin.adminPost<{ url: string }>('/admin/media/images', { dataUrl, kind });
  return url;
}
