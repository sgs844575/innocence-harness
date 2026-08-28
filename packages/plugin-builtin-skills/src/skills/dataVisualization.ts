import { defineSkill } from "../define";

/**
 * Visualization skill (adapted from the reference project's chart skill
 * and its trigger description): the data task picks the form before any
 * styling happens, misleading patterns are catalogued, and accessibility
 * constraints apply regardless of palette.
 */
export const dataVisualizationSkill = defineSkill(
  "data-visualization",
  "Pick the visual form the data task demands before any styling; avoid misleading chart patterns and keep output accessible",
  `# Choosing visualizations

A chart is a claim about data made visible. Decide what the data must say before deciding anything about how it looks: form comes first, color comes last.

## Let the task pick the form

Ask what the reader needs from the numbers:

- One headline value: a large numeral, optionally with a compact direction indicator — no chart required.
- Comparison across categories: bars.
- Shape of a distribution: histogram or box plot.
- Change over time: a line.
- Relationship between two measures: a scatter.

Sometimes the correct answer is not a chart at all. A sentence, a table, or one bold number communicates more than a forced graphic; when the numbers are few and the point is simple, say it instead of plotting it.

## Patterns that mislead

- Pies and donuts with many slices: eyes rank angles poorly, so past a handful of categories the form stops working.
- Truncated value axes: shortening an axis exaggerates small differences. Bars start at zero.
- Two independent value scales on one plot: readers cannot tell which scale a mark answers to. Split into paired small plots or index the series to a common base instead.
- Rainbow ramps for magnitude: quantity reads as lightness within one hue, never as hue count.

## Accessibility

- Choose series colors that stay distinguishable under color-vision deficiency, and verify with a checking tool rather than by eye.
- Label series directly on the marks when feasible; a legend forces a lookup, direct annotation does not.
- Never let color be the only carrier of meaning — pair it with position, shape, or text.
- Keep value labels, axis titles, and annotations in text styles; text colored per series is hard to read.

## Final check

Render the result and inspect it: colliding labels, clipped marks, and overflowing legends are defects even when the underlying numbers are right.`,
);
