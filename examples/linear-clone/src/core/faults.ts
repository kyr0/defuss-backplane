/** VERIFIED: by probe with defuss-rpc 4.3.0, every error a function throws reaches the client as HTTP 500 with the body
 * `{"error":"Error calling function <method>: <message>"}`, whatever the error carries. So an API method throws a
 * message that starts with a code, the server turns the code into its HTTP status, and the browser reads the code
 * back. Why codes in the message rather than result objects: MCP agents and the browser then see one failure path,
 * and every method keeps its plain return type. */

export const FAULTS = {
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
  REVISION_CONFLICT: 409,
  TOO_LARGE: 413,
  UNAVAILABLE: 503,
  INTERNAL: 500,
} as const;
export type FaultCode = keyof typeof FAULTS;
export type Fault = { code: FaultCode; message: string; field?: string };

/** `CODE: message`, or `CODE(field): message` when the input field is known. */
export function faultMessage(fault: Fault) {
  return fault.code + (fault.field ? "(" + fault.field + ")" : "") + ": " + fault.message;
}

const CODED = /^([A-Z_]+)(?:\(([^)]*)\))?: ([\s\S]*)$/;

/** The fault in an RPC error body or message; anything without a known code is INTERNAL. */
export function parseFault(text: string): Fault {
  let message = text;
  try {
    const body = JSON.parse(text) as { error?: unknown };
    if (typeof body?.error === "string") message = body.error;
  } catch {
    // Not JSON: the text itself is the message.
  }
  message = message.replace(/^Error calling function [^:]*: /, "");
  const match = CODED.exec(message);
  if (match && Object.hasOwn(FAULTS, match[1]!)) {
    const fault: Fault = { code: match[1] as FaultCode, message: match[3]! };
    if (match[2]) fault.field = match[2];
    return fault;
  }
  return { code: "INTERNAL", message };
}
