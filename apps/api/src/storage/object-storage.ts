import { nanoid } from "nanoid";

export interface SignedUpload {
  key: string;
  uploadUrl: string;
  expiresAt: string;
}

export class ObjectStorageService {
  createSignedUpload(workspaceId: string, fileName: string): SignedUpload {
    const key = `uploads/${workspaceId}/${nanoid()}-${fileName}`;
    const expires = new Date(Date.now() + 5 * 60_000).toISOString();
    return {
      key,
      uploadUrl: `https://example-bucket.s3.amazonaws.com/${encodeURIComponent(key)}?signature=mock`,
      expiresAt: expires
    };
  }
}
