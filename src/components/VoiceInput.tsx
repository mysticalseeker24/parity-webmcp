import { useCallback, useEffect, useRef, useState } from "react";
import { requestPalette } from "../lib/paletteBridge";
import { getRegistry } from "../lib/registry";
import { matchTranscript, toCandidate, type VoiceMatch } from "../lib/voiceMatch";

/**
 * Speak a command.
 *
 * **Voice never executes.** A recognised phrase opens the command palette with
 * the form pre-filled and waits for confirmation. Speech recognition mishears;
 * an interface that acted on a mishearing would be worse than no voice at all,
 * and this app's destructive actions are gated anyway. So the win here is
 * *reaching the right form without typing*, which is the part that is hard for
 * someone with a motor impairment — not skipping the confirmation.
 *
 * The Web Speech API is Chrome-only, so the button is feature-detected and the
 * limitation is stated in the UI rather than left to be discovered. Every
 * capability reachable by voice is reachable by keyboard: this control is an
 * addition to `⌘K`, never a replacement for it (CONVENTIONS.md §6).
 */

interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type RecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as {
    webkitSpeechRecognition?: RecognitionCtor;
    SpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function VoiceInput() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState("");
  const recognition = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    setSupported(getRecognitionCtor() !== null);
    return () => recognition.current?.stop();
  }, []);

  const handleTranscript = useCallback((transcript: string) => {
    const live = getRegistry()?.getLiveTools() ?? [];
    const match: VoiceMatch | null = matchTranscript(transcript, live.map(toCandidate));

    if (!match) {
      setStatus(`Heard “${transcript}”, but that did not match an available command.`);
      return;
    }

    const filled = Object.keys(match.values).length;
    setStatus(
      `Heard “${transcript}”. Opening ${match.tool.humanLabel}${
        filled > 0 ? ` with ${filled} field${filled === 1 ? "" : "s"} filled in` : ""
      }. Check it and press Run.`,
    );
    // Opens a form. Does not run anything.
    requestPalette({ tool: match.tool.name, values: match.values, heardAs: transcript });
  }, []);

  function start() {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;

    const rec = new Ctor();
    recognition.current = rec;
    rec.lang = navigator.language || "en-US";
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    rec.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript ?? "";
      handleTranscript(transcript);
    };
    rec.onerror = (event) => {
      setStatus(
        event.error === "not-allowed"
          ? "Microphone permission was refused. Use the Commands button instead — it does everything voice does."
          : `Speech recognition failed (${event.error}). Use the Commands button instead.`,
      );
      setListening(false);
    };
    rec.onend = () => setListening(false);

    setStatus("Listening…");
    setListening(true);
    rec.start();
  }

  function stop() {
    recognition.current?.stop();
    setListening(false);
    setStatus("Stopped listening.");
  }

  // Feature detection, not a broken button. Say why rather than hiding it.
  if (supported === false) {
    return (
      <p className="font-display text-xs uppercase tracking-wider text-ink-soft" data-testid="voice-unsupported">
        <span aria-hidden="true">🎙 </span>
        Voice needs Chrome
      </p>
    );
  }
  if (supported === null) return null;

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={listening ? stop : start}
        aria-pressed={listening}
        data-testid="voice-button"
        className={`border-[1.5px] border-ink px-3 py-1.5 font-display text-xs font-bold uppercase tracking-wider ${
          listening ? "bg-ink text-stock" : "bg-stock text-ink hover:bg-stock-deep"
        }`}
      >
        <span aria-hidden="true">🎙 </span>
        {listening ? "Listening…" : "Speak"}
      </button>

      {/* Polite: it reports what was heard, and never interrupts. */}
      <p role="status" aria-live="polite" className="sr-only" data-testid="voice-status">
        {status}
      </p>
    </div>
  );
}
