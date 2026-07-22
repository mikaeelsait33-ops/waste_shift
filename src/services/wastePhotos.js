import { getAutomaticManagerApiHeaders, getManagerApiErrorMessage } from '../utils/apiHeaders';

const LOCAL_WASTE_PHOTO_PATTERN = /^data:image\/(?:jpeg|png|webp);base64,/i;

export const wastePhotoNeedsUpload = (entry) => (
  Boolean(entry?.id)
  && LOCAL_WASTE_PHOTO_PATTERN.test(String(entry?.photoUrl || ''))
);

export const uploadWastePhotoForEntry = async (entry) => {
  if (!wastePhotoNeedsUpload(entry)) {
    return entry;
  }

  const response = await fetch('/api/waste-photo', {
    method: 'POST',
    headers: await getAutomaticManagerApiHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({
      entryId: entry.id,
      photoName: entry.photoName || '',
      dataUrl: entry.photoUrl,
    }),
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload?.ok === false || !payload.photoUrl) {
    throw new Error(getManagerApiErrorMessage(payload, 'Could not upload this waste photo for sharing.'));
  }

  return {
    ...entry,
    photoUrl: payload.photoUrl,
    photoStoragePath: payload.photoPathname || '',
    photoName: payload.photoName || entry.photoName || '',
    photoCapturedAt: entry.photoCapturedAt || payload.photoUploadedAt || '',
    photoUploadedAt: payload.photoUploadedAt || new Date().toISOString(),
    photoMimeType: payload.photoContentType || 'image/jpeg',
    photoSizeBytes: Number(payload.photoSizeBytes || 0),
    photoUploadStatus: 'uploaded',
  };
};
