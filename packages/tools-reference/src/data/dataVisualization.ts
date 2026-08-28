/**
 * Reference entry: charting deep reference. Adapted from six upstream
 * reference documents (form selection, failure catalog, components,
 * interaction, marks, palette) into one structured English entry —
 * restructured and reworded; no verbatim reuse. Complements the
 * data-visualization skill (procedural when/how guidance) with the
 * underlying reference data.
 */
export const dataVisualizationEntry = {
  id: "data-visualization",
  title: "Charting deep reference: form selection, failure catalog, anatomy, interaction, palette",
  body: `# Deep reference for charts

## Task-to-form mapping

Fix the viewer's question first; geometry follows from it, not from the volume of data.

| Question the viewer has | Strongest form | Weaker alternative to avoid |
| --- | --- | --- |
| Current level of one metric | A prominent figure with its change since the prior period | A bar of length one carries no comparison |
| Several headline metrics together | A row of such figures, each with a delta | Grouped bars add structure without insight |
| Share of an allowance consumed | A track whose filled portion encodes progress | A circle split in two performs worse than a track |
| Ranking or comparing categories | Bars — horizontal when names run long | Angles are judged poorly; skip multi-slice circles |
| Trajectory across time | Lines, one per series; a filled area for a lone series | |
| Distribution shape or tail behavior | Histogram, box summary, or strip of points | |
| Association between two measures | Scatter, optionally with a fitted guide | |
| Composition of a whole | Stacked bars | Rings lose accuracy past six segments |
| Balance of an ordered scale (disagree to agree) | Bars stacked around a centered neutral band | |
| Movement between two states per item | Pairs of dots joined by connectors | |

Occasionally the honest output is prose or a small table: a table beats a chart when the reader looks values up, and one sentence beats a chart when the finding is a single fact. Roughly seven is the ceiling of classes that color can separate before neighbours blur — beyond it, facet into a grid of smaller charts, absorb the tail into a remainder bucket, or return to the table.

## Failure catalog

Audit any rendered chart against these entries; a match is a defect to fix:

- A circle or ring chart with many segments. Judging angles and arcs is imprecise, and ordering among slices is hard to recover. Use bars, or show the numbers.
- A quantity axis that starts above the natural floor. Bar length encodes the value, so clipping the baseline invents magnitude. Bars begin at zero; a non-bar form may zoom, but its frame must signal the zoom.
- Two independent quantity scales on one frame. Any visual correlation between the curves is an artifact of wherever the scales happen to align. Prefer side-by-side panels, or restate both series against a shared index.
- Spectral hue ramps encoding amount. Perceived quantity tracks lightness within a single hue, not position in the rainbow, and spectral order implies a categorical meaning the data lacks. Encode magnitude with one hue that darkens; reserve multi-hue ramps for genuinely diverging quantities that deserve a neutral middle.
- Darker-is-bigger shading of unordered categories. It double-encodes what bar length already shows and misuses the lightness channel. Categories without inherent order get one shared hue.
- Re-assigning hues whenever a filter removes a series. Learned color-to-thing bindings break. Bind color to identity, not to rank; survivors keep their hue.
- Printing a value beside every point. Label only what carries the message — the latest, the extreme, the anomalous — and let axes, tooltips, or the table carry the rest.
- Color as the sole carrier of meaning. Pair hue with text, position, or marker shape so the reading survives color-vision differences and grayscale.

## Anatomy

- Axes and reference lines: hairline weight, a shade quieter than the data, continuous rather than dashed (dashes suggest thresholds or forecasts). Tick values round to clean magnitudes, with a consistent thousands separator.
- Marks: keep data ink thin relative to whitespace — cap bar widths, use modest stroke weights on lines, render area fills as translucent washes rather than saturated fields. Separate touching segments with a thin gap in the background color instead of outlining each mark; give dots a small ring of the background so overlaps stay readable.
- Direct annotation: place series names beside their marks when room allows, since a legend forces a lookup the annotation does not. A single series needs no legend at all. Where end labels would collide, prefer thin connector lines from label to mark, or fall back to the legend.
- Text: labels and values use the interface text colors; series hues belong to marks, not to type. Large standalone figures read best with proportional digits; fixed-width digits belong in columns that must align vertically.

## Interaction

- Hover and keyboard focus reveal detail progressively: the pointer or focused position highlights the nearest datum and shows its values; everything the tooltip offers stays reachable another way (annotations, or the table form), so interaction enhances rather than gates.
- One readout per position lists every series at that position, so the pointer need not land on any particular curve. On discrete marks the mark itself is the target, and the responsive area extends past the painted pixels to a comfortable minimum — dense point clouds use a nearest-point layer instead of demanding precision.
- Treat labels that originate outside the chart (spreadsheets, tool output, service responses) as untrusted: insert them through text-only DOM interfaces, never by assembling markup strings.
- Scope controls sit once, above everything they affect, and every panel re-renders against the identical slice; while a refresh is in flight, keep the previous frame dimmed rather than flashing placeholder skeletons.

## Palette baseline

- Category hues: plan the size before picking colors. Up to three series can share an all-pairs layout safely; adjacent-only layouts (stacks, side-by-side bars, lines) tolerate roughly eight slots; past that, reduce or facet. Order slots so neighboring hues stay distinguishable under simulated color-vision deficiency — verified by measured color difference, never by eye.
- Amount scales: a single hue whose lightness steps with the value; when two independent magnitude scales appear together, give each its own hue family. For discrete ordered marks, keep the lightest step at least twice as bright as its background so the smallest class stays visible.
- Diverging scales: anchor on a neutral middle with hues of opposite warmth at the poles; two hues of similar temperature make the midpoint ambiguous.
- Reserve semantic colors (healthy, caution, failing) for states that mean them — never for series identity — and never let such a color act alone; pair it with an icon or a word.
- Define every role as a variable and swap variable values per theme, so light and dark modes stay consistent and charts reference roles rather than literals.`,
} as const;
