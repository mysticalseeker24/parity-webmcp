import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { executeAsHuman, getRegistry } from "../lib/registry";
import { isRefusal, type ToolResult } from "../lib/result";
import { onPaletteRequest, type PaletteRequest } from "../lib/paletteBridge";
import { fieldsFromSchema, valuesToArgs, type FormField } from "../lib/schemaForm";
import { readInputSchema, type JsonSchema } from "../lib/webmcpInterop";
import type { ToolGroup } from "../lib/defineTool";

/**
 * The command palette — the human caller of the tool registry.
 *
 * **Source of truth.** When `document.modelContext` exists the palette calls
 * `getTools()` to learn which tools are live and reads each `inputSchema`
 * through `readInputSchema()` (Chrome hands it back as a JSON string — see
 * `.agent/PHASE1_FINDINGS.md`). It joins by name with the local registry *only*
 * for presentation metadata: group and human label. A tool the local map has
 * never heard of still renders, from its schema alone — otherwise this would be
 * a second command list in disguise and the thesis would be false.
 *
 * The local registry is the fallback for a browser without WebMCP.
 */

const GROUP_ORDER: readonly ToolGroup[] = [
  "orient",
  "search",
  "schedule",
  "intake",
  "commit",
  "manage",
];

const GROUP_LABELS: Record<string, string> = {
  orient: "Orientation",
  search: "Find a provider",
  schedule: "Scheduling",
  intake: "Patient details",
  commit: "Confirm",
  manage: "Manage booking",
  other: "Other tools",
};

interface PaletteTool {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly group: string;
  readonly schema: JsonSchema;
  readonly fields: readonly FormField[];
  /** False when getTools() offered a tool the local map does not know. */
  readonly known: boolean;
}

