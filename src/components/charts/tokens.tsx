/**
 * Chart tokens (dataviz skill reference palette, validated with
 * validate_palette.js in light and dark: worst adjacent CVD delta E 9.1 light,
 * 8.4 dark; three light slots sit under 3:1, so every chart ships a visible
 * value label or its table view). Defined once as CSS custom properties on
 * `.viz`, with selected dark steps, so chart bodies use roles, not hex.
 */

export const VIZ_CSS = `
.viz {
  --viz-surface: #fcfcfb;
  --viz-ink: #0b0b0b;
  --viz-ink-2: #52514e;
  --viz-muted: #898781;
  --viz-grid: #e1e0d9;
  --viz-axis: #c3c2b7;
  --viz-track: #f0efec;
  --viz-s1: #2a78d6;
  --viz-s2: #eb6834;
  --viz-s3: #1baf7a;
  --viz-neutral: #a3a29c;
  --viz-neg: #e34948;
  --viz-seq-1: #cde2fb;
  --viz-seq-2: #9ec5f4;
  --viz-seq-3: #6da7ec;
  --viz-seq-4: #3987e5;
  --viz-seq-5: #256abf;
  --viz-seq-6: #184f95;
  --viz-seq-7: #0d366b;
  --viz-on-1: #0b0b0b; --viz-on-2: #0b0b0b; --viz-on-3: #0b0b0b; --viz-on-4: #ffffff;
  --viz-on-5: #ffffff; --viz-on-6: #ffffff; --viz-on-7: #ffffff;
  --viz-ord-1: #86b6ef;
  --viz-ord-2: #3987e5;
  --viz-ord-3: #1c5cab;
  color: var(--viz-ink);
}
@media (prefers-color-scheme: dark) {
  .viz {
    --viz-surface: #1a1a19;
    --viz-ink: #f0efec;
    --viz-ink-2: #c3c2b7;
    --viz-muted: #898781;
    --viz-grid: #2c2c2a;
    --viz-axis: #383835;
    --viz-track: #2c2c2a;
    --viz-s1: #3987e5;
    --viz-s2: #d95926;
    --viz-s3: #199e70;
    --viz-neutral: #6b6a66;
    --viz-neg: #e66767;
    --viz-seq-1: #104281;
    --viz-seq-2: #184f95;
    --viz-seq-3: #1c5cab;
    --viz-seq-4: #256abf;
    --viz-seq-5: #3987e5;
    --viz-seq-6: #6da7ec;
    --viz-seq-7: #9ec5f4;
    --viz-on-1: #ffffff; --viz-on-2: #ffffff; --viz-on-3: #ffffff; --viz-on-4: #ffffff;
    --viz-on-5: #ffffff; --viz-on-6: #0b0b0b; --viz-on-7: #0b0b0b;
    --viz-ord-1: #184f95;
    --viz-ord-2: #2a78d6;
    --viz-ord-3: #6da7ec;
  }
}
.viz-mark { transition: opacity 120ms; }
.viz-mark:hover, .viz-mark:focus-visible { opacity: 0.8; outline: 2px solid var(--viz-ink-2); outline-offset: 1px; }
.viz-num { font-variant-numeric: tabular-nums; }
@media (forced-colors: active) {
  .viz-fill { forced-color-adjust: none; }
}
`

/**
 * Renders the token sheet. React 19 hoists and dedupes a <style> with the
 * same href, so every chart can include it safely.
 */
export function VizStyles() {
  return (
    <style href="survey-viz-tokens" precedence="default">
      {VIZ_CSS}
    </style>
  )
}

/** Categorical slots in fixed order. Never cycled; callers fold extra series. */
export const SERIES = ['var(--viz-s1)', 'var(--viz-s2)', 'var(--viz-s3)'] as const

/** Sequential blue, 7 steps, light to dark in light mode (selected dark steps invert toward the surface). */
export const SEQ = ['var(--viz-seq-1)', 'var(--viz-seq-2)', 'var(--viz-seq-3)', 'var(--viz-seq-4)', 'var(--viz-seq-5)', 'var(--viz-seq-6)', 'var(--viz-seq-7)'] as const

/** Text color that clears contrast on each sequential step, in either mode. */
export const SEQ_ON = ['var(--viz-on-1)', 'var(--viz-on-2)', 'var(--viz-on-3)', 'var(--viz-on-4)', 'var(--viz-on-5)', 'var(--viz-on-6)', 'var(--viz-on-7)'] as const
