"use client";

import "./hierarchy.css";

/** Pilihan Level 1..N untuk tabel bertingkat (dipakai Detail UIO dan Summary).
 * Level kosong menutup level sesudahnya; satu dimensi hanya boleh dipakai sekali. */
export default function LevelPicker<D extends string>({
  levels,
  dims,
  labels,
  onChange,
  firstOptional = false,
  noneLabel = "(none)"
}: {
  levels: (D | "")[];
  dims: readonly D[];
  labels: Record<D, string>;
  onChange: (next: (D | "")[]) => void;
  /** true = Level 1 boleh kosong (tabel tampil datar). */
  firstOptional?: boolean;
  /** Teks pilihan "none" di Level 1. */
  noneLabel?: string;
}) {
  function setLevel(i: number, v: D | "") {
    const next = levels.slice();
    next[i] = v;
    if (!v) for (let j = i + 1; j < next.length; j++) next[j] = "";
    onChange(next);
  }
  return (
    <div className="hc-levels">
      {levels.map((l, i) => {
        const prevEmpty = i > 0 && !levels[i - 1];
        return (
          <label className={`hc-level${prevEmpty ? " off" : ""}`} key={i}>
            <span>Level {i + 1}</span>
            <select value={l} disabled={prevEmpty} onChange={(e) => setLevel(i, e.target.value as D | "")}>
              <option value="">{i === 0 ? noneLabel : "(none)"}</option>
              {dims.map((d) => (
                <option key={d} value={d} disabled={levels.some((x, j) => j !== i && x === d)}>
                  {labels[d]}
                </option>
              ))}
            </select>
          </label>
        );
      })}
    </div>
  );
}

/** Level aktif = level berurutan dari Level 1 sampai level kosong pertama. */
export function activeLevels<D extends string>(levels: (D | "")[]): D[] {
  const out: D[] = [];
  for (const l of levels) {
    if (!l) break;
    out.push(l);
  }
  return out;
}
