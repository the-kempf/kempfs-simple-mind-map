# The Kempf Simple Mind Map

The Kempf Simple Mind Map is a file-based mind-mapping plugin for Obsidian. It provides a canvas-style workspace for quickly building, arranging, focusing, and exporting hierarchical maps.

Every map is stored as a readable `.ksmm` file inside the vault. Maps can be renamed, moved, duplicated, synchronized, or deleted through Obsidian like other vault files. Changes save automatically.

## Features

- One central root per map
- Right, Left, Down, Up, and Radial layouts
- Keyboard-driven node creation and navigation
- Drag-and-drop sibling reordering and reparenting
- Foldable, focusable, colorable, and lockable branches
- Node titles plus multiline notes
- Full-name tooltips for truncated titles
- Per-map background, highlight, layout, spacing, and dimming settings
- Live, zoomable and pannable settings preview
- Undo and redo history
- Markdown, OPML, and native `.ksmm` import and export
- PNG, JPG, SVG, and PDF export
- Movable, resizable node editor, map settings, and help windows

## Installation

### Community Plugins

1. Open **Settings → Community plugins**.
2. Search for **The Kempf Simple Mind Map**.
3. Select **Install**, then **Enable**.

### Manual installation

Create `<vault>/.obsidian/plugins/kempfs-simple-mind-map/` and place these files inside it:

```text
main.js
manifest.json
styles.css
```

Reload Obsidian, then enable **The Kempf Simple Mind Map** under Community plugins.

## Creating a map

Select the **List Tree** icon in the ribbon or run **The Kempf Simple Mind Map: Create new mind map** from the command palette.

The node editor opens first so the central node can be named and given optional notes. After creation, the central root is selected and the map is ready for keyboard input.

Select the filename in the view header to rename the open map. Press Enter or click away to save the new filename; press Escape to cancel. The `.ksmm` extension is preserved.

## Nodes and notes

Double-click a node to open the movable and resizable node editor. It contains a single-line **Node title** and multiline **Notes** field. Press Enter while Node title is focused to save. Enter inside Notes creates a new line.

A notes indicator appears on nodes that contain notes. Hover over it for a short preview or select it to open the full node editor. The editor remembers its last size and screen position globally.

When **Show full node name on hover** is enabled, hovering over a truncated title for about 400 milliseconds displays its complete text. The tooltip appears only when needed, closes immediately when the pointer leaves, and stays hidden during dragging.

## Keyboard controls

| Control | Action |
|---|---|
| `Tab` or `C` | Add a child to the selected node |
| `S` | Add a sibling to the selected non-root node |
| `Enter` | Edit the selected node |
| `F2` | Edit the selected node and its notes |
| `Space` | Fold or unfold the selected branch |
| Arrow keys along the branch | Move between the immediate parent and children |
| Arrow keys across the branch | Move among siblings with the same parent |
| `Delete` | Delete the selected non-root node and its subtree |
| `Ctrl/Cmd+Z` | Undo |
| `Ctrl/Cmd+Shift+Z` or `Ctrl+Y` | Redo |

For Right, Left, and Radial layouts, Left and Right follow branches while Up and Down move among siblings. For Up and Down layouts, those roles are reversed.

The selected node remains unchanged after adding a child or sibling, allowing several nodes of the same type to be entered rapidly from one anchor.

## Mouse controls

| Control | Action |
|---|---|
| Mouse wheel | Zoom around the pointer |
| Left-button drag on empty background | Pan |
| Middle-button drag | Pan from anywhere |
| Left-click empty background | Clear node selection |
| Drag into the gap above/below a sibling (or left/right in vertical layouts) | Move at the visible insertion line |
| Drag onto a node center | Make the dragged subtree a child |
| Double-click a node | Edit title and notes |
| Right-click a node | Open node and branch actions |
| Right-click the background | Open map, import, export, and appearance actions |

## Branch actions

Right-click a node to add nodes, edit title and notes, fold descendants, change branch color, focus the branch, lock the branch, or delete a non-root subtree.

The central root cannot be deleted or given a sibling. Each map always retains exactly one root. When an older or imported map contains multiple roots, the additional roots are placed beneath the first root.

### Folding and locking

Nodes with children display `−` when expanded and `+number` when folded. Folding remains available on locked branches because it changes only the view state.

Locking protects a node and its descendants from editing, recoloring, deleting, and drag-and-drop changes. A padlock indicates the protected branch. Focus, folding, zooming, panning, and exporting remain available.