/** Read the live set from the browser, falling back to the local registry. */
function useLiveTools(open: boolean): { tools: PaletteTool[]; viaBrowser: boolean } {
  const [tools, setTools] = useState<PaletteTool[]>([]);
  const [viaBrowser, setViaBrowser] = useState(false);

  const refresh = useCallback(async () => {
    const registry = getRegistry();
    const mc = document.modelContext;

    if (typeof mc?.getTools === "function") {
      const registered = await mc.getTools();
      setViaBrowser(true);
      setTools(
        registered.map((tool) => {
          const local = registry?.getTool(tool.name);
          let schema: JsonSchema = {};
          try {
            schema = readInputSchema(tool);
          } catch {
            schema = {};
          }
          return {
            name: tool.name,
            label: local?.spec.humanLabel ?? tool.title ?? tool.name,
            description: tool.description,
            group: local?.group ?? "other",
            schema,
            fields: fieldsFromSchema(schema),
            known: local !== undefined,
          };
        }),
      );
      return;
    }

    setViaBrowser(false);
    setTools(
      (registry?.getLiveTools() ?? []).map((tool) => {
        const schema = tool.inputSchema as JsonSchema;
        return {
          name: tool.name,
          label: tool.spec.humanLabel,
          description: tool.spec.description,
          group: tool.group,
          schema,
          fields: fieldsFromSchema(schema),
          known: true,
        };
      }),
    );
  }, []);

  useEffect(() => {
    if (!open) return;
    void refresh();
    const mc = document.modelContext;
    // The agent's view and the palette's move from the same event.
    mc?.addEventListener("toolchange", refresh);
    return () => mc?.removeEventListener("toolchange", refresh);
  }, [open, refresh]);

  return { tools, viaBrowser };
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [selected, setSelected] = useState<PaletteTool | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [result, setResult] = useState<ToolResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [heardAs, setHeardAs] = useState<string | null>(null);
  const [pending, setPending] = useState<PaletteRequest | null>(null);

  const { tools, viaBrowser } = useLiveTools(open || pending !== null);
  const inputRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const runButtonRef = useRef<HTMLButtonElement>(null);
  // The window-level Escape handler is registered once, so it reads current
  // state through refs rather than closing over the first render's values.
  const openRef = useRef(false);
  const selectedRef = useRef<PaletteTool | null>(null);
  const closeRef = useRef<() => void>(() => {});
  const refocusAfterRun = useRef(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openerRef.current = document.activeElement as HTMLElement;
        setOpen((wasOpen) => !wasOpen);
        return;
      }
      // Escape is handled at the window while the palette is open, not only on
      // the elements inside it. Focus can legitimately be outside the dialog —
      // a control that becomes disabled hands focus back to <body> — and Escape
      // must still close rather than appearing dead.
      if (event.key === "Escape" && openRef.current) {
        event.preventDefault();
        if (selectedRef.current) {
          setSelected(null);
          setHeardAs(null);
          setResult(null);
          requestAnimationFrame(() => inputRef.current?.focus());
        } else {
          closeRef.current();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (open && !selected) inputRef.current?.focus();
  }, [open, selected]);

  /**
   * Put focus back on Run once it is enabled again.
   *
   * Disabling a focused button hands focus to `<body>`, which leaves a keyboard
   * user with nothing selected and no obvious way back. Restoring it has to
   * happen after the re-render that clears `busy`, or the element is still
   * disabled and `focus()` is a no-op.
   */
  useEffect(() => {
    if (busy || !refocusAfterRun.current) return;
    refocusAfterRun.current = false;
    runButtonRef.current?.focus();
  }, [busy, result]);

  // Voice asks for a form to be opened, pre-filled. It never asks for a tool to
  // be run — the user still presses Run (see lib/paletteBridge.ts).
  useEffect(() => onPaletteRequest(setPending), []);

  useEffect(() => {
    if (!pending) return;
    const tool = tools.find((t) => t.name === pending.tool);
    // Wait for the live set to arrive rather than dropping the request.
    if (!tool) return;

    openerRef.current = document.activeElement as HTMLElement;
    setOpen(true);
    setResult(null);
    setHeardAs(pending.heardAs ?? null);
    setSelected(tool);

    const initial: Record<string, unknown> = {};
    for (const field of tool.fields) if (field.kind === "checkboxGroup") initial[field.name] = [];
    setValues({ ...initial, ...pending.values });
    setPending(null);
  }, [pending, tools]);

  openRef.current = open;
  selectedRef.current = selected;
  const searching = query.trim() !== "";

  const matches = useMemo(() => {
    const groupRank = (tool: PaletteTool) => {
      const i = GROUP_ORDER.indexOf(tool.group as ToolGroup);
      return i === -1 ? 99 : i;
    };

    // No query: workflow order, so the palette reads as the shape of the task
    // (#255).
    const q = query.trim().toLowerCase();
    if (q === "") {
      return [...tools].sort(
        (a, b) => groupRank(a) - groupRank(b) || a.label.localeCompare(b.label),
      );
    }

    /**
     * With a query, relevance has to beat workflow order. Typing "find" used to
     * surface `list_accommodations` first — it matches only because its
     * description mentions `find_providers`, and it sorted first because its
     * group is "orient". Pressing Enter then opened the wrong tool.
     */
    const score = (tool: PaletteTool) => {
      const name = tool.name.toLowerCase();
      const label = tool.label.toLowerCase();
      if (name === q || label === q) return 1000;
      if (name.startsWith(q)) return 900;
      if (label.startsWith(q)) return 800;
      // A word inside the name, e.g. "providers" matching find_providers.
      if (name.split(/[_\s]+/).some((word) => word.startsWith(q))) return 700;
      if (label.split(/\s+/).some((word) => word.startsWith(q))) return 600;
      if (name.includes(q)) return 500;
      if (label.includes(q)) return 400;
      if (tool.description.toLowerCase().includes(q)) return 100;
      return 0;
    };

    return tools
      .map((tool) => ({ tool, score: score(tool) }))
      .filter((entry) => entry.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          groupRank(a.tool) - groupRank(b.tool) ||
          a.tool.label.localeCompare(b.tool.label),
      )
      .map((entry) => entry.tool);
  }, [tools, query]);

  useEffect(() => setActiveIndex(0), [query, tools.length]);

  function close() {
    setOpen(false);
    setSelected(null);
    setValues({});
    setResult(null);
    setQuery("");
    setHeardAs(null);
    // Restore focus to whatever opened it — never drop focus to <body>.
    openerRef.current?.focus();
  }
  closeRef.current = close;

  function choose(tool: PaletteTool) {
    setSelected(tool);
    setResult(null);
    setHeardAs(null);
    const initial: Record<string, unknown> = {};
    for (const field of tool.fields) if (field.kind === "checkboxGroup") initial[field.name] = [];
    setValues(initial);
  }

  async function run(tool: PaletteTool) {
    setBusy(true);
    try {
      // The same path the agent takes: setNextActor("human") then executeTool()
      // with a JSON string, then parseToolResult(). See registry.executeAsHuman.
      setResult(await executeAsHuman(tool.name, valuesToArgs(tool.fields, values)));
    } catch (error) {
      // A thrown error must never leave the button stuck disabled. A disabled
      // control also drops focus to <body>, which is how a failed run used to
      // take Escape down with it.
      setResult({
        ok: false,
        kind: "refused",
        reason: error instanceof Error ? error.message : "The command could not be run.",
        next: "get_booking_state",
      });
    } finally {
      setBusy(false);
      // Focus is restored by the effect below, not here: at this point React
      // has not re-rendered, the button is still disabled, and focus() on a
      // disabled element does nothing.
      refocusAfterRun.current = true;
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={(e) => {
          openerRef.current = e.currentTarget;
          setOpen(true);
        }}
        className="rounded border-[1.5px] border-ink bg-stock px-3 py-1.5 text-sm font-semibold text-ink hover:bg-stock-deep"
      >
        Commands <kbd className="ml-1 font-mono text-xs">Ctrl K</kbd>
      </button>
    );
  }

  const activeId = matches[activeIndex] ? `palette-option-${matches[activeIndex].name}` : undefined;

  function onSearchKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, matches.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const tool = matches[activeIndex];
      if (tool) choose(tool);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="palette-title"
      /* Escape is handled once, at the window — see the effect above. Handling
         it here too would stop the event before it got there whenever focus
         happened to be inside the dialog. */
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 p-4 pt-16"
    >
      <div className="w-full max-w-2xl border-[1.5px] border-ink bg-stock p-4 ">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="palette-title" className="text-lg font-bold text-ink">
            Commands
          </h2>
          <p className="text-xs text-ink-soft">
            {viaBrowser ? "Reading document.modelContext.getTools()" : "Reading the local registry"}
          </p>
        </div>

        {!selected ? (
          <>
            <label htmlFor="palette-search" className="mt-3 block font-semibold text-ink">
              Search available commands
            </label>
            <input
              ref={inputRef}
              id="palette-search"
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls="palette-listbox"
              aria-activedescendant={activeId}
              aria-describedby="palette-count"
              autoComplete="off"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKeyDown}
              className="mt-1 w-full rounded border-[1.5px] border-ink px-3 py-2"
            />

            {/* The count is announced, not just displayed. */}
            <p id="palette-count" role="status" aria-live="polite" className="mt-1 text-sm text-ink">
              {matches.length} command{matches.length === 1 ? "" : "s"} available
            </p>

            <ul id="palette-listbox" role="listbox" aria-label="Available commands" className="mt-2 max-h-80 overflow-y-auto">
              {/* Searching: a flat list in relevance order, so what the DOM
                  shows is the order Enter will follow. Grouping while filtering
                  put the best match underneath a heading it did not belong to,
                  and the first row on screen was not the row Enter opened. */}
              {searching
                ? matches.map((tool, index) => (
                    <Option
                      key={tool.name}
                      tool={tool}
                      active={index === activeIndex}
                      onChoose={choose}
                    />
                  ))
                : /* Idle: workflow order, so the palette reads as the shape of
                     the task (#255). */
                  GROUP_ORDER.concat("other" as ToolGroup).map((group) => {
                    const inGroup = matches.filter((t) => t.group === group);
                    if (inGroup.length === 0) return null;
                    return (
                      <li key={group} role="presentation">
                        <p
                          role="presentation"
                          className="mt-2 px-1 font-display text-xs font-bold uppercase tracking-wide text-ink-soft"
                        >
                          {GROUP_LABELS[group] ?? group}
                        </p>
                        <ul role="group" aria-label={GROUP_LABELS[group] ?? group}>
                          {inGroup.map((tool) => (
                            <Option
                              key={tool.name}
                              tool={tool}
                              active={matches.indexOf(tool) === activeIndex}
                              onChoose={choose}
                            />
                          ))}
                        </ul>
                      </li>
                    );
                  })}
            </ul>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(selected);
            }}
            className="mt-3 flex flex-col gap-3"
          >
            <div>
              <h3 className="font-display font-bold uppercase tracking-wide text-ink">
                {selected.label}
              </h3>
              <p className="text-sm text-ink">{selected.description}</p>
            </div>

            {/* Voice opened this form. Show what was heard, so a mishearing is
                visible before anything runs rather than after. */}
            {heardAs && (
              <p className="riso-panel-inset px-3 py-2 text-sm text-ink" data-testid="palette-heard">
                <span aria-hidden="true">🎙 </span>
                Heard “{heardAs}”. Check the values, then press Run.
              </p>
            )}

            {selected.fields.length === 0 && (
              <p className="text-sm text-ink">This command takes no options.</p>
            )}

            {selected.fields.map((field) => (
              <SchemaField
                key={field.name}
                field={field}
                value={values[field.name]}
                onChange={(v) => setValues((prev) => ({ ...prev, [field.name]: v }))}
              />
            ))}

            <div className="flex flex-wrap gap-3">
              <button
                ref={runButtonRef}
                type="submit"
                disabled={busy}
                className="rounded bg-ink px-4 py-2 font-semibold text-stock hover:bg-ink-soft disabled:opacity-60"
              >
                Run {selected.label}
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelected(null);
                  inputRef.current?.focus();
                }}
                className="rounded border-[1.5px] border-ink px-4 py-2 font-semibold text-ink hover:bg-stock-deep"
              >
                Back to commands
              </button>
            </div>

            {result && (
              <div role="status" aria-live="polite" className="rounded border-[1.5px] border-ink bg-stock-deep p-3 text-sm">
                {isRefusal(result) ? (
                  <>
                    <p className="font-semibold text-spot-deep">
                      <span aria-hidden="true">✕ </span>
                      {result.kind.replace(/_/g, " ")}
                    </p>
                    <p className="text-ink">{result.reason}</p>
                    {result.next && (
                      <p className="mt-1 text-ink">Next: run “{result.next}”.</p>
                    )}
                  </>
                ) : (
                  <p className="text-ink">
                    <span aria-hidden="true">✓ </span>
                    {result.human_summary}
                  </p>
                )}
              </div>
            )}
          </form>
        )}

        <div className="mt-3 flex justify-between border-t border-ink pt-2 text-xs text-ink-soft">
          <span>Arrows move · Enter opens · Escape closes</span>
          <button
            type="button"
            onClick={close}
            className="font-semibold underline"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** One row in the listbox. Identical whether the list is grouped or flat. */
