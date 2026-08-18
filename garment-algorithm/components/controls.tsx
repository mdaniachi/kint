"use client";

import type { EffectParameters, Garment, GarmentSettings } from "@/lib/types";
import { effects } from "@/lib/effects";

/* ── Slider ─────────────────────────────────────────────────────────── */

export function Slider({
  label,
  value,
  min = 0,
  max = 100,
  step = 1,
  format,
  onChange
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[11px] uppercase tracking-[0.12em] text-fg-mid">
          {label}
        </span>
        <span className="tabular-nums text-[11px] text-fg-low">
          {format ? format(value) : value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
      />
    </label>
  );
}

/* ── Upload zone ────────────────────────────────────────────────────── */

export function UploadZone({ onFile }: { onFile: (f: File) => void }) {
  return (
    <div
      className="flex h-full w-full items-center justify-center"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
    >
      <label className="group flex h-[52%] w-[62%] min-w-[280px] cursor-pointer flex-col items-center justify-center border border-dashed border-ink-line-hi text-center transition-colors hover:border-fg-low">
        <span className="text-sm text-fg-hi">Drop an image here</span>
        <span className="mt-2 text-[11px] uppercase tracking-[0.14em] text-fg-low">
          or
        </span>
        <span className="mt-2 border border-ink-line-hi px-3 py-1.5 text-[12px] text-fg-mid transition-colors group-hover:border-fg-low group-hover:text-fg-hi">
          Choose image
        </span>
        <span className="mt-5 text-[10px] uppercase tracking-[0.14em] text-fg-low">
          jpg · jpeg · png · webp
        </span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/jpg"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.currentTarget.value = "";
          }}
        />
      </label>
    </div>
  );
}

/* ── Garment list panel ─────────────────────────────────────────────── */

export function GarmentList({
  garments,
  selectedIds,
  hoverId,
  notice,
  onSelect,
  onHover,
  onAddManual
}: {
  garments: Garment[];
  selectedIds: string[];
  hoverId: string | null;
  notice: string | null;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  onAddManual: () => void;
}) {
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-ink-line bg-ink-1">
      <div className="border-b border-ink-line px-4 py-3 text-[11px] uppercase tracking-[0.16em] text-fg-low">
        Garments
      </div>
      <div className="panel-scroll flex-1 overflow-y-auto py-1">
        {garments.length === 0 && !notice && (
          <p className="px-4 py-3 text-[11px] leading-relaxed text-fg-low">
            Upload a photograph to detect garments.
          </p>
        )}
        {garments.length > 0 && (
          <p className="px-4 pb-1 pt-2 text-[10px] leading-relaxed text-fg-low">
            Click to treat a garment, click again to release. Several at once is
            fine.
          </p>
        )}
        {garments.map((g, i) => {
          const active = selectedIds.includes(g.id);
          const hovered = g.id === hoverId;
          return (
            <button
              key={g.id}
              onClick={() => onSelect(g.id)}
              onMouseEnter={() => onHover(g.id)}
              onMouseLeave={() => onHover(null)}
              className={[
                "flex w-full items-baseline gap-3 px-4 py-2 text-left transition-colors",
                active
                  ? "bg-ink-3 text-fg-hi"
                  : hovered
                    ? "bg-ink-2 text-fg-hi"
                    : "text-fg-mid hover:bg-ink-2 hover:text-fg-hi"
              ].join(" ")}
            >
              <span
                className={[
                  "tabular-nums text-[11px]",
                  active ? "text-fg-hi" : "text-fg-low"
                ].join(" ")}
                aria-hidden
              >
                {active ? "▣" : String(i + 1).padStart(2, "0")}
              </span>
              <span className="flex-1 truncate text-[12px]">{g.label}</span>
              {typeof g.confidence === "number" && (
                <span className="tabular-nums text-[10px] text-fg-low">
                  {Math.round(g.confidence * 100)}%
                </span>
              )}
            </button>
          );
        })}
        {notice && (
          <div className="mx-3 mt-2 border border-ink-line px-3 py-3">
            <p className="text-[11px] leading-relaxed text-fg-mid">{notice}</p>
          </div>
        )}
      </div>
      <div className="border-t border-ink-line p-3">
        <button
          onClick={onAddManual}
          className="w-full border border-ink-line-hi px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-fg-mid transition-colors hover:border-fg-low hover:text-fg-hi"
        >
          + Manual mask
        </button>
      </div>
    </aside>
  );
}

