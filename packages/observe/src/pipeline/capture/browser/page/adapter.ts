import { Effect } from "effect";
import {
  LiveStreakCapabilityError,
  LiveStreakRuntimeError,
  type LiveStreakError
} from "@livestreak/core";
import type {
  BrowserCaptureAdapter,
  BrowserCaptureCrop,
  BrowserCaptureOpenOptions,
  BrowserCapturePage,
  BrowserCaptureScreenshot,
  BrowserCaptureScreenshotOptions
} from "./types.js";
import type { BrowserCaptureTarget } from "#pipeline/capture/browser/control/preview.js";
import {
  browserTargetDetectionScript,
  normalizeDetectedBrowserTargets,
  parseDetectedBrowserTargetCandidates
} from "./target-detection.js";

export type BrowserPageCaptureAdapterKind = "auto" | "playwright" | "puppeteer" | "cdp";

export type ResolvedBrowserPageCaptureAdapterKind = Exclude<
  BrowserPageCaptureAdapterKind,
  "auto"
>;

export type BrowserCaptureReadinessErrorCode = "missing-method" | "unsupported-page";

export interface BrowserCaptureReadinessError extends LiveStreakCapabilityError {
  readonly readinessCode: BrowserCaptureReadinessErrorCode;
  readonly adapterKind?: BrowserPageCaptureAdapterKind;
  readonly requiredMethod?: string;
}

export type BrowserCaptureBridgeErrorCode =
  | "browser-call-failed"
  | "unsupported-screenshot-result";

export interface BrowserCaptureBridgeError extends LiveStreakRuntimeError {
  readonly bridgeCode: BrowserCaptureBridgeErrorCode;
  readonly adapterKind: ResolvedBrowserPageCaptureAdapterKind;
  readonly method?: string;
}

export interface BrowserCapturePageReadiness {
  readonly kind: ResolvedBrowserPageCaptureAdapterKind;
  readonly requiredMethods: readonly string[];
  readonly optionalMethods: readonly string[];
  readonly canClose: boolean;
}

export interface BrowserPageCaptureAdapterOptions {
  readonly kind?: BrowserPageCaptureAdapterKind;
  readonly pageName?: string;
  readonly closePage?: boolean;
}

export type BrowserPageCaptureFactory = (
  options: BrowserCaptureOpenOptions
) => Effect.Effect<unknown, LiveStreakError>;

type UnknownRecord = Record<PropertyKey, unknown>;

interface MethodReference {
  readonly owner: UnknownRecord;
  readonly name: string;
  readonly method: (...arguments_: readonly unknown[]) => unknown;
}

export const validateBrowserCapturePageReadiness = (
  page: unknown,
  options: BrowserPageCaptureAdapterOptions = {}
): Effect.Effect<BrowserCapturePageReadiness, BrowserCaptureReadinessError> =>
  Effect.gen(function* () {
    const requested = options.kind ?? "auto";
    const kind = yield* resolveKind(page, requested, options.pageName);
    const requiredMethods = requiredMethodsForKind(kind);

    yield* Effect.all(
      requiredMethods.map((method) =>
        validateRequiredMethod(page, kind, method, options.pageName)
      ),
      { discard: true }
    );

    return {
      kind,
      requiredMethods,
      optionalMethods: ["close"],
      canClose: hasMethod(page, "close")
    };
  });

export const makeBrowserPageCaptureAdapter = (
  page: unknown,
  options: BrowserPageCaptureAdapterOptions = {}
): BrowserCaptureAdapter => ({
  openPage: (openOptions) => openBrowserCapturePage(page, openOptions, options)
});

export const makeBrowserPageFactoryCaptureAdapter = (
  createPage: BrowserPageCaptureFactory,
  options: BrowserPageCaptureAdapterOptions = {}
): BrowserCaptureAdapter => ({
  openPage: (openOptions) =>
    Effect.gen(function* () {
      const page = yield* createPage(openOptions);

      return yield* openBrowserCapturePage(page, openOptions, {
        ...options,
        closePage: options.closePage ?? true
      });
    })
});

// --- helpers ---

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null;

