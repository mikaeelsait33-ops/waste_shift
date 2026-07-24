const PDF_INLINE_MAX_BYTES = 2.6 * 1024 * 1024;
const REQUEST_FILE_BYTES_BUDGET = 2.9 * 1024 * 1024;
const IMAGE_MAX_EDGE = 1700;
const IMAGE_QUALITY = 0.82;
const MAX_FILES_PER_REQUEST = 2;
const PDF_INLINE_MAX_PAGES = 2;
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

export const createMakeLineGuideRequestBatches = (files = []) => {
  const batches = [];
  let currentBatch = [];
  let currentBytes = 0;

  files.forEach((file) => {
    const fileBytes = getApproxBase64Bytes(file?.base64);

    if (fileBytes > REQUEST_FILE_BYTES_BUDGET) {
      throw new Error('A make-line guide page is too large after compression. Export the guide at a lower resolution or upload a clear photo of that page.');
    }

    if (
      currentBatch.length > 0
      && (
        currentBatch.length >= MAX_FILES_PER_REQUEST
        || currentBytes + fileBytes > REQUEST_FILE_BYTES_BUDGET
      )
    ) {
      batches.push(currentBatch);
      currentBatch = [];
      currentBytes = 0;
    }

    currentBatch.push(file);
    currentBytes += fileBytes;
  });

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
};

const openPdf = async (file) => {
  const pdfjs = await getPdfjs();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    disableFontFace: true,
    isEvalSupported: false,
  });

  return {
    loadingTask,
    pdf: await loadingTask.promise,
  };
};

const closePdf = async ({ loadingTask, pdf }) => {
  pdf?.cleanup?.();
  await loadingTask?.destroy?.();
};

const createPdfPagePayloads = async (file, options = {}, existingPdf = null) => {
  const pdfHandle = existingPdf || await openPdf(file);
  const { pdf } = pdfHandle;
  const files = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      options.onProgress?.(`Preparing PDF page ${pageNumber} of ${pdf.numPages}...`);
      const payload = await renderPdfPagePayload({ pdf, pageNumber, sourceName: file.name });

      if (payload?.base64) {
        files.push(payload);
      }
    }
  } finally {
    if (!existingPdf) {
      await closePdf(pdfHandle);
    }
  }

  if (files.length !== pdf.numPages) {
    throw new Error(`Could only prepare ${files.length} of ${pdf.numPages} PDF pages. Export the guide again or upload clear guide photos.`);
  }

  return {
    files,
    fileBatches: createMakeLineGuideRequestBatches(files),
    notice: `Read all ${files.length} PDF page${files.length === 1 ? '' : 's'} in ${Math.ceil(files.length / MAX_FILES_PER_REQUEST)} upload section${files.length === 1 ? '' : 's'}.`,
  };
};

export const prepareMakeLineGuideFilePayloads = async (file, options = {}) => {
  const normalizedType = normalizeFileType(file);

  if (!normalizedType) {
    throw new Error('Upload a PDF, JPG, PNG, or WebP make-line guide.');
  }

  if (normalizedType === 'pdf') {
    const pdfHandle = await openPdf(file);

    if (file.size <= PDF_INLINE_MAX_BYTES && pdfHandle.pdf.numPages <= PDF_INLINE_MAX_PAGES) {
      try {
        const payload = await createRawFilePayload(file, 'application/pdf');

        return {
          files: [payload],
          fileBatches: [[payload]],
          notice: '',
        };
      } finally {
        await closePdf(pdfHandle);
      }
    }

    return createPdfPagePayloads(file, options, pdfHandle).finally(() => closePdf(pdfHandle));
  }

  const payload = await createCompressedImagePayload(file);

  if (getApproxBase64Bytes(payload.base64) > REQUEST_FILE_BYTES_BUDGET) {
    throw new Error('This guide image is still too large after compression. Take a closer photo of only the make-line guide.');
  }

  return {
    files: [payload],
    fileBatches: [[payload]],
    notice: file.size > getApproxBase64Bytes(payload.base64)
      ? 'Compressed the guide photo for faster upload.'
      : '',
  };
};