### Focus mode

**Focus branch** keeps the selected node, all descendants, and its ancestor path visible while hiding unrelated branches. It does not recalculate node positions.

**Exit focus** reveals other branches without changing position or zoom. **Full map** exits focus and fits the complete map into the view. The toolbar identifies the focused branch and reports how many nodes are hidden.

### Branch colors

Changing a node color creates a manual override at that node. Descendants that inherit color follow it, while descendants with their own manual overrides remain unchanged. Selecting **Use inherited map color** removes the override. When a branch is moved, nodes without manual overrides inherit from their new parent; manually colored nodes keep their colors. Connectors use the solid color of their parent node without gradients.

## Layouts

- **Right**: descendants extend rightward.
- **Left**: descendants extend leftward.
- **Down**: descendants extend downward.
- **Up**: descendants extend upward.
- **Radial**: first-level branches are balanced across both sides of the root and continue outward.

Subtree-aware spacing keeps branches separated. Connectors attach at the middle of the appropriate node side and use smooth curves.

## Map settings

Open Map settings from the toolbar or background menu. Settings are stored separately in each `.ksmm` map.

- Background: follow the current Obsidian theme, fixed dark, or warm paper
- Highlight color
- Layout
- Dim unrelated branches
- Dim strength, defaulting to 50%
- Level spacing: 65–300
- Sibling spacing: 60–300
- Node padding: 7–24
- Connector-trunk spacing: 30–70

Each spacing slider has an individual reset control. **Compact** applies the minimum spacing preset. The live preview uses the same layout calculations as the map and supports zooming, panning, and reset view.

Node color strength can also be adjusted independently for the central node, level 1, level 2, and level 3 or deeper. Dark backgrounds and light or paper backgrounds have separate values, and each control has its own reset button. Both palettes default to 100%, 75%, 50%, and 35%.

Changing colors preserves selection, focus, position, and zoom. Geometry changes such as layout and node spacing recenter the map.

## Plugin settings

Open **Settings → The Kempf Simple Mind Map** to configure full-name tooltips and defaults for newly created maps: background, highlight color, layout, random first-level branch colors, and map folder.

Under **New map folder**, choose **Use an existing folder** to select a folder already in the vault. If the desired folder does not exist, use **Create a new folder**; the plugin creates it and immediately selects it as the destination for new maps. Nested folder paths are supported.

Changing plugin defaults does not alter existing maps.

## Import and export

Import Markdown from the vault or computer, OPML outlines, native `.ksmm` maps, or JSON backups. The import menu shows the destination before file selection. Markdown and OPML replace an untouched blank map or are added beneath the current central node; native maps and JSON backups open as new `.ksmm` maps. Multiple top-level imported items remain siblings beneath a generated central node. Imported maps are checked for broken references, cycles, duplicate parents, unsafe depth, and invalid appearance values.

Export the map as Markdown, OPML, `.ksmm`, JSON backup, PNG, JPG, SVG, or PDF. Exports use a Save As workflow where supported by the platform. Markdown and OPML include node titles and hierarchy only; the plugin warns that notes, relationships, folding, locks, colors, layout, and other appearance settings are omitted.

## Toolbar and help

The toolbar provides Undo, Redo, Zoom out, Zoom in, Center map, Search, Map settings, and a **?** help button. Search uses a compact, movable panel and keeps each matching node visible while moving through the results.

Help opens one persistent, movable, resizable window whose last size and position are remembered.

## File safety and storage

Each `.ksmm` file stores readable JSON containing node text, notes, hierarchy, fold and lock states, colors, layout, and appearance settings.

If a `.ksmm` file contains invalid JSON or an invalid map structure, the plugin opens a read-only blank preview. The original file contents are retained exactly and are not overwritten by map actions.

Undo and redo retain up to 100 changes for each open map during the current Obsidian session.

## Privacy

The Kempf Simple Mind Map:

- Collects no personal information, usage data, telemetry, or analytics
- Makes no network requests
- Transmits no map, note, or vault data
- Stores maps locally as `.ksmm` files inside the user's Obsidian vault
- Stores plugin preferences locally through Obsidian's plugin-data storage

Imported files are processed locally. Exported files are written only to the destination selected by the user.

## Version

Current version: **0.1.6**

## Author

Kempf

## License

MIT License. See `LICENSE`.