const methodReference = (owner: unknown, name: string): MethodReference | undefined => {
  if (!isRecord(owner)) {
    return undefined;
  }

  const method = owner[name];
  if (typeof method !== "function") {
    return undefined;
  }

  return {
    owner,
    name,
    method: method as (...arguments_: readonly unknown[]) => unknown
  };
};

const cdpSendReference = (page: unknown): MethodReference | undefined => {
  const direct = methodReference(page, "send");
  if (direct !== undefined) {
    return direct;
  }

  if (!isRecord(page)) {
    return undefined;
  }

  return methodReference(page.client, "send");
};

const hasMethod = (page: unknown, name: string): boolean =>
  methodReference(page, name) !== undefined;

const readinessError = (options: {
  readonly code: BrowserCaptureReadinessErrorCode;
  readonly message: string;
  readonly details: string;
  readonly adapterKind?: BrowserPageCaptureAdapterKind;
  readonly requiredMethod?: string;
}): BrowserCaptureReadinessError =>
  Object.assign(
    new LiveStreakCapabilityError({
      message: options.message,
      requiredScope:
        options.requiredMethod === undefined
          ? "capture:browser:*"
          : (`capture:browser:${options.requiredMethod}` as const),
      metadata: {
        details: options.details
      }
    }),
    {
      readinessCode: options.code,
      adapterKind: options.adapterKind,
      requiredMethod: options.requiredMethod
    }
  );

const bridgeError = (options: {
  readonly code: BrowserCaptureBridgeErrorCode;
  readonly kind: ResolvedBrowserPageCaptureAdapterKind;
  readonly method?: string;
  readonly message: string;
  readonly cause?: unknown;
}): BrowserCaptureBridgeError =>
  Object.assign(
    new LiveStreakRuntimeError({
      message: options.message,
      metadata: {
        cause: options.cause,
        details:
          options.method === undefined
            ? `Browser page adapter ${options.kind} failed.`
            : `Browser page adapter ${options.kind} failed while calling ${options.method}.`
      }
    }),
    {
      bridgeCode: options.code,
      adapterKind: options.kind,
      method: options.method
    }
  );

const requiredMethodError = (
  kind: BrowserPageCaptureAdapterKind,
  method: string,
  pageName?: string
): BrowserCaptureReadinessError =>
  readinessError({
    code: "missing-method",
    adapterKind: kind,
    requiredMethod: method,
    message: "Browser capture page is missing a required method",
    details: `${pageName ?? "browser page"} must provide ${method}() for the ${kind} adapter.`
  });

const unsupportedPageError = (pageName?: string): BrowserCaptureReadinessError =>
  readinessError({
    code: "unsupported-page",
    adapterKind: "auto",
    message: "Browser capture could not infer a browser page adapter",
    details: `${pageName ?? "browser page"} must look like a Playwright page, Puppeteer page, or CDP client.`
  });

const callBrowserMethod = <A>(
  reference: MethodReference,
  kind: ResolvedBrowserPageCaptureAdapterKind,
  callArguments: readonly unknown[] = []
): Effect.Effect<A, BrowserCaptureBridgeError> =>
  Effect.tryPromise({
    try: () =>
      Promise.resolve(reference.method.apply(reference.owner, [...callArguments]) as A),
    catch: (cause) =>
      bridgeError({
        code: "browser-call-failed",
        kind,
        method: reference.name,
        message: "Browser capture page call failed",
        cause
      })
  });

const resolveKind = (
  page: unknown,
  requested: BrowserPageCaptureAdapterKind,
  pageName?: string
): Effect.Effect<ResolvedBrowserPageCaptureAdapterKind, BrowserCaptureReadinessError> => {
  if (requested !== "auto") {
    return Effect.succeed(requested);
  }

  if (hasMethod(page, "screenshot") && hasMethod(page, "goto") && hasMethod(page, "setViewportSize")) {
    return Effect.succeed("playwright");
  }

  if (hasMethod(page, "screenshot") && hasMethod(page, "goto") && hasMethod(page, "setViewport")) {
    return Effect.succeed("puppeteer");
  }

  if (cdpSendReference(page) !== undefined) {
    return Effect.succeed("cdp");
  }

  return Effect.fail(unsupportedPageError(pageName));
};

