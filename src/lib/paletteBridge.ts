/**
 * A one-way channel for opening the command palette pre-filled.
 *
 * Voice uses it, and nothing else does yet. It carries a *request to open a
 * form*, never a request to execute: the palette still renders the arguments
 * and waits for the user to confirm. That separation is the whole safety story
 * for voice — a misheard phrase can only ever open the wrong form, which is
 * visible and dismissible, rather than run the wrong tool.
 */

export interface PaletteRequest {
  readonly tool: string;
  readonly values: Readonly<Record<string, string | string[]>>;
  /** Shown above the form, so the user can see what was heard. */
  readonly heardAs?: string;
}

type Listener = (request: PaletteRequest) => void;

const listeners = new Set<Listener>();

export function onPaletteRequest(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function requestPalette(request: PaletteRequest): void {
  for (const listener of listeners) listener(request);
}
