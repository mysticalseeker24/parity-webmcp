import { useEffect, useState } from "react";
import { startAnnouncer } from "../lib/announcer";

/**
 * The announcement surface. Two regions, per CONVENTIONS.md §6: one polite for
 * ordinary tool results, one assertive for errors and authorization requests.
 *
 * Both are mounted empty and stay mounted — a live region inserted at the same
 * moment as its text is frequently missed by screen readers.
 *
 * The text comes from `lib/announcer.ts`, which reads the store. Nothing
 * announces from a call site, so the wording cannot drift from the tool that
 * produced it.
 */
export function LiveRegion() {
  const [polite, setPolite] = useState("");
  const [assertive, setAssertive] = useState("");

  useEffect(() => {
    return startAnnouncer((announcement) => {
      const set = announcement.politeness === "assertive" ? setAssertive : setPolite;
      // Re-announce an identical sentence by clearing first; otherwise a
      // repeated action (holding the same slot twice) is silent.
      set("");
      requestAnimationFrame(() => set(announcement.text));
    });
  }, []);

  return (
    <>
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        data-testid="live-polite"
      >
        {polite}
      </div>
      <div
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
        data-testid="live-assertive"
      >
        {assertive}
      </div>
    </>
  );
}

/**
 * The same announcements, on screen. Screen-reader users hear them; everyone
 * else should be able to see that the agent just changed something too.
 */
export function AnnouncementLog() {
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    return startAnnouncer((announcement) => {
      setLines((prev) => [announcement.text, ...prev].slice(0, 8));
    });
  }, []);

  if (lines.length === 0) {
    return <p className="text-sm text-ink-soft">Nothing has happened yet.</p>;
  }

  return (
    <ol className="flex flex-col gap-1 text-sm text-ink" data-testid="announcement-log">
      {lines.map((line, index) => (
        <li key={`${index}-${line}`}>{line}</li>
      ))}
    </ol>
  );
}
