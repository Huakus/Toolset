export interface StringBlobStore {
  getBlob(): Promise<string | null>;
  setBlob(value: string): Promise<void>;
}

export class BlobStoreReadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BlobStoreReadError";
  }
}

export class BlobStoreWriteError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BlobStoreWriteError";
  }
}
