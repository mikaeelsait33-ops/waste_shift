const PDF_INLINE_MAX_BYTES = 2.6 * 1024 * 1024;
const REQUEST_FILE_BYTES_BUDGET = 2.9 * 1024 * 1024;
const IMAGE_MAX_EDGE = 1700;
const IMAGE_QUALITY = 0.82;
const PDF_RENDER_MAX_PAGES = 6;
const PDF_RENDER_ATTEMPTS = [
  { maxEdge: 1700, quality: 0.8 },
  { maxEdge: 1350, quality: 0.74 },
  { maxEdge: 1050, quality: 0.7 },
];
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const readBlobAsDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();

  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(new Error('Could not read this make-line guide file.'));
  reader.readAsDataURL(blob);
});

const getBase64FromDataUrl = (dataUrl) => String(dataUrl || '').split(',').pop() || '';

const getApproxBase64Bytes = (base64) => Math.ceil(String(base64 || '').length * 0.75);

const canvasToJpegBlob = (canvas, quality) => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => {
    if (blob) {
      resolve(blob);
      return;
    }

    reject(new Error('Could not compress this make-line guide page.'));
  }, 'image/jpeg', quality);
});

const loadImage = (file) => new Promise((resolve, reject) => {
  const imageUrl = URL.createObjectURL(file);
  const image = new Image();

  image.onload = () => {
    URL.revokeObjectURL(imageUrl);
    resolve(image);
  };
  image.onerror = () => {
    URL.revokeObjectURL(imageUrl);
    reject(new Error('Could not load this make-line guide image.'));
  };
  image.src = imageUrl;
});

const normalizeFileType = (file) => {
  const explicitType = String(file?.type || '').toLowerCase();
  const name = String(file?.name || '').toLowerCase();

  if (explicitType === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (SUPPORTED_IMAGE_TYPES.has(explicitType)) return explicitType;
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.webp')) return 'image/webp';
  return '';
};

const createRawFilePayload = async (file, mimeType) => {
  const dataUrl = await readBlobAsDataUrl(file);

  return {
    name: file.name,
    mimeType,
    base64: getBase64FromDataUrl(dataUrl),
  };
};

const createCompressedImagePayload = async (file) => {
  const image = await loadImage(file);
  const scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext('2d');

  canvas.width = width;
  canvas.height = height;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const blob = await canvasToJpegBlob(canvas, IMAGE_QUALITY);
  const dataUrl = await readBlobAsDataUrl(blob);

  canvas.width = 0;
  canvas.height = 0;

  return {
    name: file.name.replace(/\.[^.]+$/, '') + '.jpg',
    mimeType: 'image/jpeg',
    base64: getBase64FromDataUrl(dataUrl),
  };
};

let pdfjsPromise = null;

const getPdfjs = async () => {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.mjs?url'),
    ]).then(([pdfjs, workerModule]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default || workerModule;
      return pdfjs;
    });
  }

  return pdfjsPromise;
};

const renderPdfPagePayload = async ({ pdf, pageNumber, sourceName }) => {
  const page = await pdf.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  let lastPayload = null;

  for (const attempt of PDF_RENDER_ATTEMPTS) {
    const scale = Math.min(2, attempt.maxEdge / Math.max(baseViewport.width, baseViewport.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: context, viewport }).promise;

    const blob = await canvasToJpegBlob(canvas, attempt.quality);
    const dataUrl = await readBlobAsDataUrl(blob);
    const payload = {
      name: `${sourceName.replace(/\.[^.]+$/, '')}-page-${pageNumber}.jpg`,
      mimeType: 'image/jpeg',
      base64: getBase64FromDataUrl(dataUrl),
    };

    canvas.width = 0;
    canvas.height = 0;
    lastPayload = payload;

    if (getApproxBase64Bytes(payload.base64) <= REQUEST_FILE_BYTES_BUDGET / 2) {
      return payload;
    }
  }

  return lastPayload;
};

const createPdfPagePayloads = async (file) => {
  const pdfjs = await getPdfjs();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    disableFontFace: true,
    isEvalSupported: false,
  });
  const pdf = await loadingTask.promise;
  const files = [];
  let totalBytes = 0;
  const maxPages = Math.min(pdf.numPages, PDF_RENDER_MAX_PAGES);

  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    const payload = await renderPdfPagePayload({ pdf, pageNumber, sourceName: file.name });
    const payloadBytes = getApproxBase64Bytes(payload?.base64);

    if (!payload?.base64) {
      continue;
    }

    if (totalBytes + payloadBytes > REQUEST_FILE_BYTES_BUDGET) {
      if (files.length === 0) {
        throw new Error('This PDF page is too large after compression. Export only the make-line guide pages or take a clear photo.');
      }

      break;
    }

    files.push(payload);
    totalBytes += payloadBytes;
  }

  if (files.length === 0) {
    throw new Error('Could not prepare any pages from this PDF. Export the make-line guide pages again or take clear photos.');
  }

  return {
    files,
    notice: pdf.numPages > files.length
      ? `Read the first ${files.length} of ${pdf.numPages} PDF page${pdf.numPages === 1 ? '' : 's'} to keep the upload fast.`
      : `Converted ${files.length} PDF page${files.length === 1 ? '' : 's'} for upload.`,
  };
};

export const prepareMakeLineGuideFilePayloads = async (file) => {
  const normalizedType = normalizeFileType(file);

  if (!normalizedType) {
    throw new Error('Upload a PDF, JPG, PNG, or WebP make-line guide.');
  }

  if (normalizedType === 'pdf') {
    if (file.size <= PDF_INLINE_MAX_BYTES) {
      return {
        files: [await createRawFilePayload(file, 'application/pdf')],
        notice: '',
      };
    }

    return createPdfPagePayloads(file);
  }

  const payload = await createCompressedImagePayload(file);

  if (getApproxBase64Bytes(payload.base64) > REQUEST_FILE_BYTES_BUDGET) {
    throw new Error('This guide image is still too large after compression. Take a closer photo of only the make-line guide.');
  }

  return {
    files: [payload],
    notice: file.size > getApproxBase64Bytes(payload.base64)
      ? 'Compressed the guide photo for faster upload.'
      : '',
  };
};