/* ── Effect controls panel ──────────────────────────────────────────── */

export function EffectControls({
  settings,
  activeLabel,
  multi,
  onChange,
  onEffectChange,
  onMaskEdgeChange,
  onApplyToAll
}: {
  /** Settings of the active garment, or null when nothing is treated. */
  settings: GarmentSettings | null;
  activeLabel: string | null;
  /** True when more than one garment is treated (enables Apply to all). */
  multi: boolean;
  onChange: (p: Partial<EffectParameters>) => void;
  onEffectChange: (id: string) => void;
  onMaskEdgeChange: (v: number) => void;
  onApplyToAll: () => void;
}) {
  const params = settings?.params ?? null;
  const maskEdge = settings?.maskEdge ?? 0;
  if (!settings || !params) {
    return (
      <aside className="flex w-64 shrink-0 flex-col border-l border-ink-line bg-ink-1">
        <div className="border-b border-ink-line px-4 py-3 text-[11px] uppercase tracking-[0.16em] text-fg-low">
          Effect
        </div>
        <p className="px-4 py-3 text-[11px] leading-relaxed text-fg-low">
          Select a garment to apply the effect. Each garment keeps its own
          settings.
        </p>
      </aside>
    );
  }
  return (
    <aside className="flex w-64 shrink-0 flex-col border-l border-ink-line bg-ink-1">
      <div className="border-b border-ink-line px-4 py-3 text-[11px] uppercase tracking-[0.16em] text-fg-low">
        Effect
      </div>
      <div
        className={[
          "panel-scroll flex-1 space-y-5 overflow-y-auto px-4 py-4",
          "" // panel only renders when a garment is active
        ].join(" ")}
      >
        {activeLabel && (
          <div className="flex items-baseline justify-between text-[11px]">
            <span className="uppercase tracking-[0.12em] text-fg-low">
              Editing
            </span>
            <span className="text-fg-hi">{activeLabel}</span>
          </div>
        )}
        <select
          value={settings.effectId}
          onChange={(e) => onEffectChange(e.target.value)}
          className="w-full border border-ink-line bg-ink-0 px-2 py-2 text-[12px] text-fg-hi outline-none transition-colors focus:border-fg-low"
          aria-label="Effect"
        >
          {effects.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        {multi && (
          <button
            type="button"
            onClick={onApplyToAll}
            className="w-full border border-ink-line-hi px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-fg-mid transition-colors hover:border-fg-low hover:text-fg-hi"
            title="Copy this garment's effect and settings to every treated garment"
          >
            Apply to all
          </button>
        )}
        <Slider
          label="Density"
          value={params.density}
          onChange={(v) => onChange({ density: v })}
        />
        <Slider
          label="Character size"
          value={params.charSize}
          min={4}
          max={64}
          format={(v) => `${v}px`}
          onChange={(v) => onChange({ charSize: v })}
        />
        <div>
          <Slider
            label="Mask edge"
            value={maskEdge}
            min={-16}
            max={16}
            format={(v) => (v > 0 ? `+${v}px` : `${v}px`)}
            onChange={onMaskEdgeChange}
          />
          <span className="mt-1 block text-[10px] leading-relaxed text-fg-low">
            Grows or shrinks the detected mask. Negative pulls the treatment
            back off the edge, positive lets it bleed past.
          </span>
        </div>
        <Slider
          label="Edge influence"
          value={params.edgeInfluence}
          onChange={(v) => onChange({ edgeInfluence: v })}
        />
        <div>
          <Slider
            label="Flow"
            value={params.flow}
            onChange={(v) => onChange({ flow: v })}
          />
          <span className="mt-1 block text-[10px] leading-relaxed text-fg-low">
            Characters rotate to follow folds and seams. 0 keeps strict rows.
          </span>
        </div>
        <div>
          <Slider
            label="Size by light"
            value={params.sizeByLight}
            onChange={(v) => onChange({ sizeByLight: v })}
          />
          <span className="mt-1 block text-[10px] leading-relaxed text-fg-low">
            Lit surfaces grow, shadow shrinks.
          </span>
        </div>
        <Slider
          label="Randomness"
          value={params.randomness}
          onChange={(v) => onChange({ randomness: v })}
        />
        <Slider
          label="Original garment"
          value={params.originalGarment}
          onChange={(v) => onChange({ originalGarment: v })}
        />
        <Slider
          label="Algorithm opacity"
          value={params.opacity}
          onChange={(v) => onChange({ opacity: v })}
        />
        <div>
          <span className="mb-1 block text-[11px] uppercase tracking-[0.12em] text-fg-mid">
            Ink
          </span>
          <div className="flex border border-ink-line">
            {(["auto", "light", "dark"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => onChange({ ink: mode })}
                aria-pressed={params.ink === mode}
                className={[
                  "flex-1 px-2 py-1.5 text-[11px] capitalize transition-colors",
                  params.ink === mode
                    ? "bg-fg-low/20 text-fg-hi"
                    : "text-fg-low hover:text-fg-mid"
                ].join(" ")}
              >
                {mode}
              </button>
            ))}
          </div>
          <span className="mt-1 block text-[10px] leading-relaxed text-fg-low">
            Where the characters go: dark garments fill in their highlights,
            light garments their shadows.
          </span>
        </div>
        <div>
          <span className="mb-1 block text-[11px] uppercase tracking-[0.12em] text-fg-mid">
            Colour
          </span>
          <div className="flex items-stretch gap-2">
            <button
              type="button"
              onClick={() => onChange({ inkColor: "auto" })}
              aria-pressed={params.inkColor === "auto"}
              className={[
                "flex-1 border px-2 py-1.5 text-[11px] transition-colors",
                params.inkColor === "auto"
                  ? "border-ink-line bg-fg-low/20 text-fg-hi"
                  : "border-ink-line text-fg-low hover:text-fg-mid"
              ].join(" ")}
            >
              Match garment
            </button>
            <label
              className={[
                "flex cursor-pointer items-center gap-2 border px-2 py-1.5 text-[11px] transition-colors",
                params.inkColor === "auto"
                  ? "border-ink-line text-fg-low hover:text-fg-mid"
                  : "border-ink-line bg-fg-low/20 text-fg-hi"
              ].join(" ")}
            >
              <input
                type="color"
                value={params.inkColor === "auto" ? "#f6f5f1" : params.inkColor}
                onChange={(e) => onChange({ inkColor: e.target.value })}
                className="h-4 w-4 cursor-pointer appearance-none border-0 bg-transparent p-0"
                aria-label="Character colour"
              />
              Custom
            </label>
          </div>
          <span className="mt-1 block text-[10px] leading-relaxed text-fg-low">
            White by default. &ldquo;Match garment&rdquo; flips to dark ink on
            pale garments. Neither moves a character.
          </span>
        </div>
        <label className="block">
          <span className="mb-1 block text-[11px] uppercase tracking-[0.12em] text-fg-mid">
            Character set
          </span>
          <input
            type="text"
            value={params.charset}
            spellCheck={false}
            onChange={(e) => onChange({ charset: e.target.value })}
            className="w-full border border-ink-line bg-ink-0 px-2 py-1.5 text-[13px] tracking-[0.2em] text-fg-hi outline-none transition-colors focus:border-fg-low"
            aria-label="Character set, dense to light"
          />
          <span className="mt-1 block text-[10px] text-fg-low">
            Ordered dense → light
          </span>
        </label>
      </div>

    </aside>
  );
}