function Option({
  tool,
  active,
  onChoose,
}: {
  tool: PaletteTool;
  active: boolean;
  onChoose: (tool: PaletteTool) => void;
}) {
  return (
    <li
      id={`palette-option-${tool.name}`}
      role="option"
      aria-selected={active}
      onClick={() => onChoose(tool)}
      className={`cursor-pointer px-2 py-1.5 ${active ? "bg-ink text-stock" : "text-ink"}`}
    >
      <span className="font-semibold">{tool.label}</span>
      <span className={active ? "text-stock" : "text-ink-soft"}>
        {" · "}
        <code className="font-display text-xs">{tool.name}</code>
        {!tool.known && " · not in the local map"}
      </span>
    </li>
  );
}

/** One control, chosen by the schema alone. The label is the description (#286). */
function SchemaField({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const id = `palette-field-${field.name}`;
  const requiredMark = field.required ? " (required)" : "";

  if (field.kind === "checkboxGroup") {
    const current = Array.isArray(value) ? (value as string[]) : [];
    return (
      <fieldset className="rounded border-[1.5px] border-ink p-2">
        <legend className="px-1 text-sm font-semibold text-ink">
          {field.label}
          {requiredMark}
        </legend>
        <ul className="grid gap-1 sm:grid-cols-2">
          {field.options.map((option) => (
            <li key={option} className="flex items-center gap-2">
              <input
                id={`${id}-${option}`}
                type="checkbox"
                checked={current.includes(option)}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...current, option]
                      : current.filter((v) => v !== option),
                  )
                }
                className="size-4"
              />
              <label htmlFor={`${id}-${option}`} className="text-sm text-ink">
                {option.replace(/_/g, " ")}
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
    );
  }

  if (field.kind === "checkbox") {
    return (
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
          className="size-4"
        />
        <label htmlFor={id} className="font-semibold text-ink">
          {field.label}
          {requiredMark}
        </label>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-semibold text-ink">
        {field.label}
        {requiredMark}
      </label>
      {field.kind === "select" ? (
        <select
          id={id}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          className="rounded border-[1.5px] border-ink px-3 py-2"
        >
          <option value="">Choose…</option>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          type={field.kind === "number" ? "number" : "text"}
          value={typeof value === "string" || typeof value === "number" ? String(value) : ""}
          onChange={(e) => onChange(e.target.value)}
          className="rounded border-[1.5px] border-ink px-3 py-2"
        />
      )}
    </div>
  );
}
