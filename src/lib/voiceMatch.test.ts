import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  extractEnumValues,
  matchTranscript,
  normalise,
  spokenExamples,
  toCandidate,
  type VoiceCandidate,
} from "./voiceMatch";
import { startRegistry, type Registry } from "./registry";
import { clearHoldTimer } from "./timers";
import { resetGrants } from "./grants";
import { bookingStore } from "../store";
import { installMockModelContext } from "../test/webmcpMock";
import { TOOLS } from "../tools";

let restore: (() => void) | null = null;
let registry: Registry | null = null;

const store = () => bookingStore.getState();
const liveCandidates = (): VoiceCandidate[] =>
  (registry?.getLiveTools() ?? []).map(toCandidate);

beforeEach(() => {
  clearHoldTimer();
  resetGrants();
  bookingStore.getState().reset();
  ({ restore } = installMockModelContext(true));
  registry = startRegistry(TOOLS);
});

afterEach(() => {
  registry?.stop();
  registry = null;
  clearHoldTimer();
  resetGrants();
  restore?.();
  restore = null;
});

describe("normalise", () => {
  it("lowercases, strips punctuation and collapses whitespace", () => {
    expect(normalise("  Find a DOCTOR, please! ")).toBe("find a doctor please");
  });
});

describe("matching on what the tools already declare", () => {
  it("matches an explicit voiceAlias", () => {
    const match = matchTranscript("find a doctor", liveCandidates());
    expect(match?.tool.name).toBe("find_providers");
    expect(match?.matchedOn).toBe("find a doctor");
  });

  it("matches the human label", () => {
    // check_coverage is live once a search has run.
    store().recordSearch({
      specialty: "neurology",
      accommodations: [],
      result_ids: ["p01"],
      total_matches: 3,
      eliminated_by: {},
    });
    expect(matchTranscript("check insurance coverage", liveCandidates())?.tool.name).toBe(
      "check_coverage",
    );
  });

  it("matches the tool name spoken with spaces instead of underscores", () => {
    expect(matchTranscript("run list accommodations now", liveCandidates())?.tool.name).toBe(
      "list_accommodations",
    );
  });

  it("requires whole words, so a substring does not match", () => {
    // "book" must not match via "booking status" inside another word.
    expect(matchTranscript("bookish", liveCandidates())).toBeNull();
  });

  it("returns null for a phrase that matches nothing", () => {
    expect(matchTranscript("what is the weather", liveCandidates())).toBeNull();
  });

  it("returns null for an empty transcript", () => {
    expect(matchTranscript("   ", liveCandidates())).toBeNull();
  });

  it("prefers the longer, more specific phrase when two tools could match", () => {
    // Both find_providers and select_provider mention providers.
    const match = matchTranscript("select provider", liveCandidates());
    expect(match?.tool.name).toBe("select_provider");
  });
});

describe("enum values are read out of each tool's own schema", () => {
  it("pulls the specialty out of a natural phrase", () => {
    const match = matchTranscript("find a doctor for neurology", liveCandidates());
    expect(match?.tool.name).toBe("find_providers");
    expect(match?.values["specialty"]).toBe("neurology");
  });

  it("turns underscored enum members into speakable words", () => {
    const match = matchTranscript(
      "find a doctor for physiotherapy who is wheelchair accessible",
      liveCandidates(),
    );
    expect(match?.values).toMatchObject({
      specialty: "physiotherapy",
      accommodations: ["wheelchair_accessible"],
    });
  });

  it("collects several members for an array field", () => {
    const fields = toCandidate(
      registry!.getLiveTools().find((t) => t.name === "find_providers")!,
    ).fields;
    expect(
      extractEnumValues("wheelchair accessible and asl interpreter and low sensory", fields),
    ).toEqual({
      accommodations: ["wheelchair_accessible", "asl_interpreter", "low_sensory"],
    });
  });

  it("takes a single value for a select field", () => {
    const fields = toCandidate(
      registry!.getLiveTools().find((t) => t.name === "find_providers")!,
    ).fields;
    const values = extractEnumValues("audiology", fields);
    expect(values["specialty"]).toBe("audiology");
    expect(Array.isArray(values["specialty"])).toBe(false);
  });

  it("identifies a tool from enum values alone when nothing matched by name", () => {
    const match = matchTranscript("rheumatology", liveCandidates());
    expect(match?.tool.name).toBe("find_providers");
    expect(match?.values["specialty"]).toBe("rheumatology");
  });

  it("finds nothing when the phrase has no enum members", () => {
    const fields = toCandidate(
      registry!.getLiveTools().find((t) => t.name === "find_providers")!,
    ).fields;
    expect(extractEnumValues("something else entirely", fields)).toEqual({});
  });
});

describe("the grammar follows the live set", () => {
  it("only ever matches a tool that is registered right now", () => {
    // hold_slot is not live while browsing, so its alias must not resolve.
    expect(matchTranscript("hold it", liveCandidates())).toBeNull();

    store().selectProvider("p01");
    store().markAvailabilityFetched();

    expect(matchTranscript("hold it", liveCandidates())?.tool.name).toBe("hold_slot");
  });

  it("stops matching a tool once it unregisters", () => {
    store().selectProvider("p01");
    store().markAvailabilityFetched();
    expect(matchTranscript("reserve that slot", liveCandidates())?.tool.name).toBe("hold_slot");

    store().confirmBooking({
      id: "b1",
      slotId: "s1",
      providerId: "p01",
      confirmedAt: 0,
      intake: {},
    });
    expect(matchTranscript("reserve that slot", liveCandidates())).toBeNull();
  });

  it("offers examples drawn from the live tools, not a fixed list", () => {
    const examples = spokenExamples(liveCandidates());
    expect(examples.length).toBeGreaterThan(0);
    for (const example of examples) {
      expect(matchTranscript(example, liveCandidates())).not.toBeNull();
    }
  });
});

describe("every tool carrying aliases is reachable by voice", () => {
  it("resolves each alias to the tool that declared it, when live", () => {
    for (const tool of TOOLS) {
      const aliases = tool.spec.voiceAliases ?? [];
      if (aliases.length === 0) continue;
      // Match against that tool alone: the live-set gating is covered above.
      const only = [toCandidate(tool)];
      for (const alias of aliases) {
        expect(matchTranscript(alias, only)?.tool.name, `${tool.name}: "${alias}"`).toBe(tool.name);
      }
    }
  });
});
