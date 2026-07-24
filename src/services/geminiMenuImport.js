import {
  getAutomaticManagerApiHeaders,
  getManagerApiErrorMessage,
} from '../utils/apiHeaders';
import { mergeGeminiMenuImportPayloads } from '../utils/geminiMenuPayload';

export const GEMINI_MENU_CLIENT_TIMEOUT_MS = 95_000;

export const getGeminiMenuImportErrorMessage = (response, payload = {}) => {
  if (response?.status === 413) {
    return 'This make-line guide section is too large to upload. Try a clearer, lower-resolution guide export.';
  }

  if (response?.status === 429) {
    return 'Gemini is busy right now. Wait a moment and retry this guide.';
  }

  if (response?.status === 504) {
    return payload?.message || 'Gemini reached the time limit while reading this guide. Retry once or upload fewer pages.';
  }

  if ([502, 503].includes(response?.status)) {
    return payload?.message || 'Gemini is temporarily unavailable. Retry this guide in a moment.';
  }

  return getManagerApiErrorMessage(payload, 'Gemini could not read this make-line guide.');
};

const requestSingleGeminiMenuImport = async ({
  text = '',
  files = [],
  onProgress,
  timeoutMs,
  sectionLabel = '',
}) => {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  const slowProgressId = window.setTimeout(() => {
    onProgress?.(`Gemini is checking ${sectionLabel || 'the guide'}...`);
  }, 18_000);
  const finalProgressId = window.setTimeout(() => {
    onProgress?.('Gemini is finishing the recipe breakdown...');
  }, 45_000);

  try {
    const response = await fetch('/api/gemini-menu', {
      method: 'POST',
      headers: await getAutomaticManagerApiHeaders({ 'content-type': 'application/json' }),
      signal: controller.signal,
      body: JSON.stringify({
        text,
        files,
        sourceType: 'make-line-guide',
      }),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || payload.ok === false || payload.success === false) {
      throw new Error(getGeminiMenuImportErrorMessage(response, payload));
    }

    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('The guide upload timed out. Retry once or use clearer guide pages.');
    }

    if (error instanceof TypeError) {
      throw new Error('The guide upload did not reach the server. Check the connection and retry.');
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
    window.clearTimeout(slowProgressId);
    window.clearTimeout(finalProgressId);
  }
};

export const requestGeminiMenuImport = async ({
  text = '',
  files = [],
  fileBatches = [],
  onProgress,
  timeoutMs = GEMINI_MENU_CLIENT_TIMEOUT_MS,
}) => {
  const batches = Array.isArray(fileBatches) && fileBatches.length > 0
    ? fileBatches
    : [files];

  if (batches.length === 1) {
    return requestSingleGeminiMenuImport({
      text,
      files: batches[0],
      onProgress,
      timeoutMs,
    });
  }

  const results = new Array(batches.length);
  let nextBatchIndex = 0;
  const worker = async () => {
    while (nextBatchIndex < batches.length) {
      const batchIndex = nextBatchIndex;
      nextBatchIndex += 1;
      const sectionLabel = `guide section ${batchIndex + 1} of ${batches.length}`;
      onProgress?.(`Reading ${sectionLabel}...`);

      try {
        results[batchIndex] = await requestSingleGeminiMenuImport({
          text,
          files: batches[batchIndex],
          onProgress,
          timeoutMs,
          sectionLabel,
        });
      } catch (error) {
        throw new Error(`${sectionLabel} failed. ${error?.message || 'Gemini could not read this section.'}`);
      }

      onProgress?.(`Read ${batchIndex + 1} of ${batches.length} guide sections. Continuing...`);
    }
  };

  await Promise.all([
    worker(),
    worker(),
  ].slice(0, Math.min(2, batches.length)));

  return mergeGeminiMenuImportPayloads(results);
};
