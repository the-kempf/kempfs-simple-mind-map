# Changelog

## 0.2.0

- Added eight Linear and four Staggered layouts with non-overlapping placement, matching previews and exports, and direction-aware keyboard navigation.
- Replaced long layout menus with a shared visual family-and-direction picker.
- Added Blank, Brainstorm, Study Notes, Meeting Notes, and Project Plan starting templates with previews.
- Added a persistent Map info panel with collapsible map, branch-distribution, and selected-node sections.
- Added an interactive descendant-distribution donut with per-branch colors, small-branch grouping, calculation tooltips, pinning, and slice navigation.
- Added independent graph and node-information pins so analysis can remain fixed while map selection changes.
- Added relationship details to selected-node information and a source-node popup to the map relationship count.
- Added automatic viewport panning while dragging and map-wide collapse, expansion, and Collapse to level controls.
- Added per-map viewport restoration and remembered collapse states for information-panel sections.
- Added optional random colors for new first-level branches and changed the new-node placeholder to `New Item`.
- Restyled the toolbar with grouped controls, a zoom readout, and a compact focus indicator.
- Replaced individual node-color-strength controls with Full, Medium, and Extreme presets.
- Made dimming controls update the settings preview immediately and removed the Compact spacing shortcut.
- Fixed information-panel wrapping, notes sizing, theme consistency, and duplicate relationship tooltips.
- Fixed keyboard sibling navigation so Linear sequence and Staggered trunk movement cannot unexpectedly change hierarchy levels.
- Removed direct Electron and Node filesystem dependencies from export, retaining standards-based Save As and download fallbacks across desktop and mobile.
- Expanded regression coverage for imports, templates, layout geometry, navigation, collapse behavior, viewport restoration, information-panel calculations, and release metadata.

## 0.1.6

- Added Obsidian default, Dark, and Paper map backgrounds.
- Made outline import destinations visible before file selection.
- Added warnings before Markdown and OPML exports that omit map-only data.
- Hardened Markdown and OPML imports against ID collisions, invalid sizes, and locked destinations.
- Raised the minimum node padding to 7 pixels so two-line labels remain visible.
- Added focused regression checks for imports, appearance migration, spacing limits, and release metadata.
- Added gap-based sibling reordering with a visible insertion-line preview.
- Changed the fixed Dark canvas to neutral `#181818` with a `#202020` toolbar and matching preview and export colors.

## 0.1.5 beta

Initial public beta release of The Kempf Simple Mind Map.

### Included

- Desktop, mobile, mouse, keyboard, and touch controls
- Right, left, up, down, and radial layouts
- Node titles, notes, expanding and collapsing, branch focus, locking, colors, sorting, search, copy, and paste
- Per-map appearance, spacing, dimming, and node-color-strength settings
- Markdown, OPML, native `.ksmm`, and JSON backup import and export
- PNG, JPG, SVG, and PDF export
- Undo and redo with viewport preservation
- Structure-preserving multi-root import and hardened map validation
- Local-only operation with no analytics, telemetry, or network transmission
