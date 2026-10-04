# The Kempf Simple Mind Map

The Kempf Simple Mind Map is a file-based mind-mapping plugin for Obsidian. It provides a canvas-style workspace for quickly building, arranging, focusing, and exporting hierarchical maps.

Every map is stored as a readable `.ksmm` file inside the vault. Maps can be renamed, moved, duplicated, synchronized, or deleted through Obsidian like other vault files. Changes save automatically.

## Features

- One central root per map
- Standard, Radial, four Staggered, and eight Linear layouts
- Keyboard-driven node creation and navigation
- Drag-and-drop sibling reordering and reparenting
- Collapsible, focusable, colorable, and lockable branches
- Node titles plus multiline notes
- Full-name tooltips for truncated titles
- Per-map background, highlight, layout, spacing, and dimming settings
- Live, zoomable and pannable settings preview
- Collapsible per-map information panel for selection and map details
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

The collapsible **Map info** panel always shows map totals, visible nodes, levels, collapsed branches, and relationship links. Its branch donut uses the selected node, or the central node when nothing is selected, and sizes each child slice by that child's complete branch. Clicking an individual slice selects and reveals its child node. Pinning the graph keeps its current scope while selecting other nodes; small or crowded slices are collected under **Other**, and legend tooltips show full names and calculations. Selected-node details have their own independent pin, allowing the graph, node details, and current map selection to use different scopes. The graph and node-details sections can each be collapsed, and all three collapsed states are remembered separately in each map.

When **Show full node name on hover** is enabled, hovering over a truncated title for about 400 milliseconds displays its complete text. The tooltip appears only when needed, closes immediately when the pointer leaves, and stays hidden during dragging.

## Keyboard controls

| Control | Action |
|---|---|
| `Tab` or `C` | Add a child to the selected node |
| `S` | Add a sibling to the selected non-root node |
| `Enter` | Edit the selected node |
| `F2` | Edit the selected node and its notes |
| `Space` | Collapse or expand the selected node's children |
| Arrow keys along the branch | Move between the immediate parent and children |
| Arrow keys across the branch | Move among siblings with the same parent |
| `Delete` | Delete the selected non-root node and its subtree |
| `Ctrl/Cmd+Z` | Undo |
| `Ctrl/Cmd+Shift+Z` or `Ctrl+Y` | Redo |

Arrow behavior follows the visible structure of the chosen layout. In standard Tree layouts, the branch axis moves between hierarchy levels and the perpendicular axis moves among siblings. In Linear layouts, the sequence axis stays within the current sibling level while the indent axis moves between parents and children. In Staggered layouts, the central-trunk axis stays within the current sibling level and the perpendicular branch axis moves through descendants. Reaching the end of a sibling list stops navigation instead of changing levels.

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
| Drag near a viewport edge | Automatically pan while continuing the drag |
| Double-click a node | Edit title and notes |
| Right-click a node | Open node and branch actions |
| Right-click the background | Open map, import, export, and appearance actions |

## Branch actions

Right-click a node to add nodes, edit title and notes, expand or collapse descendants, change branch color, focus the branch, lock the branch, or delete a non-root subtree.

The central root cannot be deleted or given a sibling. Each map always retains exactly one root. When an older or imported map contains multiple roots, the additional roots are placed beneath the first root.

### Expanding, collapsing, and locking

Nodes with children display `−` when expanded and `+number` when collapsed. Expanding and collapsing remain available on locked branches because they change only the view state.

Use **Expand and collapse** from a node menu for its children, its full branch, or the whole map. The background menu and mobile Map options provide the map-wide controls. Unavailable actions are dimmed when they would have no effect. Level 1 keeps the central node and its immediate children visible; each higher level reveals one additional generation. The Collapse to level dialog defaults to the selected node's level, or Level 1 when no node is selected.