const requiredMethodsForKind = (
  kind: ResolvedBrowserPageCaptureAdapterKind
): readonly string[] => {
  switch (kind) {
    case "playwright": {
      return ["goto", "setViewportSize", "screenshot"];
    }
    case "puppeteer": {
      return ["goto", "setViewport", "screenshot"];
    }
    case "cdp": {
      return ["send"];
    }
  }
};

const validateRequiredMethod = (
  page: unknown,
  kind: ResolvedBrowserPageCaptureAdapterKind,
  method: string,
  pageName?: string
): Effect.Effect<void, BrowserCaptureReadinessError> => {
  if (kind === "cdp" && method === "send") {
    return cdpSendReference(page) === undefined
      ? Effect.fail(requiredMethodError(kind, method, pageName))
      : Effect.void;
  }

  return hasMethod(page, method)
    ? Effect.void
    : Effect.fail(requiredMethodError(kind, method, pageName));
};

const setViewport = (
  page: unknown,
  kind: ResolvedBrowserPageCaptureAdapterKind,
  options: BrowserCaptureOpenOptions
): Effect.Effect<void, LiveStreakError> => {
  if (kind === "playwright") {
    return callBrowserMethod(methodReference(page, "setViewportSize")!, kind, [
      options.viewport
    ]).pipe(Effect.asVoid);
  }

  if (kind === "puppeteer") {
    return callBrowserMethod(methodReference(page, "setViewport")!, kind, [
      options.viewport
    ]).pipe(Effect.asVoid);
  }

  return callBrowserMethod(cdpSendReference(page)!, kind, [
    "Emulation.setDeviceMetricsOverride",
    {
      width: options.viewport.width,
      height: options.viewport.height,
      deviceScaleFactor: 1,
      mobile: false
    }
  ]).pipe(Effect.asVoid);
};

const navigate = (
  page: unknown,
  kind: ResolvedBrowserPageCaptureAdapterKind,
  options: BrowserCaptureOpenOptions
): Effect.Effect<void, LiveStreakError> => {
  if (kind === "cdp") {
    return callBrowserMethod(cdpSendReference(page)!, kind, [
      "Page.navigate",
      { url: options.url }
    ]).pipe(Effect.asVoid);
  }

  return callBrowserMethod(methodReference(page, "goto")!, kind, [options.url]).pipe(Effect.asVoid);
};

const screenshotClip = (crop: BrowserCaptureCrop | undefined): BrowserCaptureCrop | undefined =>
  crop === undefined
    ? undefined
    : {
        x: crop.x,
        y: crop.y,
        width: crop.width,
        height: crop.height
      };

const bytesFromBase64 = (data: string): Uint8Array => {
  const binary = globalThis.atob(data);
  const output = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    output[index] = binary.codePointAt(index) ?? 0;
  }

  return output;
};

