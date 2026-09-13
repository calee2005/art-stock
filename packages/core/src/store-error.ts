export type StoreErrorCode =
  | "NOT_FOUND"
  | "PRECONDITION_FAILED"
  | "REMOTE_UNSUPPORTED";

export class StoreError extends Error {
  readonly code: StoreErrorCode;

  constructor(code: StoreErrorCode, message: string) {
    super(message);
    this.name = "StoreError";
    this.code = code;
  }
}

export function isStoreError(error: unknown): error is StoreError {
  return error instanceof StoreError;
}
