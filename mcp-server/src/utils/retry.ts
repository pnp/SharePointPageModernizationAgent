import { logger } from './logger.js';

export const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 250;

export interface RetryOptions {
  maxRetries?: number;
  delayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function retryOperation<T>(
  operation: string,
  action: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? MAX_RETRIES;
  const delayMs = options.delayMs ?? RETRY_DELAY_MS;
  const sleep = options.sleep ?? (async (durationMs: number) => {
    await new Promise<void>(resolve => setTimeout(resolve, durationMs));
  });
  let lastError: unknown;

  for (let retry = 0; retry <= maxRetries; retry++) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (retry === maxRetries) break;

      logger.warn(`${operation} failed; retrying`, {
        attempt: retry + 1,
        totalAttempts: maxRetries + 1,
        retriesRemaining: maxRetries - retry,
        error: toErrorMessage(error),
      });
      await sleep(delayMs * (retry + 1));
    }
  }

  throw lastError;
}