Locking protects a node and its descendants from editing, recoloring, deleting, and drag-and-drop changes. A padlock indicates the protected branch. Focus, expanding and collapsing, zooming, panning, and exporting remain available.

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
- **Staggered — Right / Left**: one central trunk extends right or left. Successive first-level branches attach along it, alternating above and below.
- **Staggered — Up / Down**: one central trunk extends up or down. Successive first-level branches attach along it, alternating left and right.
- **Linear — Down and Right**: nodes follow reading order downward, with deeper levels indented right.
- **Linear — Down and Left**: nodes follow reading order downward, with deeper levels indented left.
- **Linear — Up and Right**: the central node sits at the bottom and deeper levels extend upward and right.
- **Linear — Up and Left**: the central node sits at the bottom and deeper levels extend upward and left.
- **Linear — Left and Up**: the main sequence runs left, with deeper levels branching upward.
- **Linear — Left and Down**: the main sequence runs left, with deeper levels branching downward.
- **Linear — Right and Up**: the main sequence runs right, with deeper levels branching upward.
- **Linear — Right and Down**: the main sequence runs right, with deeper levels branching downward.

Standard and radial layouts use subtree-aware spacing and smooth connectors. Staggered layouts use a single central trunk with each complete first-level subtree extending from its alternating side without overlap. Linear layouts use indented rows and right-angle connectors.

## Map settings

Open Map settings from the toolbar or background menu. Settings are stored separately in each `.ksmm` map.

Select **Change layout…** to open the visual layout picker. Choose Tree, Radial, Staggered, or Linear, then select only the directions used by that family while the preview updates. The background right-click menu and mobile Map options open the same picker instead of listing every layout.

- Background: follow the current Obsidian theme, fixed dark, or warm paper
- Highlight color
- Layout
- Dim unrelated branches
- Dim strength, defaulting to 50%
- Node color strength: Full, Medium, or Extreme
- Level spacing: 65–300
- Sibling spacing: 60–300
- Node padding: 7–24
- Connector-trunk spacing: 30–70

Each spacing slider has an individual reset control. The live preview uses the same layout calculations as the map and supports zooming, panning, and reset view.

Node color strength uses one coordinated preset across the central node and deeper levels. **Full** uses 100% color at every level. **Medium** uses 100%, 65%, 40%, and 25%. **Extreme** uses 100%, 50%, 35%, and 10%.

Changing colors preserves selection, focus, position, and zoom. Geometry changes such as layout and node spacing recenter the map.

## Plugin settings

Open **Settings → The Kempf Simple Mind Map** to configure full-name tooltips and defaults for newly created maps: background, highlight color, layout, random first-level branch colors, and map folder.

Under **New map folder**, choose **Use an existing folder** to select a folder already in the vault. If the desired folder does not exist, use **Create a new folder**; the plugin creates it and immediately selects it as the destination for new maps. Nested folder paths are supported.

Changing plugin defaults does not alter existing maps.

## Import and export

Import Markdown from the vault or computer, OPML outlines, native `.ksmm` maps, or JSON backups. The import menu shows the destination before file selection. Markdown and OPML replace an untouched blank map or are added beneath the current central node; native maps and JSON backups open as new `.ksmm` maps. Multiple top-level imported items remain siblings beneath a generated central node. Imported maps are checked for broken references, cycles, duplicate parents, unsafe depth, and invalid appearance values.

Export the map as Markdown, OPML, `.ksmm`, JSON backup, PNG, JPG, SVG, or PDF. Exports use a Save As workflow where supported by the platform. Markdown and OPML include node titles and hierarchy only; the plugin warns that notes, relationships, collapsed states, locks, colors, layout, and other appearance settings are omitted.

## Toolbar and help

The compact icon toolbar provides New map, Undo, Redo, Zoom out, a live zoom percentage, Zoom in, Center map, Search, Map settings, and Help. Search uses a compact, movable panel and keeps each matching node visible while moving through the results.

Help opens one persistent, movable, resizable window whose last size and position are remembered.

## File safety and storage

Each `.ksmm` file stores readable JSON containing node text, notes, hierarchy, collapse and lock states, colors, layout, appearance settings, and that map's last pan and zoom position. Reopening different maps restores each map to its own saved viewport.

When creating a map, choose **Blank**, **Brainstorm**, **Study Notes**, **Meeting Notes**, or **Project Plan** from the Starting template dropdown. **Preview** opens a read-only diagram before the map is created. The entered title and notes become the central node.

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

Current version: **0.2.0**

## Author

Kempf

## License

MIT License. See `LICENSE`.
