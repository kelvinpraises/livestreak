import { LiveStreakConfigError, isLiveStreakError, serializeLiveStreakError, serializeUnknownError } from "@livestreak/core";
import type { ErrorRequestHandler, RequestHandler } from "express";

// --- exports ---

export const malformedJsonHandler: ErrorRequestHandler = (err, _req, _res, next) => {
  if (err instanceof SyntaxError && "body" in err) {
    next(
      new LiveStreakConfigError({
        message: "Malformed JSON request body",
        metadata: { retryable: false }
      })
    );
    return;
  }

  next(err);
};

// H6: map body-parser's "entity.too.large" (raw status 413) to a typed error
// envelope instead of letting it fall through to a generic 500.
export const payloadTooLargeHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (
    err !== null &&
    typeof err === "object" &&
    (err as { type?: unknown }).type === "entity.too.large"
  ) {
    const error = new LiveStreakConfigError({
      message: "Request body exceeds the maximum allowed size",
      metadata: { retryable: false }
    });
    res.status(413).json({ error: serializeLiveStreakError(error) });
    return;
  }

  next(err);
};

export const notFoundHandler: RequestHandler = (req, res) => {
  const error = new LiveStreakConfigError({
    message: `No route for ${req.method} ${req.path}`,
    metadata: { retryable: false }
  });
  res.status(404).json({ error: serializeLiveStreakError(error) });
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const status = isLiveStreakError(err) ? 400 : 500;
  const body = {
    error: isLiveStreakError(err) ? serializeLiveStreakError(err) : serializeUnknownError(err)
  };
  res.status(status).json(body);
};
