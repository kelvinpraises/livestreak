// --- exports ---

export interface MediaProviderBindRequest {
  readonly sessionId: string;
  readonly contentId: string;
  readonly observer: string;
}

export type MediaProviderBindResult =
  | { readonly ok: true; readonly watchUrl: string; readonly webrtcUrl: string }
  | { readonly ok: false; readonly status: number; readonly error: string };

export interface MediaProvider {
  readonly bind: (request: MediaProviderBindRequest) => Promise<MediaProviderBindResult>;
}
