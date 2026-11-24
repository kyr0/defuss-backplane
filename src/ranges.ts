/** VERIFIED: RFC 9110 sections 13 and 14 define these preconditions and byte ranges. A VFS content revision is a strong
 * validator, because defuss-vfs assigns a new one on every write, so the files route uses it as the ETag. */
import type { VfsObject } from "./vfs.js";

/** What a GET or HEAD of one object answers: the whole object, one byte range, or a bodyless status. */
export type Decision =
  | { status: 200 }
  | { status: 206; offset: number; length: number }
  | { status: 304 | 412 | 416 };

export const etag = (object: VfsObject) => '"' + object.revision + '"';
const seconds = (ms: number) => Math.floor(ms / 1000);
function date(value: string | null) {
  const ms = value === null ? NaN : Date.parse(value);
  return Number.isNaN(ms) ? undefined : seconds(ms);
}
/** True when an If-Match or If-None-Match list names `tag`. Only If-None-Match compares weakly. */
function listed(value: string, tag: string, weak: boolean) {
  if (value.trim() === "*") return true;
  return value
    .split(",")
    .map((entry) => entry.trim())
    .some((entry) => (weak ? entry.replace(/^W\//, "") : entry) === tag);
}

/** Evaluates preconditions in the RFC 9110 section 13.2.2 order, then a single `bytes` range. A multi-range or
 * malformed Range is ignored, which the RFC allows. If-Range accepts only the ETag: a one-second Last-Modified cannot
 * tell two writes in the same second apart, so a date there always sends the whole object. */
export function decide(
  method: string,
  headers: Headers,
  object: VfsObject,
): Decision {
  const tag = etag(object);
  const modified = seconds(object.mtimeMs);
  const match = headers.get("if-match");
  if (match !== null) {
    if (!listed(match, tag, false)) return { status: 412 };
  } else {
    const since = date(headers.get("if-unmodified-since"));
    if (since !== undefined && modified > since) return { status: 412 };
  }
  const none = headers.get("if-none-match");
  if (none !== null) {
    if (listed(none, tag, true)) return { status: 304 };
  } else {
    const since = date(headers.get("if-modified-since"));
    if (since !== undefined && modified <= since) return { status: 304 };
  }
  const range = headers.get("range");
  const condition = headers.get("if-range");
  if (method !== "GET" || range === null) return { status: 200 };
  if (condition !== null && condition.trim() !== tag) return { status: 200 };
  const bounds = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
  if (!bounds || (bounds[1] === "" && bounds[2] === "")) return { status: 200 };
  const size = object.size;
  let start: number, end: number;
  if (bounds[1] === "") {
    start = Math.max(0, size - Number(bounds[2]));
    end = Number(bounds[2]) === 0 ? -1 : size - 1;
  } else {
    start = Number(bounds[1]);
    if (bounds[2] !== "" && Number(bounds[2]) < start) return { status: 200 };
    end = bounds[2] === "" ? size - 1 : Math.min(Number(bounds[2]), size - 1);
  }
  if (start >= size || end < start) return { status: 416 };
  return { status: 206, offset: start, length: end - start + 1 };
}

/** Inert media and document types by extension. Every other key, scriptable HTML, SVG and JavaScript included, is
 * served as application/octet-stream with nosniff, so a proxy on an application origin cannot run a tenant's file. */
const types: Record<string, string> = {
  avif: "image/avif",
  csv: "text/csv; charset=utf-8",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  json: "application/json",
  m4a: "audio/mp4",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  ogg: "audio/ogg",
  pdf: "application/pdf",
  png: "image/png",
  txt: "text/plain; charset=utf-8",
  wav: "audio/wav",
  webm: "video/webm",
  webp: "image/webp",
};
export function contentType(key: string) {
  const name = key.slice(key.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return (dot > 0 && types[name.slice(dot + 1).toLowerCase()]) || "application/octet-stream";
}
