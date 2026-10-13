// The links of the pictures a certificate or a carnet asked for ride on the next
// payment the dialog sends — whichever caller builds it — the way the owner's
// «who brought it» does (lib/paymentAttribution.ts). The picture itself is in
// Google Drive (lib/drivePhotos.ts); this holds only its link until then.

export type PhotoLinks = { personal?: string; id?: string };

let pending: PhotoLinks | null = null;

/** Set by the payment dialog just before it submits; null clears it. */
export function attachPhotosToNextPayment(photos: PhotoLinks | null) {
  pending = photos && (photos.personal || photos.id) ? { ...photos } : null;
}

/** Read once by the API call that sends the payment. */
export function takePendingPhotos(): PhotoLinks | null {
  const value = pending;
  pending = null;
  return value;
}
