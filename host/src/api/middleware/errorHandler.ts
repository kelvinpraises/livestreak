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
