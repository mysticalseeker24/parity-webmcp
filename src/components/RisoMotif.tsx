/**
 * The hero motif: scattered marks on the left gather into a few strong nodes,
 * then fan out into ordered lines on the right.
 *
 * It is not decoration for its own sake — it is the architecture. Many callers
 * and many constraints converge on one registry, and the registry fans back out
 * as an ordered set of tools. It is also the Parity mark (bars meeting a node)
 * drawn at full width.
 *
 * Two flat spot inks with a deliberate 3px misregistration between passes.
 * Purely presentational, so the whole thing is `aria-hidden` and the headline
 * beside it carries the meaning.
 */

/** Deterministic scatter — a fixed seed, so the print is the same every pull. */
function scatter(count: number, seed: number) {
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return Array.from({ length: count }, () => {
    // Density rises toward the convergence point, so the eye is led right.
    const bias = rand() ** 1.7;
    return {
      x: 20 + bias * 300,
      y: 40 + rand() * 260,
      r: 1.2 + rand() * (1 - bias) * 7,
    };
  });
}

const MARKS = scatter(150, 20260907);
// Five, spaced so they read as distinct nodes rather than one column.
const NODE_YS = [72, 122, 172, 222, 272];
const LINE_YS = [46, 66, 86, 106, 126, 146, 166, 186, 206, 226, 246, 266, 286];

export function RisoMotif({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 900 340"
      className={className}
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="xMidYMid meet"
    >
      {/* ── Peach pass. Printed first, offset up-left, so the indigo pass
             lands slightly off it the way a second run would. ── */}
      <g transform="translate(-3 -3)" opacity="0.9">
        {MARKS.filter((_, i) => i % 2 === 0).map((m, i) => (
          <circle key={`p${i}`} cx={m.x} cy={m.y} r={m.r} fill="var(--color-spot)" />
        ))}
        {NODE_YS.map((y, i) => (
          <circle key={`pn${i}`} cx={430} cy={y} r={i === 2 ? 30 : 20} fill="var(--color-spot)" />
        ))}
        {LINE_YS.filter((_, i) => i % 3 === 0).map((y, i) => (
          <path
            key={`pl${i}`}
            d={`M 452 ${y < 166 ? 150 : 190} C 560 ${y < 166 ? 150 : 190}, 600 ${y}, 720 ${y} L 880 ${y}`}
            fill="none"
            stroke="var(--color-spot)"
            strokeWidth="4"
            strokeLinecap="round"
          />
        ))}
      </g>

      {/* ── Indigo pass. The dominant ink. ── */}
      <g>
        {MARKS.map((m, i) => (
          <circle key={`i${i}`} cx={m.x} cy={m.y} r={m.r} fill="var(--color-ink)" opacity="0.92" />
        ))}

        {/* Convergence: every scattered mark resolves into one of seven nodes. */}
        {NODE_YS.map((y, i) => (
          <g key={`n${i}`}>
            {/* Three strands feed each node, so the gathering reads as many
                constraints resolving into one, not a one-to-one mapping. */}
            {[-58, 0, 58].map((spread, j) => (
              <path
                key={j}
                d={`M 316 ${y + spread * 0.9} C 372 ${y + spread * 0.9}, 386 ${y}, 408 ${y}`}
                fill="none"
                stroke="var(--color-ink)"
                strokeWidth="2"
                opacity="0.5"
              />
            ))}
            <circle cx={430} cy={y} r={i === 2 ? 30 : 20} fill="var(--color-ink)" />
          </g>
        ))}

        {/* Fan-out: the ordered set the registry hands back. */}
        {LINE_YS.map((y, i) => {
          const from = 138 + (i % 3) * 30;
          return (
            <path
              key={`l${i}`}
              d={`M 452 ${from} C 570 ${from}, 610 ${y}, 730 ${y} L 884 ${y}`}
              fill="none"
              stroke="var(--color-ink)"
              strokeWidth={i % 4 === 0 ? "5" : "3"}
              strokeLinecap="round"
              opacity={i % 4 === 0 ? 1 : 0.78}
            />
          );
        })}
      </g>
    </svg>
  );
}

/** The Parity mark: two bars meeting a node. Used on the loading sheet. */
export function RisoMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 240 140" className={className} aria-hidden="true" focusable="false">
      <g transform="translate(-3 -3)" opacity="0.9">
        <rect x="14" y="44" width="130" height="20" rx="10" fill="var(--color-spot)" />
        <rect x="14" y="80" width="130" height="20" rx="10" fill="var(--color-spot)" />
        <circle cx="168" cy="72" r="52" fill="var(--color-spot)" />
      </g>
      <g>
        <rect x="14" y="44" width="130" height="20" rx="10" fill="var(--color-ink)" />
        <rect x="14" y="80" width="130" height="20" rx="10" fill="var(--color-ink)" />
        <circle cx="168" cy="72" r="52" fill="var(--color-ink)" />
      </g>
    </svg>
  );
}
