/** VERIFIED: Both public import paths expose the same backend client, without importing the daemon or opening storage. */
export { BackplaneError, connectBackplane } from "./client.js";
export type {
  ErrorCode,
  Versioned,
  WriteOptions,
  CacheWriteOptions,
  Scope,
  CacheResult,
  Row,
  InputRow,
  Query,
  UploadBody,
  VfsDownload,
  VfsHead,
  VfsListRequest,
  VfsObject,
  VfsPage,
  VfsRange,
  VfsRead,
} from "./client.js";
