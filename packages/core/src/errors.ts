export type RemoteErrorCode =
  | "REMOTE_LOCK_HELD"
  | "REMOTE_LOCK_LOST"
  | "REMOTE_UNSUPPORTED";

export class RemoteError extends Error {
  readonly code: RemoteErrorCode;
  readonly holderDeviceId?: string;
  readonly holderDeviceName?: string;
  readonly expiresAt?: string;

  constructor(
    code: RemoteErrorCode,
    message: string,
    extras?: {
      holderDeviceId?: string;
      holderDeviceName?: string;
      expiresAt?: string;
    },
  ) {
    super(message);
    this.name = "RemoteError";
    this.code = code;
    if (extras?.holderDeviceId != null) {
      this.holderDeviceId = extras.holderDeviceId;
    }
    if (extras?.holderDeviceName != null) {
      this.holderDeviceName = extras.holderDeviceName;
    }
    if (extras?.expiresAt != null) {
      this.expiresAt = extras.expiresAt;
    }
  }
}

export function isRemoteError(error: unknown): error is RemoteError {
  return error instanceof RemoteError;
}
