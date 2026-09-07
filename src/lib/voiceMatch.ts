import type { AnyDefinedTool } from "./defineTool";
import { fieldsFromSchema, type FormField } from "./schemaForm";
import type { JsonSchema } from "./webmcpInterop";

/**
 * Matching a spoken phrase to a tool.
 *
 * The grammar is not hand-written. It is assembled from what each tool already
 * declares — `voiceAliases`, the human label, the tool name, and the **enum
 * values in its own schema**. So a new tool becomes speakable the moment it is
 * defined, and a vocabulary can never drift from the schema that validates it
 * (the same single-source rule as the palette's labels, spec issue #286).
 *
 * Pure functions on purpose: speech recognition is untestable in jsdom, so all
 * the logic that can be tested lives here, and the component is a thin shell
 * around `webkitSpeechRecognition`.
 */

export interface VoiceCandidate {
  readonly name: string;
  readonly humanLabel: string;
  readonly voiceAliases: readonly string[];
  readonly fields: readonly FormField[];
}

export interface VoiceMatch {
  readonly tool: VoiceCandidate;
  /** Enum values recognised in the phrase, keyed by field name. */
  readonly values: Readonly<Record<string, string | string[]>>;
  /** Which phrase matched, so the UI can show why. */
  readonly matchedOn: string;
  readonly score: number;
}

export function toCandidate(tool: AnyDefinedTool): VoiceCandidate {
  return {
    name: tool.name,
    humanLabel: tool.spec.humanLabel,
    voiceAliases: tool.spec.voiceAliases ?? [],
    fields: fieldsFromSchema(tool.inputSchema as JsonSchema),
  };
}

/** Lowercase, strip punctuation, collapse whitespace. */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "wheelchair_accessible" → "wheelchair accessible" */
function speakable(value: string): string {
  return normalise(value.replace(/[_-]+/g, " "));
}

function containsPhrase(haystack: string, phrase: string): boolean {
  const needle = normalise(phrase);
  if (needle === "") return false;
  // Word-boundary containment, so "book" does not match "booking".
  return new RegExp(`(?:^|\\s)${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`).test(
    haystack,
  );
}

/**
 * Enum values from the tool's own schema that appear in the phrase. This is
 * what lets "find a neurologist who is wheelchair accessible" pre-fill both the
 * specialty and the accommodation without any bespoke grammar.
 */
export function extractEnumValues(
  phrase: string,
  fields: readonly FormField[],
): Record<string, string | string[]> {
  const said = normalise(phrase);
  const values: Record<string, string | string[]> = {};

  for (const field of fields) {
    if (field.options.length === 0) continue;
    const hits = field.options.filter((option) => containsPhrase(said, speakable(option)));
    if (hits.length === 0) continue;
    if (field.kind === "checkboxGroup") values[field.name] = hits;
    else values[field.name] = hits[0]!;
  }
  return values;
}

/**
 * Best tool for a phrase, or null.
 *
 * Scoring, most to least trusted: an explicit alias, then the human label, then
 * the tool name spoken aloud, then enum values alone. Longer matches win, so
 * "release the slot" beats a bare "slot".
 */
export function matchTranscript(
  transcript: string,
  tools: readonly VoiceCandidate[],
): VoiceMatch | null {
  const said = normalise(transcript);
  if (said === "") return null;

  let best: VoiceMatch | null = null;

  for (const tool of tools) {
    const phrases: { phrase: string; weight: number }[] = [
      ...tool.voiceAliases.map((phrase) => ({ phrase, weight: 100 })),
      { phrase: tool.humanLabel, weight: 80 },
      { phrase: speakable(tool.name), weight: 60 },
    ];

    let score = 0;
    let matchedOn = "";
    for (const { phrase, weight } of phrases) {
      if (!containsPhrase(said, phrase)) continue;
      // Longer phrases are more specific; break ties toward them.
      const candidate = weight + normalise(phrase).length;
      if (candidate > score) {
        score = candidate;
        matchedOn = phrase;
      }
    }

    const values = extractEnumValues(said, tool.fields);
    // Enum values alone can identify a tool, but weakly — only when nothing
    // matched by name. "wheelchair accessible" implies find_providers.
    if (score === 0 && Object.keys(values).length > 0) {
      score = 10 + Object.keys(values).length;
      matchedOn = Object.values(values).flat().join(", ");
    }

    if (score > 0 && (best === null || score > best.score)) {
      best = { tool, values, matchedOn, score };
    }
  }

  return best;
}

/** Everything the user could say right now, for the on-screen hint. */
export function spokenExamples(tools: readonly VoiceCandidate[], limit = 4): string[] {
  const examples: string[] = [];
  for (const tool of tools) {
    const alias = tool.voiceAliases[0];
    if (alias) examples.push(alias);
    if (examples.length >= limit) break;
  }
  return examples;
}
