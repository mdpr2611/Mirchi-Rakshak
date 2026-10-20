// Captures the original Error out-of-band so server.ts can recover the stack
// when h3 has already swallowed the throw into a generic 500 Response.

let lastCapturedError: { error: unknown; at: number } | undefined;
const TTL_MS = 15_000;

function record(error: unknown) {
  if (!error) return;
  lastCapturedError = { error, at: Date.now() };
}

if (typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("error", (event) => record((event as ErrorEvent).error ?? event));
  globalThis.addEventListener("unhandledrejection", (event) =>
    record((event as PromiseRejectionEvent).reason),
  );
}

if (typeof process !== "undefined" && typeof process.on === "function") {
  process.on("unhandledRejection", (reason) => record(reason));
  process.on("uncaughtException", (err) => record(err));
}

// Intercept console.error because h3 calls console.error(error) on unhandled throws
if (typeof console !== "undefined" && typeof console.error === "function") {
  const origConsoleError = console.error;
  console.error = function (...args: unknown[]) {
    for (const arg of args) {
      if (arg instanceof Error) {
        record(arg);
      } else if (arg && typeof arg === "object" && "cause" in arg && (arg as any).cause instanceof Error) {
        record((arg as any).cause);
      }
    }
    return origConsoleError.apply(this, args);
  };
}

export function consumeLastCapturedError(): unknown {
  if (!lastCapturedError) return undefined;
  if (Date.now() - lastCapturedError.at > TTL_MS) {
    lastCapturedError = undefined;
    return undefined;
  }
  const { error } = lastCapturedError;
  lastCapturedError = undefined;
  return error;
}
