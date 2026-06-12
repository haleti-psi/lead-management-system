/**
 * Structural shape of a multer in-memory upload (FR-010 bulk import). We depend
 * on this minimal surface instead of `@types/multer`/`@types/express` (not in
 * dependency-register.md) — the Wave-1 `HttpRequestLike` convention.
 */
export interface UploadedFileLike {
  originalname?: string;
  mimetype?: string;
  size: number;
  buffer: Buffer;
}