const bytesFromUnknown = (
  data: unknown,
  kind: ResolvedBrowserPageCaptureAdapterKind
): Effect.Effect<Uint8Array, BrowserCaptureBridgeError> => {
  if (data instanceof Uint8Array) {
    return Effect.succeed(data);
  }
  if (data instanceof ArrayBuffer) {
    return Effect.succeed(new Uint8Array(data));
  }
  if (ArrayBuffer.isView(data)) {
    return Effect.succeed(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }
  if (typeof data === "string") {
    return Effect.try({
      try: () => bytesFromBase64(data),
      catch: (cause) =>
        bridgeError({
          code: "unsupported-screenshot-result",
          kind,
          method: "screenshot",
          message: "Browser capture screenshot returned unsupported data",
          cause
        })
    });
  }

  return Effect.fail(
    bridgeError({
      code: "unsupported-screenshot-result",
      kind,
      method: "screenshot",
      message: "Browser capture screenshot returned unsupported data",
      cause: data
    })
  );
};

const browserPageScreenshot = (
  page: unknown,
  kind: ResolvedBrowserPageCaptureAdapterKind,
  options: BrowserCaptureScreenshotOptions
): Effect.Effect<BrowserCaptureScreenshot, LiveStreakError> =>
  Effect.gen(function* () {
    if (kind === "cdp") {
      const clip = screenshotClip(options.crop);
      const response = yield* callBrowserMethod<unknown>(cdpSendReference(page)!, kind, [
        "Page.captureScreenshot",
        {
          format: options.encoding,
          ...(clip === undefined ? {} : { clip: { ...clip, scale: 1 } })
        }
      ]);

      if (!isRecord(response) || typeof response.data !== "string") {
        return yield* Effect.fail(
          bridgeError({
            code: "unsupported-screenshot-result",
            kind,
            method: "Page.captureScreenshot",
            message: "Browser capture CDP screenshot returned unsupported data",
            cause: response
          })
        );
      }

      return {
        data: yield* bytesFromUnknown(response.data, kind),
        encoding: options.encoding
      };
    }

    const screenshot = yield* callBrowserMethod<unknown>(
      methodReference(page, "screenshot")!,
      kind,
      [
        {
          type: options.encoding,
          ...(options.crop === undefined ? {} : { clip: screenshotClip(options.crop) })
        }
      ]
    );

    return {
      data: yield* bytesFromUnknown(screenshot, kind),
      encoding: options.encoding
    };
  });

const browserPageInspectTargets = (
  page: unknown,
  kind: ResolvedBrowserPageCaptureAdapterKind,
  viewport: BrowserCaptureOpenOptions["viewport"]
): (() => Effect.Effect<readonly BrowserCaptureTarget[], LiveStreakError>) | undefined => {
  if (kind === "cdp") {
    const send = cdpSendReference(page);
    if (send === undefined) {
      return undefined;
    }

    return () =>
      Effect.gen(function* () {
        const response = yield* callBrowserMethod<{ readonly result?: { readonly value?: unknown } }>(
          send,
          kind,
          [
            "Runtime.evaluate",
            {
              expression: browserTargetDetectionScript,
              returnByValue: true
            }
          ]
        );

        const candidates = parseDetectedBrowserTargetCandidates(response.result?.value);
        return normalizeDetectedBrowserTargets(candidates, viewport);
      });
  }

  const evaluate = methodReference(page, "evaluate");
  if (evaluate === undefined) {
    return undefined;
  }

  return () =>
    Effect.gen(function* () {
      const value = yield* callBrowserMethod<unknown>(evaluate, kind, [browserTargetDetectionScript]);
      const candidates = parseDetectedBrowserTargetCandidates(value);
      return normalizeDetectedBrowserTargets(candidates, viewport);
    });
};

const closeBrowserPage = (
  page: unknown,
  kind: ResolvedBrowserPageCaptureAdapterKind,
  closePage: boolean
): Effect.Effect<void, LiveStreakError> => {
  const close = methodReference(page, "close");
  if (!closePage || close === undefined) {
    return Effect.void;
  }

  return callBrowserMethod(close, kind).pipe(Effect.asVoid);
};

const browserPageToCapturePage = (
  page: unknown,
  readiness: BrowserCapturePageReadiness,
  closePage: boolean,
  viewport: BrowserCaptureOpenOptions["viewport"]
): BrowserCapturePage => ({
  screenshot: (options) => browserPageScreenshot(page, readiness.kind, options),
  inspectTargets: browserPageInspectTargets(page, readiness.kind, viewport),
  close: closeBrowserPage(page, readiness.kind, closePage)
});

const openBrowserCapturePage = (
  page: unknown,
  openOptions: BrowserCaptureOpenOptions,
  adapterOptions: BrowserPageCaptureAdapterOptions
): Effect.Effect<BrowserCapturePage, LiveStreakError> =>
  Effect.gen(function* () {
    const readiness = yield* validateBrowserCapturePageReadiness(page, adapterOptions);
    yield* setViewport(page, readiness.kind, openOptions);
    yield* navigate(page, readiness.kind, openOptions);

    return browserPageToCapturePage(
      page,
      readiness,
      adapterOptions.closePage ?? false,
      openOptions.viewport
    );
  });
