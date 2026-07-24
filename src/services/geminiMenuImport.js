import {
  getAutomaticManagerApiHeaders,
  getManagerApiErrorMessage,
} from '../utils/apiHeaders';
import { mergeGeminiMenuImportPayloads } from '../utils/geminiMenuPayload';

export const GEMINI_MENU_CLIENT_TIMEOUT_MS = 95_000;
const GEMINI_MAX_RETRIES = 4;
const GEMINI_REQUEST_GAP_MS = 4_000;
const GEMINI_RETRY_BASE_DELAY_MS = 4_000;
const RETRYABLE_GEMINI_STATUSES = new Set([429, 502, 503, 504]);

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
      const error = new Error(getGeminiMenuImportErrorMessage(response, payload));
      error.status = response.status;
      error.retryAfterMs = Number(response.headers?.get?.('retry-after')) > 0
        ? Number(response.headers.get('retry-after')) * 1000
        : null;
      error.retryable = RETRYABLE_GEMINI_STATUSES.has(response.status);
      throw error;
    }

    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('The guide upload timed out. Retry once or use clearer guide pages.');
      timeoutError.status = 504;
      timeoutError.retryable = true;
      throw timeoutError;
    }

    if (error instanceof TypeError) {
      const networkError = new Error('The guide upload did not reach the server. Check the connection and retry.');
      networkError.status = 503;
      networkError.retryable = true;
      throw networkError;
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
    window.clearTimeout(slowProgressId);
    window.clearTimeout(finalProgressId);
  }
};

const wait = (milliseconds) => new Promise((resolve) => {
  window.setTimeout(resolve, milliseconds);
});

const getRetryDelay = (error, attempt) => {
  if (Number.isFinite(error?.retryAfterMs) && error.retryAfterMs > 0) {
    return Math.min(30_000, error.retryAfterMs);
  }

  const exponentialDelay = Math.min(30_000, GEMINI_RETRY_BASE_DELAY_MS * (2 ** attempt));
  return exponentialDelay + Math.round(Math.random() * 800);
};

const requestGeminiWithRetry = async ({
  text,
  files,
  onProgress,
  timeoutMs,
  sectionLabel,
  requestState = { lastStartedAt: 0 },
}) => {
  for (let attempt = 0; attempt <= GEMINI_MAX_RETRIES; attempt += 1) {
    const nextAllowedStart = requestState.lastStartedAt + GEMINI_REQUEST_GAP_MS;
    const waitForGap = nextAllowedStart - Date.now();

    if (waitForGap > 0) {
      await wait(waitForGap);
    }

    requestState.lastStartedAt = Date.now();

    try {
      return await requestSingleGeminiMenuImport({
        text,
        files,
        onProgress,
        timeoutMs,
        sectionLabel,
      });
    } catch (error) {
      if (!error?.retryable || attempt >= GEMINI_MAX_RETRIES) {
        throw error;
      }

      const retryNumber = attempt + 1;
      const delay = getRetryDelay(error, attempt);
      onProgress?.(`${sectionLabel || 'This guide section'} is busy. Retrying ${retryNumber} of ${GEMINI_MAX_RETRIES} in ${Math.ceil(delay / 1000)} seconds...`);
      await wait(delay);
    }
  }

  throw new Error(`${sectionLabel || 'Guide'} could not be read after several retries.`);
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
  const requestState = { lastStartedAt: 0 };

  if (batches.length === 1) {
    return requestGeminiWithRetry({
      text,
      files: batches[0],
      onProgress,
      timeoutMs,
      requestState,
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
        results[batchIndex] = await requestGeminiWithRetry({
          text,
          files: batches[batchIndex],
          onProgress,
          timeoutMs,
          sectionLabel,
          requestState,
        });
      } catch (error) {
        throw new Error(`${sectionLabel} failed. ${error?.message || 'Gemini could not read this section.'}`);
      }

      onProgress?.(`Read ${batchIndex + 1} of ${batches.length} guide sections. Continuing...`);
    }
  };

  const workerCount = batches.length > 4 ? 1 : Math.min(2, batches.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return mergeGeminiMenuImportPayloads(results);
};
