import { uploadImage } from '../../lib/uploadImage';

// Stored as files: kept as data URLs in one JSON string, the gallery broke once
// it passed 50 KB — after its second picture.
export async function compressInstituteGalleryFiles(files: FileList): Promise<string[]> {
  return Promise.all(Array.from(files).map(file => uploadImage(file, 'gallery')));
}
