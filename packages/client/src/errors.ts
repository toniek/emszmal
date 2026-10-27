export type ErrorCode =
  | 'VALIDATION' | 'SESSION_STATE' | 'TRANSPORT' | 'HTTP'
  | 'API' | 'INVALID_RESPONSE' | 'TIMEOUT' | 'ABORTED' | 'AUTHENTICATION';

/** Messages never include credentials, cookies, raw response bodies or URLs. */
export class EmszmalError extends Error {
  readonly code: ErrorCode;
  readonly status: number | undefined;
  /** A failed cleanup must not hide the original operation error. */
  cleanupError?: EmszmalError;

  constructor(code: ErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'EmszmalError';
    this.code = code;
    this.status = status;
  }
}

export function validation(message: string): never {
  throw new EmszmalError('VALIDATION', message);
}

export function aborted(): EmszmalError {
  return new EmszmalError('ABORTED', 'The operation was cancelled.');
}
