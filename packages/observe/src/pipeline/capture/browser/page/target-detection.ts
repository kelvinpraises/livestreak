import type { BrowserCaptureCrop, BrowserCaptureViewport } from "./types.js";
import type { BrowserCaptureTarget, BrowserCaptureTargetKind } from "#pipeline/capture/browser/control/preview.js";

export const browserTargetDetectionMaxTargets = 8;
export const browserTargetDetectionMinSize = 48;

export interface DetectedBrowserTargetCandidate {
  readonly kind: BrowserCaptureTargetKind;
  readonly label?: string;
  readonly rect: BrowserCaptureCrop;
  readonly score: number;
}

export const browserTargetDetectionScript = String.raw`
(() => {
  const minSize = ${browserTargetDetectionMinSize};
  const isVisible = (element) => {
    if (!(element instanceof Element)) return false;
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width < minSize || rect.height < minSize) return false;
    return rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
  };
  const rectFor = (element) => {
    const rect = element.getBoundingClientRect();
    return {
      x: Math.max(0, Math.round(rect.x)),
      y: Math.max(0, Math.round(rect.y)),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
  };
  const labelFor = (element, fallback) => {
    const aria = element.getAttribute("aria-label");
    if (aria && aria.trim().length > 0) return aria.trim();
    const title = element.getAttribute("title");
    if (title && title.trim().length > 0) return title.trim();
    if (element.id) return element.id;
    if (element.className && typeof element.className === "string" && element.className.trim().length > 0) {
      return element.className.trim().split(/\s+/).slice(0, 2).join(".");
    }
    return fallback;
  };
  const pushCandidate = (output, element, kind, priority, fallbackLabel) => {
    if (!isVisible(element)) return;
    const rect = rectFor(element);
    if (rect.width < minSize || rect.height < minSize) return;
    const area = rect.width * rect.height;
    output.push({
      kind,
      label: labelFor(element, fallbackLabel),
      rect,
      score: priority + area / (window.innerWidth * window.innerHeight)
    });
  };
  const output = [];
  const videos = document.querySelectorAll("video");
  for (let index = 0; index < videos.length; index += 1) {
    pushCandidate(output, videos[index], "video", 400, "video " + (index + 1));
  }
  const canvases = document.querySelectorAll("canvas");
  for (let index = 0; index < canvases.length; index += 1) {
    pushCandidate(output, canvases[index], "canvas", 300, "canvas " + (index + 1));
  }
  const iframes = document.querySelectorAll("iframe");
  for (let index = 0; index < iframes.length; index += 1) {
    pushCandidate(output, iframes[index], "iframe", 200, "iframe " + (index + 1));
  }
  const candidates = document.querySelectorAll("[data-player], [role='video'], .player, .video-player, #player");
  for (let index = 0; index < candidates.length; index += 1) {
    pushCandidate(output, candidates[index], "element", 100, "player " + (index + 1));
  }
  return output;
})()
`;

export const normalizeDetectedBrowserTargets = (
  candidates: readonly DetectedBrowserTargetCandidate[],
  viewport: BrowserCaptureViewport
): readonly BrowserCaptureTarget[] => {
  const viewportArea = viewport.width * viewport.height;
  const clipped: DetectedBrowserTargetCandidate[] = [];

  for (const candidate of candidates) {
    const x = Math.max(0, candidate.rect.x);
    const y = Math.max(0, candidate.rect.y);
    const width = Math.min(viewport.width, candidate.rect.x + candidate.rect.width) - x;
    const height = Math.min(viewport.height, candidate.rect.y + candidate.rect.height) - y;

    if (
      width < browserTargetDetectionMinSize ||
      height < browserTargetDetectionMinSize
    ) {
      continue;
    }

    clipped.push({
      ...candidate,
      rect: { x, y, width, height }
    });
  }

  // toSorted is unavailable under the package TS lib target; copy before sort.
   
  const sorted = [...clipped].sort((left, right) => right.score - left.score);
  const limited = sorted.slice(0, browserTargetDetectionMaxTargets);

  const kindCounts: Partial<Record<BrowserCaptureTargetKind, number>> = {};

  return limited.map((candidate, index) => {
    const kindCount = (kindCounts[candidate.kind] ?? 0) + 1;
    kindCounts[candidate.kind] = kindCount;
    const fallbackLabel = `${candidate.kind} ${kindCount}`;
    const label =
      candidate.label !== undefined && candidate.label.trim().length > 0
        ? candidate.label.trim()
        : fallbackLabel;
    const areaRatio =
      viewportArea > 0 ? (candidate.rect.width * candidate.rect.height) / viewportArea : undefined;

    return {
      id: `${candidate.kind}:${index}`,
      number: index + 1,
      kind: candidate.kind,
      label,
      rect: { ...candidate.rect },
      confidence: areaRatio === undefined ? undefined : Number(areaRatio.toFixed(4))
    };
  });
};

export const parseDetectedBrowserTargetCandidates = (
  value: unknown
): readonly DetectedBrowserTargetCandidate[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const candidates: DetectedBrowserTargetCandidate[] = [];

  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }

    const candidate = entry as Partial<DetectedBrowserTargetCandidate> & {
      readonly rect?: Partial<BrowserCaptureCrop>;
    };

    if (
      candidate.kind !== "video" &&
      candidate.kind !== "canvas" &&
      candidate.kind !== "iframe" &&
      candidate.kind !== "element"
    ) {
      continue;
    }

    if (candidate.rect === undefined) {
      continue;
    }

    if (
      typeof candidate.rect.x !== "number" ||
      typeof candidate.rect.y !== "number" ||
      typeof candidate.rect.width !== "number" ||
      typeof candidate.rect.height !== "number"
    ) {
      continue;
    }

    candidates.push({
      kind: candidate.kind,
      label: typeof candidate.label === "string" ? candidate.label : undefined,
      rect: {
        x: candidate.rect.x,
        y: candidate.rect.y,
        width: candidate.rect.width,
        height: candidate.rect.height
      },
      score: typeof candidate.score === "number" ? candidate.score : 0
    });
  }

  return candidates;
};
