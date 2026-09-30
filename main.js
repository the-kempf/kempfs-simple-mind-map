const { FuzzySuggestModal, Menu, Modal, Notice, Platform, Plugin, PluginSettingTab, Setting, TFolder, TextFileView, normalizePath } = require("obsidian");

const VIEW_TYPE = "kempfs-simple-mind-map-view";
const NODE_COLORS = {
  blue: { hex: "#3b82f6", text: "#ffffff" },
  cyan: { hex: "#06b6d4", text: "#071318" },
  teal: { hex: "#14b8a6", text: "#061411" },
  green: { hex: "#22c55e", text: "#07140b" },
  lime: { hex: "#84cc16", text: "#101407" },
  yellow: { hex: "#eab308", text: "#171303" },
  orange: { hex: "#f97316", text: "#1a0b03" },
  red: { hex: "#ef4444", text: "#ffffff" },
  pink: { hex: "#ec4899", text: "#ffffff" },
  purple: { hex: "#a855f7", text: "#ffffff" },
  indigo: { hex: "#6366f1", text: "#ffffff" }
};
const NODE_COLOR_NAMES = Object.keys(NODE_COLORS);
const BACKGROUND_OPTIONS = { system: "Obsidian default", dark: "Dark", paper: "Paper" };
const BACKGROUND_NAMES = Object.keys(BACKGROUND_OPTIONS);
const SPACING_DEFAULTS = { levelSpacing: 100, siblingSpacing: 100, nodePadding: 12, trunkSpacing: 48 };
const SPACING_COMPACT = { levelSpacing: 65, siblingSpacing: 60, nodePadding: 7, trunkSpacing: 30 };
const NODE_STRENGTH_DEFAULTS = {
  darkRootStrength: 100,
  darkLevel1Strength: 75,
  darkLevel2Strength: 50,
  darkDeepStrength: 35,
  lightRootStrength: 100,
  lightLevel1Strength: 75,
  lightLevel2Strength: 50,
  lightDeepStrength: 35
};

function mixHexColor(color, background, amount) {
  const channel = (hex, offset) => parseInt(hex.slice(offset, offset + 2), 16);
  const blend = (foreground, backdrop) => Math.round(foreground * amount + backdrop * (1 - amount));
  const parts = [1, 3, 5].map((offset) => blend(channel(color, offset), channel(background, offset)).toString(16).padStart(2, "0"));
  return `#${parts.join("")}`;
}

function normalizeBackground(background) {
  if (background === "light") return "paper";
  return BACKGROUND_NAMES.includes(background) ? background : "system";
}

function usesLightPalette(background) {
  const normalized = normalizeBackground(background);
  return normalized === "paper" || (normalized === "system" && document.body?.classList.contains("theme-light"));
}

function createBlankMap(appearance = {}, centralNodeText = "Central idea", centralNodeNotes = "") {
  const root = { id: "root", text: centralNodeText, parentId: null, childIds: [], collapsed: false };
  if (centralNodeNotes) root.notes = centralNodeNotes;
  return {
    version: 1,
    appearance: Object.assign({ background: "system", highlight: "blue", layout: "right", dimUnrelated: true, dimStrength: 50, randomBranchColors: false }, SPACING_DEFAULTS, NODE_STRENGTH_DEFAULTS, appearance),
    rootIds: [root.id],
    nodes: { [root.id]: root },
    relationships: []
  };
}

function normalizeSingleRootMap(map, syntheticRootText = "Central idea") {
  if (!map || typeof map !== "object" || !map.nodes || typeof map.nodes !== "object" || Array.isArray(map.nodes) || !Array.isArray(map.rootIds)) return null;
  const entries = Object.entries(map.nodes);
  if (!entries.length || entries.length > 20000) return null;
  const incomingParent = new Map();

  for (const [id, node] of entries) {
    if (!id || !node || typeof node !== "object" || node.id !== id || typeof node.text !== "string" || !Array.isArray(node.childIds)) return null;
    const childIds = [];
    for (const childId of node.childIds) {
      if (typeof childId !== "string" || childId === id || !map.nodes[childId]) return null;
      if (childIds.includes(childId)) continue;
      const existingParent = incomingParent.get(childId);
      if (existingParent && existingParent !== id) return null;
      incomingParent.set(childId, id);
      childIds.push(childId);
    }
    node.childIds = childIds;
    node.collapsed = node.collapsed === true;
    if (node.notes !== undefined && typeof node.notes !== "string") delete node.notes;
    if (node.locked !== true) delete node.locked;
    if (Array.isArray(node.manualChildIds)) {
      node.manualChildIds = [...new Set(node.manualChildIds)].filter((childId) => node.childIds.includes(childId));
      node.childIds.forEach((childId) => { if (!node.manualChildIds.includes(childId)) node.manualChildIds.push(childId); });
    } else {
      delete node.manualChildIds;
    }
    if (!["asc", "desc"].includes(node.childSort)) delete node.childSort;
  }

  const declaredRoots = [...new Set(map.rootIds)].filter((id) => typeof id === "string" && map.nodes[id] && !incomingParent.has(id));
  const structuralRoots = entries.map(([id]) => id).filter((id) => !incomingParent.has(id));
  const rootIds = [...declaredRoots, ...structuralRoots.filter((id) => !declaredRoots.includes(id))];
  if (!rootIds.length) return null;

  const visited = new Set();
  const stack = rootIds.map((id) => ({ id, depth: 0 }));
  while (stack.length) {
    const { id, depth } = stack.pop();
    if (visited.has(id) || depth > 500) return null;
    visited.add(id);
    const node = map.nodes[id];
    node.parentId = incomingParent.get(id) || null;
    node.childIds.forEach((childId) => stack.push({ id: childId, depth: depth + 1 }));
  }
  if (visited.size !== entries.length) return null;

  const relationships = [];
  const relationshipPairs = new Set();
  const relationshipIds = new Set();
  if (Array.isArray(map.relationships)) {
    map.relationships.forEach((relationship, index) => {
      if (!relationship || typeof relationship !== "object") return;
      const fromId = typeof relationship.fromId === "string" ? relationship.fromId : "";
      const toId = typeof relationship.toId === "string" ? relationship.toId : "";
      if (!fromId || !toId || fromId === toId || !map.nodes[fromId] || !map.nodes[toId]) return;
      const pairKey = [fromId, toId].sort().join("\u0000");
      if (relationshipPairs.has(pairKey)) return;
      relationshipPairs.add(pairKey);
      let id = typeof relationship.id === "string" && relationship.id.trim() ? relationship.id.trim() : `relationship-${index + 1}`;
      let suffix = 2;
      const baseId = id;
      while (relationshipIds.has(id)) {
        id = `${baseId}-${suffix}`;
        suffix += 1;
      }
      relationshipIds.add(id);
      relationships.push({ id, fromId, toId });
    });
  }
  map.relationships = relationships;

  let rootId = rootIds[0];
  if (rootIds.length > 1) {
    rootId = "imported-root";
    let suffix = 2;
    while (map.nodes[rootId]) {
      rootId = `imported-root-${suffix}`;
      suffix += 1;
    }
    const cleanRootText = String(syntheticRootText || "Central idea").trim() || "Central idea";
    map.nodes[rootId] = { id: rootId, text: cleanRootText, parentId: null, childIds: [...rootIds], collapsed: false };
    rootIds.forEach((id) => { map.nodes[id].parentId = rootId; });
  } else {
    map.nodes[rootId].parentId = null;
  }
  map.rootIds = [rootId];

  const appearance = map.appearance && typeof map.appearance === "object" && !Array.isArray(map.appearance) ? map.appearance : {};
  appearance.background = normalizeBackground(appearance.background);
  if (!NODE_COLOR_NAMES.includes(appearance.highlight)) delete appearance.highlight;
  if (!["right", "left", "down", "up", "radial"].includes(appearance.layout)) delete appearance.layout;
  if (typeof appearance.dimUnrelated !== "boolean") delete appearance.dimUnrelated;
  if (typeof appearance.randomBranchColors !== "boolean") delete appearance.randomBranchColors;
  const clampSetting = (key, min, max) => {
    if (!(key in appearance)) return;
    const value = Number(appearance[key]);
    if (!Number.isFinite(value)) delete appearance[key];
    else appearance[key] = Math.min(max, Math.max(min, Math.round(value)));
  };
  clampSetting("dimStrength", 0, 90);
  clampSetting("levelSpacing", 65, 300);
  clampSetting("siblingSpacing", 60, 300);
  clampSetting("nodePadding", 7, 24);
  clampSetting("trunkSpacing", 30, 70);
  Object.keys(NODE_STRENGTH_DEFAULTS).forEach((key) => clampSetting(key, 0, 100));
  map.appearance = appearance;

  const inheritedRootColor = NODE_COLOR_NAMES.includes(appearance.highlight) ? appearance.highlight : "blue";
  const colorStack = [{ id: rootId, inheritedColor: inheritedRootColor }];
  while (colorStack.length) {
    const { id, inheritedColor } = colorStack.pop();
    const node = map.nodes[id];
    if (NODE_COLOR_NAMES.includes(node.color)) {
      if (!["manual", "automatic"].includes(node.colorSource)) {
        if (node.color === inheritedColor) {
          delete node.color;
          delete node.colorSource;
        } else if (node.parentId === rootId && appearance.randomBranchColors === true) {
          node.colorSource = "automatic";
        } else {
          node.colorSource = "manual";
        }
      }
    } else {
      delete node.color;
      delete node.colorSource;
    }
    const effectiveColor = NODE_COLOR_NAMES.includes(node.color) ? node.color : inheritedColor;
    node.childIds.forEach((childId) => colorStack.push({ id: childId, inheritedColor: effectiveColor }));
  }
  map.version = 1;
  return map;
}

class NodeEditorModal extends Modal {
  constructor(app, plugin, dialogTitle, node, onSubmit) {
    super(app);
    this.plugin = plugin;
    this.dialogTitle = dialogTitle || "Edit node";
    this.node = node;
    this.onSubmit = onSubmit;
    this.geometrySaveTimer = null;
  }

  onOpen() {
    const { contentEl } = this;
    this.modalEl.addClass("cmm-node-editor-window");
    contentEl.addClass("cmm-node-editor-modal");
    const titleBar = contentEl.createEl("h2", { text: this.dialogTitle, cls: "cmm-node-editor-drag-handle" });
    this.enableDragging(titleBar);
    this.applySavedGeometry();
    let title = this.node.text || "";
    let notes = this.node.notes || "";

    const titleSetting = new Setting(contentEl).setName("Node title");
    titleSetting.addText((text) => {
      text.setValue(title).onChange((value) => (title = value));
      text.inputEl.addClass("cmm-node-editor-title");
      text.inputEl.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || event.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        submit();
      });
      window.setTimeout(() => {
        text.inputEl.focus();
        text.inputEl.select();
      }, 0);
    });

    const notesLabel = contentEl.createEl("label", { text: "Notes", cls: "cmm-node-editor-notes-label" });
    const notesArea = contentEl.createEl("textarea", { cls: "cmm-node-editor-notes" });
    notesArea.value = notes;
    notesArea.setAttr("aria-label", "Notes");
    notesArea.addEventListener("input", () => (notes = notesArea.value));
    notesLabel.htmlFor = notesArea.id = `cmm-node-notes-${Date.now()}`;

    const submit = () => {
      const cleanTitle = title.trim();
      if (!cleanTitle) {
        new Notice("Node title cannot be empty.");
        return;
      }
      this.close();
      this.onSubmit(cleanTitle, notes.trim());
    };
    new Setting(contentEl)
      .addButton((button) => button.setButtonText("Save").setCta().onClick(submit))
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()));

    this.resizeObserver = new ResizeObserver(() => this.scheduleGeometrySave());
    this.resizeObserver.observe(this.modalEl);
  }

  onClose() {
    window.clearTimeout(this.geometrySaveTimer);
    this.captureGeometry();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.dragCleanup?.();
    this.dragCleanup = null;
    this.contentEl.empty();
  }

  enableDragging(handle) {
    const modal = this.modalEl;
    let dragging = false;
    let pointerOffsetX = 0;
    let pointerOffsetY = 0;
    const move = (event) => {
      if (!dragging) return;
      const maxLeft = Math.max(0, window.innerWidth - modal.offsetWidth);
      const maxTop = Math.max(0, window.innerHeight - modal.offsetHeight);
      modal.style.left = `${Math.min(maxLeft, Math.max(0, event.clientX - pointerOffsetX))}px`;
      modal.style.top = `${Math.min(maxTop, Math.max(0, event.clientY - pointerOffsetY))}px`;
    };
    const up = () => {
      dragging = false;
      modal.removeClass("is-dragging");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      this.captureGeometry();
    };
    const down = (event) => {
      if (event.button !== 0) return;
      const rect = modal.getBoundingClientRect();
      dragging = true;
      pointerOffsetX = event.clientX - rect.left;
      pointerOffsetY = event.clientY - rect.top;
      modal.style.position = "fixed";
      modal.style.left = `${rect.left}px`;
      modal.style.top = `${rect.top}px`;
      modal.style.right = "auto";
      modal.style.bottom = "auto";
      modal.style.margin = "0";
      modal.style.transform = "none";
      modal.addClass("is-dragging");
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      event.preventDefault();
    };
    handle.addEventListener("pointerdown", down);
    this.dragCleanup = () => {
      dragging = false;
      handle.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }

  applySavedGeometry() {
    const saved = this.plugin.data.nodeEditorGeometry || {};
    if (Number.isFinite(saved.width)) this.modalEl.style.width = `${Math.max(420, Math.min(window.innerWidth - 8, saved.width))}px`;
    if (Number.isFinite(saved.height)) this.modalEl.style.height = `${Math.max(330, Math.min(window.innerHeight - 8, saved.height))}px`;
    if (!Number.isFinite(saved.left) || !Number.isFinite(saved.top)) return;
    window.setTimeout(() => {
      const maxLeft = Math.max(0, window.innerWidth - this.modalEl.offsetWidth);
      const maxTop = Math.max(0, window.innerHeight - this.modalEl.offsetHeight);
      this.modalEl.style.position = "fixed";
      this.modalEl.style.left = `${Math.min(maxLeft, Math.max(0, saved.left))}px`;
      this.modalEl.style.top = `${Math.min(maxTop, Math.max(0, saved.top))}px`;
      this.modalEl.style.right = "auto";
      this.modalEl.style.bottom = "auto";
      this.modalEl.style.margin = "0";
      this.modalEl.style.transform = "none";
    }, 0);
  }

  scheduleGeometrySave() {
    window.clearTimeout(this.geometrySaveTimer);
    this.geometrySaveTimer = window.setTimeout(() => this.captureGeometry(), 250);
  }

  captureGeometry() {
    if (!this.modalEl?.isConnected) return;
    const rect = this.modalEl.getBoundingClientRect();
    this.plugin.data.nodeEditorGeometry = {
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
    this.plugin.savePluginData();
  }
}

class DeleteSubtreeConfirmModal extends Modal {
  constructor(app, nodeText, nodeCount, onConfirm) {
    super(app);
    this.nodeText = nodeText;
    this.nodeCount = nodeCount;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;
    const descendantCount = this.nodeCount - 1;
    contentEl.createEl("h2", { text: "Delete subtree?" });
    contentEl.createEl("p", {
      text: `Delete “${this.nodeText}” and ${descendantCount} ${descendantCount === 1 ? "descendant" : "descendants"}? This will remove ${this.nodeCount} nodes.`
    });
    new Setting(contentEl)
      .addButton((button) => button
        .setButtonText("Delete")
        .setWarning()
        .onClick(() => {
          this.close();
          this.onConfirm();
        }))
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()));
  }

  onClose() {
    this.contentEl.empty();
  }
}

class OutlineExportWarningModal extends Modal {
  constructor(app, format, onConfirm) {
    super(app);
    this.format = format;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: `Export ${this.format}?` });
    contentEl.createEl("p", {
      text: `${this.format} export includes node titles and hierarchy only. Notes, relationships, folding, locks, colors, layout, and other appearance settings are omitted.`
    });
    new Setting(contentEl)
      .addButton((button) => button.setButtonText("Continue export").setCta().onClick(() => {
        this.close();
        this.onConfirm();
      }))
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()));
  }

  onClose() {
    this.contentEl.empty();
  }
}

class MarkdownFileSuggestModal extends FuzzySuggestModal {
  constructor(app, onChoose) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder("Choose a Markdown outline to import");
  }

  getItems() {
    return this.app.vault.getMarkdownFiles().sort((a, b) => a.path.localeCompare(b.path));
  }

  getItemText(file) {
    return file.path;
  }

  onChooseItem(file) {
    this.onChoose(file);
  }
}

class MapSettingsModal extends Modal {
  constructor(app, appearance, onSave) {
    super(app);
    this.values = Object.assign({}, appearance);
    this.onSave = onSave;
  }

  onOpen() {
    const { contentEl } = this;
    this.modalEl.addClass("cmm-map-settings-window");
    contentEl.addClass("cmm-map-settings-modal");
    this.values = Object.assign({}, SPACING_DEFAULTS, NODE_STRENGTH_DEFAULTS, this.values);
    const title = contentEl.createEl("h2", { text: "Map settings", cls: "cmm-map-settings-drag-handle" });
    this.enableDragging(title);

    const body = contentEl.createDiv({ cls: "cmm-map-settings-body" });
    const controls = body.createDiv({ cls: "cmm-map-settings-controls" });
    const previewPane = body.createDiv({ cls: "cmm-map-settings-preview-pane" });
    const previewHeader = previewPane.createDiv({ cls: "cmm-preview-header" });
    previewHeader.createEl("h3", { text: "Live preview" });
    const previewControls = previewHeader.createDiv({ cls: "cmm-preview-controls" });
    this.previewZoomOutButton = previewControls.createEl("button", { text: "−", attr: { type: "button", "aria-label": "Zoom preview out" } });
    this.previewZoomInButton = previewControls.createEl("button", { text: "+", attr: { type: "button", "aria-label": "Zoom preview in" } });
    this.previewResetButton = previewControls.createEl("button", { text: "Reset view", attr: { type: "button" } });
    this.previewZoomOutButton.addEventListener("click", () => this.zoomPreview(1.25));
    this.previewZoomInButton.addEventListener("click", () => this.zoomPreview(0.8));
    this.previewResetButton.addEventListener("click", () => this.resetPreviewView());
    const preview = previewPane.createDiv({ cls: "cmm-spacing-preview" });
    this.previewEl = preview;
    this.renderPreview();

    new Setting(controls).setName("Background").addDropdown((dropdown) => {
      Object.entries(BACKGROUND_OPTIONS).forEach(([value, label]) => dropdown.addOption(value, label));
      dropdown.setValue(this.values.background).onChange((value) => { this.values.background = value; this.renderPreview(); });
    });

    new Setting(controls).setName("Highlight color").addDropdown((dropdown) => {
      NODE_COLOR_NAMES.forEach((color) => dropdown.addOption(color, color.charAt(0).toUpperCase() + color.slice(1)));
      dropdown.setValue(this.values.highlight).onChange((value) => { this.values.highlight = value; this.renderPreview(); });
    });

    new Setting(controls).setName("Layout").addDropdown((dropdown) => {
      ["right", "left", "down", "up", "radial"].forEach((layout) => dropdown.addOption(layout, layout.charAt(0).toUpperCase() + layout.slice(1)));
      dropdown.setValue(this.values.layout).onChange((value) => { this.values.layout = value; this.renderPreview(true); });
    });

    new Setting(controls)
      .setName("Dim unrelated branches")
      .setDesc("When a non-root node is selected, fade branches outside its path and descendants.")
      .addToggle((toggle) => toggle
        .setValue(this.values.dimUnrelated !== false)
        .onChange((value) => (this.values.dimUnrelated = value)));

    new Setting(controls)
      .setName("Dim strength")
      .setDesc("0% leaves unrelated branches unchanged; 90% makes them very faint.")
      .addSlider((slider) => slider
        .setLimits(0, 90, 5)
        .setValue(Number.isFinite(this.values.dimStrength) ? this.values.dimStrength : 50)
        .setDynamicTooltip()
        .onChange((value) => (this.values.dimStrength = value)));

    new Setting(controls)
      .setName("Random colors for new branches")
      .setDesc("Give each newly created child of the central node a random branch color. Descendants inherit that color.")
      .addToggle((toggle) => toggle
        .setValue(this.values.randomBranchColors === true)
        .onChange((value) => (this.values.randomBranchColors = value)));

    controls.createEl("h3", { text: "Node color strength", cls: "cmm-spacing-heading" });
    controls.createEl("p", { text: "Choose how strongly each node level uses its branch color. The rest is blended with the map background.", cls: "setting-item-description" });
    controls.createEl("h4", { text: "Dark background", cls: "cmm-node-strength-heading" });
    this.addStrengthSlider(controls, "Central node", "darkRootStrength");
    this.addStrengthSlider(controls, "Level 1", "darkLevel1Strength");
    this.addStrengthSlider(controls, "Level 2", "darkLevel2Strength");
    this.addStrengthSlider(controls, "Level 3 and deeper", "darkDeepStrength");
    controls.createEl("h4", { text: "Light and paper backgrounds", cls: "cmm-node-strength-heading" });
    this.addStrengthSlider(controls, "Central node", "lightRootStrength");
    this.addStrengthSlider(controls, "Level 1", "lightLevel1Strength");
    this.addStrengthSlider(controls, "Level 2", "lightLevel2Strength");
    this.addStrengthSlider(controls, "Level 3 and deeper", "lightDeepStrength");

    controls.createEl("h3", { text: "Map spacing", cls: "cmm-spacing-heading" });
    this.addSpacingSlider(controls, "Level spacing", "Distance between parent and child levels. 100 is the original spacing.", "levelSpacing", 65, 300, 5);
    this.addSpacingSlider(controls, "Sibling spacing", "Distance between nodes at the same level. 100 is the original spacing.", "siblingSpacing", 60, 300, 5);
    this.addSpacingSlider(controls, "Node padding", "Space around text inside each node, in pixels.", "nodePadding", 7, 24, 1);
    this.addSpacingSlider(controls, "Connector trunk spacing", "Percentage of the path used before connectors curve apart.", "trunkSpacing", 30, 70, 2);

    new Setting(controls)
      .addButton((button) => button.setButtonText("Compact").onClick(() => {
        Object.assign(this.values, SPACING_COMPACT);
        this.spacingSliders.forEach(({ key, slider }) => slider.setValue(this.values[key]));
        this.renderPreview();
      }))
      .addButton((button) => button.setButtonText("Save").setCta().onClick(() => {
        this.close();
        this.onSave(this.values);
      }))
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()));
  }

  onClose() {
    this.previewPanCleanup?.();
    this.previewPanCleanup = null;
    if (this.dragCleanup) this.dragCleanup();
    this.contentEl.empty();
  }

  addSpacingSlider(containerEl, name, description, key, min, max, step) {
    if (!this.spacingSliders) this.spacingSliders = [];
    const setting = new Setting(containerEl).setName(name).setDesc(description);
    let sliderComponent;
    setting.addSlider((slider) => {
      sliderComponent = slider;
      slider.setLimits(min, max, step)
        .setValue(this.values[key])
        .setDynamicTooltip()
        .onChange((value) => {
          this.values[key] = value;
          this.renderPreview();
        });
    });
    setting.addExtraButton((button) => button
      .setIcon("rotate-ccw")
      .setTooltip(`Reset ${name.toLowerCase()}`)
      .onClick(() => {
        this.values[key] = SPACING_DEFAULTS[key];
        sliderComponent.setValue(this.values[key]);
        this.renderPreview();
      }));
    this.spacingSliders.push({ key, slider: sliderComponent });
  }

  addStrengthSlider(containerEl, name, key) {
    const setting = new Setting(containerEl).setName(name);
    let sliderComponent;
    setting.addSlider((slider) => {
      sliderComponent = slider;
      slider.setLimits(0, 100, 5)
        .setValue(this.values[key])
        .setDynamicTooltip()
        .onChange((value) => {
          this.values[key] = value;
          this.renderPreview();
        });
    });
    setting.addExtraButton((button) => button
      .setIcon("rotate-ccw")
      .setTooltip(`Reset ${name.toLowerCase()}`)
      .onClick(() => {
        this.values[key] = NODE_STRENGTH_DEFAULTS[key];
        sliderComponent.setValue(this.values[key]);
        this.renderPreview();
      }));
  }

  renderPreview(resetView = false) {
    if (!this.previewEl) return;
    this.previewPanCleanup?.();
    this.previewPanCleanup = null;
    this.previewEl.empty();
    const dark = !usesLightPalette(this.values.background);
    const color = NODE_COLORS[this.values.highlight] || NODE_COLORS.blue;
    const accent = color.hex;
    this.previewEl.toggleClass("is-dark", dark);
    this.previewEl.toggleClass("is-light", !dark);
    this.previewEl.toggleClass("is-paper", normalizeBackground(this.values.background) === "paper");
    this.previewEl.toggleClass("is-system", normalizeBackground(this.values.background) === "system");
    this.previewEl.style.setProperty("--cmm-preview-accent", accent);
    const sampleNodes = {
      root: { id: "root", text: "Main", parentId: null, childIds: ["plan", "build"], collapsed: false },
      plan: { id: "plan", text: "Plan", parentId: "root", childIds: ["step", "schedule"], collapsed: false },
      build: { id: "build", text: "Build", parentId: "root", childIds: ["review", "finish"], collapsed: false },
      step: { id: "step", text: "Step", parentId: "plan", childIds: ["detail"], collapsed: false },
      schedule: { id: "schedule", text: "Schedule", parentId: "plan", childIds: [], collapsed: false },
      detail: { id: "detail", text: "Detail", parentId: "step", childIds: [], collapsed: false },
      review: { id: "review", text: "Review", parentId: "build", childIds: [], collapsed: false },
      finish: { id: "finish", text: "Finish", parentId: "build", childIds: [], collapsed: false }
    };
    const previewView = Object.create(KempfSimpleMindMapView.prototype);
    previewView.mapData = { version: 1, appearance: Object.assign({}, this.values), rootIds: ["root"], nodes: sampleNodes };
    previewView.plugin = { getDefaultAppearance: () => ({ background: this.values.background, highlight: this.values.highlight, layout: this.values.layout }) };
    previewView.focusedId = null;
    const positions = previewView.layout();
    const mode = this.values.layout || "right";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const viewBoxes = {
      right: { x: -180, y: -80, width: 1200, height: 600 },
      left: { x: -1020, y: -80, width: 1200, height: 600 },
      down: { x: -120, y: -100, width: 1000, height: 750 },
      up: { x: -120, y: -550, width: 1000, height: 750 },
      radial: { x: -1000, y: -80, width: 2000, height: 800 }
    };
    const baseView = viewBoxes[mode] || viewBoxes.right;
    if (resetView || !this.previewViewState || this.previewViewState.mode !== mode) {
      this.previewViewState = { mode, ...baseView, baseWidth: baseView.width, baseHeight: baseView.height };
    }
    this.previewSvg = svg;
    this.applyPreviewViewBox();
    svg.setAttribute("aria-label", "Live spacing preview");
    Object.values(sampleNodes).forEach((node) => {
      const from = positions[node.id];
      if (!from) return;
      const fromSize = previewView.nodeDimensions(from.depth);
      const fromCenter = { x: from.x + fromSize.width / 2, y: from.y + fromSize.height / 2 };
      node.childIds.forEach((childId) => {
        const to = positions[childId];
        if (!to) return;
        const toSize = previewView.nodeDimensions(to.depth);
        const toCenter = { x: to.x + toSize.width / 2, y: to.y + toSize.height / 2 };
        const direction = mode === "radial" ? (toCenter.x >= fromCenter.x ? "right" : "left") : mode;
        const start = previewView.connectorAnchor(from, fromSize, direction, true);
        const end = previewView.connectorAnchor(to, toSize, direction, false);
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", previewView.connectorPath(start, end, direction));
        path.setAttribute("class", "cmm-preview-edge");
        path.style.stroke = previewView.nodeDisplayColor(this.values.highlight, from.depth);
        path.style.strokeWidth = `${to.depth === 1 ? 4 : to.depth === 2 ? 3 : 2}px`;
        svg.appendChild(path);
      });
    });
    Object.entries(positions).forEach(([nodeId, position]) => {
      const node = sampleNodes[nodeId];
      const size = previewView.nodeDimensions(position.depth);
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("x", position.x); rect.setAttribute("y", position.y); rect.setAttribute("width", size.width); rect.setAttribute("height", size.height); rect.setAttribute("rx", "10");
      rect.setAttribute("class", position.depth === 0 ? "cmm-preview-root" : "cmm-preview-node");
      const normalizedBackground = normalizeBackground(this.values.background);
      const background = normalizedBackground === "paper" ? "#f7f3e8" : dark ? "#11151c" : "#ffffff";
      const prefix = dark ? "dark" : "light";
      const strengthKey = position.depth === 0 ? `${prefix}RootStrength` : position.depth === 1 ? `${prefix}Level1Strength` : position.depth === 2 ? `${prefix}Level2Strength` : `${prefix}DeepStrength`;
      rect.style.fill = mixHexColor(accent, background, this.values[strengthKey] / 100);
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", position.x + size.width / 2); text.setAttribute("y", position.y + size.height / 2 + 5); text.setAttribute("class", `cmm-preview-label${position.depth === 0 ? " is-root" : ""}`); text.textContent = node.text;
      if (position.depth === 0) text.style.fill = color.text;
      svg.append(rect, text);
    });
    this.previewEl.appendChild(svg);
    this.installPreviewNavigation(svg);
    this.updatePreviewZoomButtons();
  }

  applyPreviewViewBox() {
    if (!this.previewSvg || !this.previewViewState) return;
    const view = this.previewViewState;
    this.previewSvg.setAttribute("viewBox", `${view.x} ${view.y} ${view.width} ${view.height}`);
  }

  zoomPreview(factor, clientX = null, clientY = null) {
    if (!this.previewSvg || !this.previewViewState) return;
    const view = this.previewViewState;
    const rect = this.previewSvg.getBoundingClientRect();
    const anchorX = clientX == null || !rect.width ? view.x + view.width / 2 : view.x + (clientX - rect.left) / rect.width * view.width;
    const anchorY = clientY == null || !rect.height ? view.y + view.height / 2 : view.y + (clientY - rect.top) / rect.height * view.height;
    const nextWidth = Math.min(view.baseWidth * 4, Math.max(view.baseWidth * 0.2, view.width * factor));
    const nextHeight = Math.min(view.baseHeight * 4, Math.max(view.baseHeight * 0.2, view.height * factor));
    const widthRatio = nextWidth / view.width;
    const heightRatio = nextHeight / view.height;
    view.x = anchorX - (anchorX - view.x) * widthRatio;
    view.y = anchorY - (anchorY - view.y) * heightRatio;
    view.width = nextWidth;
    view.height = nextHeight;
    this.applyPreviewViewBox();
    this.updatePreviewZoomButtons();
  }

  resetPreviewView() {
    if (!this.previewViewState) return;
    const mode = this.values.layout || "right";
    this.previewViewState = null;
    this.renderPreview(true);
    if (this.previewViewState) this.previewViewState.mode = mode;
  }

  updatePreviewZoomButtons() {
    if (!this.previewViewState) return;
    const ratio = this.previewViewState.width / this.previewViewState.baseWidth;
    if (this.previewZoomInButton) this.previewZoomInButton.disabled = ratio <= 0.200001;
    if (this.previewZoomOutButton) this.previewZoomOutButton.disabled = ratio >= 3.999999;
  }

  installPreviewNavigation(svg) {
    svg.addEventListener("wheel", (event) => {
      event.preventDefault();
      this.zoomPreview(event.deltaY < 0 ? 0.82 : 1.22, event.clientX, event.clientY);
    }, { passive: false });
    svg.addEventListener("pointerdown", (event) => {
      const leftBackgroundPan = event.button === 0 && event.target === svg;
      const middlePan = event.button === 1;
      if (!leftBackgroundPan && !middlePan) return;
      event.preventDefault();
      const startX = event.clientX;
      const startY = event.clientY;
      const startViewX = this.previewViewState.x;
      const startViewY = this.previewViewState.y;
      const rect = svg.getBoundingClientRect();
      this.previewEl.addClass("is-panning");
      const move = (moveEvent) => {
        if (!this.previewViewState) return;
        this.previewViewState.x = startViewX - (moveEvent.clientX - startX) / Math.max(1, rect.width) * this.previewViewState.width;
        this.previewViewState.y = startViewY - (moveEvent.clientY - startY) / Math.max(1, rect.height) * this.previewViewState.height;
        this.applyPreviewViewBox();
      };
      const up = () => {
        this.previewEl?.removeClass("is-panning");
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        this.previewPanCleanup = null;
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      this.previewPanCleanup = up;
    });
  }

  enableDragging(handle) {
    const modal = this.modalEl;
    if (!modal) return;
    let dragging = false;
    let pointerOffsetX = 0;
    let pointerOffsetY = 0;

    const move = (event) => {
      if (!dragging) return;
      const rect = modal.getBoundingClientRect();
      const left = Math.min(Math.max(0, event.clientX - pointerOffsetX), Math.max(0, window.innerWidth - rect.width));
      const top = Math.min(Math.max(0, event.clientY - pointerOffsetY), Math.max(0, window.innerHeight - rect.height));
      modal.style.left = `${left}px`;
      modal.style.top = `${top}px`;
    };
    const up = () => {
      dragging = false;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    const down = (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const rect = modal.getBoundingClientRect();
      dragging = true;
      pointerOffsetX = event.clientX - rect.left;
      pointerOffsetY = event.clientY - rect.top;
      modal.style.position = "fixed";
      modal.style.left = `${rect.left}px`;
      modal.style.top = `${rect.top}px`;
      modal.style.right = "auto";
      modal.style.bottom = "auto";
      modal.style.margin = "0";
      modal.style.transform = "none";
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };
    handle.addEventListener("pointerdown", down);
    this.dragCleanup = () => {
      dragging = false;
      handle.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }
}

class KempfSimpleMindMapView extends TextFileView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.selectedId = null;
    this.draggedId = null;
    this.dropTargetId = null;
    this.dropPlacement = null;
    this.scale = 1;
    this.offsetX = 40;
    this.offsetY = 80;
    this.panning = false;
    this.backgroundPanMoved = false;
    this.undoStack = [];
    this.redoStack = [];
    this.focusedId = null;
    this.nodeTooltipTimer = null;
    this.nodeTooltipEl = null;
    this.notesPreviewTimer = null;
    this.notesPreviewEl = null;
    this.invalidSource = null;
    this.isMobile = Boolean(Platform?.isMobile);
    this.mobileSheetEl = null;
    this.suppressClickUntil = 0;
    this.mobileGesture = null;
    this.searchPanelEl = null;
    this.searchMatches = [];
    this.searchIndex = -1;
    this.relationshipSourceId = null;
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return this.file ? this.file.basename : "The Kempf Simple Mind Map"; }
  getIcon() { return "list-tree"; }

  getViewData() {
    if (this.invalidSource !== null) return this.invalidSource;
    return JSON.stringify(this.mapData || createBlankMap(), null, 2);
  }

  setViewData(data) {
    try {
      const parsed = JSON.parse(data);
      const normalized = normalizeSingleRootMap(parsed, this.file?.basename || "Central idea");
      if (!normalized) throw new Error("Invalid map structure");
      this.invalidSource = null;
      this.mapData = normalized;
    } catch (error) {
      this.invalidSource = String(data ?? "");
      this.mapData = createBlankMap(this.plugin.getDefaultAppearance());
      new Notice("This .ksmm file is invalid. A read-only blank preview was opened; the original file will not be overwritten.");
    }
    this.mapData.appearance = Object.assign({}, this.plugin.getDefaultAppearance(), this.mapData.appearance || {});
    this.undoStack = [];
    this.redoStack = [];
    this.selectedId = null;
    this.focusedId = null;
    this.relationshipSourceId = null;
    this.syncAppearanceControls();
    this.render();
    if (this.viewport) this.centerMap();
  }

  clear() {
    this.mapData = createBlankMap(this.plugin.getDefaultAppearance());
    this.undoStack = [];
    this.redoStack = [];
    this.selectedId = null;
    this.focusedId = null;
    this.relationshipSourceId = null;
    this.render();
  }

  async saveMap() {
    if (this.invalidSource !== null) {
      new Notice("This invalid .ksmm file is read-only. Its original contents were not changed.");
      return false;
    }
    this.requestSave();
    return true;
  }

  mapSnapshot() {
    return JSON.stringify(this.mapData || createBlankMap(this.plugin.getDefaultAppearance()));
  }

  recordUndoState() {
    const snapshot = this.mapSnapshot();
    if (this.undoStack[this.undoStack.length - 1] !== snapshot) {
      this.undoStack.push(snapshot);
      if (this.undoStack.length > 100) this.undoStack.shift();
    }
    this.redoStack = [];
    this.updateToolbarButtons();
  }

  async restoreSnapshot(snapshot) {
    const viewportState = {
      scale: this.scale,
      offsetX: this.offsetX,
      offsetY: this.offsetY
    };
    this.mapData = JSON.parse(snapshot);
    this.selectedId = null;
    this.focusedId = null;
    this.relationshipSourceId = null;
    this.syncAppearanceControls();
    await this.saveMap();
    this.render();
    this.scale = viewportState.scale;
    this.offsetX = viewportState.offsetX;
    this.offsetY = viewportState.offsetY;
    this.applyTransform();
    this.updateToolbarButtons();
  }

  async undo() {
    if (!this.undoStack.length) {
      new Notice("Nothing to undo.");
      return;
    }
    this.redoStack.push(this.mapSnapshot());
    await this.restoreSnapshot(this.undoStack.pop());
  }

  async redo() {
    if (!this.redoStack.length) {
      new Notice("Nothing to redo.");
      return;
    }
    this.undoStack.push(this.mapSnapshot());
    await this.restoreSnapshot(this.redoStack.pop());
  }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass("kempfs-simple-mind-map-view");
    const appearance = this.getAppearance();
    this.applyAppearance(appearance.background, appearance.highlight);
    this.registerEvent(this.app.workspace.on("css-change", () => {
      const current = this.getAppearance();
      if (current.background !== "system") return;
      this.applyAppearance(current.background, current.highlight);
      this.render();
    }));

    const toolbar = this.contentEl.createDiv({ cls: "cmm-toolbar" });
    if (this.isMobile) toolbar.addClass("is-mobile");
    const title = toolbar.createEl("strong", { text: "The Kempf Simple Mind Map" });
    title.setAttr("aria-label", "The Kempf Simple Mind Map");
    this.focusStatus = toolbar.createDiv({ cls: "cmm-focus-status" });
    this.focusStatusLabel = this.focusStatus.createSpan({ cls: "cmm-focus-status-label" });
    this.focusExitButton = this.focusStatus.createEl("button", { text: "Exit focus", cls: "cmm-focus-exit" });
    this.focusExitButton.addEventListener("click", () => this.clearBranchFocus());
    this.undoButton = this.addToolbarButton(toolbar, "Undo", "undo-2", () => this.undo(), "↶");
    this.redoButton = this.addToolbarButton(toolbar, "Redo", "redo-2", () => this.redo(), "↷");
    if (this.isMobile) {
      this.addToolbarButton(toolbar, "Add child", "corner-down-right", () => this.mobileSelectedAction("child"), "+C");
      this.addToolbarButton(toolbar, "Add sibling", "plus", () => this.mobileSelectedAction("sibling"), "+S");
      this.addToolbarButton(toolbar, "Edit selected node", "pencil", () => this.mobileSelectedAction("edit"), "Edit");
      this.addToolbarButton(toolbar, "Full map", "maximize", () => this.showFullMap(), "Fit");
      this.addToolbarButton(toolbar, "More options", "ellipsis", () => this.showMobileBackgroundSheet(), "⋯");
    } else {
      this.zoomOutButton = this.addToolbarButton(toolbar, "Zoom out", "minus", () => this.zoomBy(0.85), "−");
      this.zoomInButton = this.addToolbarButton(toolbar, "Zoom in", "plus", () => this.zoomBy(1.18), "+");
      this.addToolbarButton(toolbar, "Center map", "focus", () => this.centerMap());
      this.addToolbarButton(toolbar, "Search nodes", "search", () => this.showNodeSearch(), "Search");
      this.addToolbarButton(toolbar, "Map settings", "settings", () => this.showMapSettings(), "Options");
      this.addToolbarButton(toolbar, "Help", "circle-help", () => this.showHelp(), "?");
    }

    this.viewport = this.contentEl.createDiv({ cls: "cmm-viewport", attr: { tabindex: "0" } });
    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svg.setAttribute("class", "cmm-svg");
    this.viewport.appendChild(this.svg);
    this.scene = document.createElementNS("http://www.w3.org/2000/svg", "g");
    this.svg.appendChild(this.scene);

    this.viewport.addEventListener("keydown", (event) => this.onKeyDown(event));
    this.viewport.addEventListener("wheel", (event) => this.onWheel(event), { passive: false });
    this.viewport.addEventListener("pointerdown", (event) => this.onBackgroundPointerDown(event));
    this.viewport.addEventListener("click", (event) => this.onBackgroundClick(event));
    this.viewport.addEventListener("contextmenu", (event) => {
      if (event.target === this.svg) {
        event.preventDefault();
        this.viewport.focus();
        if (this.isMobile) this.showMobileBackgroundSheet();
        else this.showBackgroundMenu(event);
      }
    });
    this.installMobileGestures();
    this.installLongPress(this.svg, () => this.showMobileBackgroundSheet(), () => this.panning || this.mobileGesture?.type === "pinch");
    this.render();
    this.centerMap();
    this.updateToolbarButtons();
    this.installHeaderRename();
  }

  installHeaderRename() {
    if (!this.containerEl || this.headerRenameHandler) return;
    this.containerEl.addClass("cmm-renamable-view");
    this.headerRenameHandler = (event) => {
      const target = event.target && event.target.closest ? event.target.closest(".view-header-title") : null;
      if (!target || !this.containerEl.contains(target)) return;
      event.preventDefault();
      event.stopPropagation();
      this.beginHeaderRename(target);
    };
    this.containerEl.addEventListener("click", this.headerRenameHandler);
  }

  beginHeaderRename(titleEl) {
    if (!this.file || this.headerRenameInput || !titleEl || !titleEl.parentElement) return;
    const file = this.file;
    const originalName = file.basename;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "cmm-header-rename-input";
    input.value = originalName;
    input.setAttribute("aria-label", "Rename mind map");
    this.headerRenameInput = input;
    titleEl.replaceWith(input);

    let finished = false;
    const restoreTitle = () => {
      if (input.isConnected) input.replaceWith(titleEl);
      titleEl.textContent = this.file ? this.file.basename : originalName;
      this.headerRenameInput = null;
    };
    const cancel = () => {
      if (finished) return;
      finished = true;
      restoreTitle();
    };
    const commit = async () => {
      if (finished) return;
      finished = true;
      let nextName = input.value.trim();
      if (nextName.toLowerCase().endsWith(".ksmm")) nextName = nextName.slice(0, -5).trim();
      if (!nextName || nextName === "." || nextName === ".." || /[<>:"/\\|?*\u0000-\u001F]/.test(nextName)) {
        new Notice("Enter a valid filename.");
        finished = false;
        input.focus();
        input.select();
        return;
      }
      if (nextName === originalName) {
        restoreTitle();
        return;
      }
      const parentPath = file.parent && file.parent.path !== "/" ? file.parent.path : "";
      const nextPath = normalizePath(`${parentPath ? `${parentPath}/` : ""}${nextName}.ksmm`);
      const existing = this.app.vault.getAbstractFileByPath(nextPath);
      if (existing && existing !== file) {
        new Notice("A file with that name already exists.");
        finished = false;
        input.focus();
        input.select();
        return;
      }
      try {
        if (this.app.fileManager && this.app.fileManager.renameFile) {
          await this.app.fileManager.renameFile(file, nextPath);
        } else {
          await this.app.vault.rename(file, nextPath);
        }
        restoreTitle();
      } catch (error) {
        new Notice(error && error.message ? error.message : "The mind map could not be renamed.");
        finished = false;
        input.focus();
        input.select();
      }
    };

    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("pointerdown", (event) => event.stopPropagation());
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commit();
      } else if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      }
    });
    input.addEventListener("blur", () => commit());
    input.focus();
    input.select();
  }

  addToolbarButton(parent, label, icon, handler, displayText = label) {
    const button = parent.createEl("button", { cls: "clickable-icon", attr: { "aria-label": label } });
    button.setText(displayText);
    button.addEventListener("click", handler);
    return button;
  }

  mobileSelectedAction(action) {
    const id = this.activeSelectedNodeId();
    if (!id) {
      new Notice("Select a node first.");
      return;
    }
    if (action === "child") this.addChild(id);
    else if (action === "sibling") {
      if (!this.getNode(id)?.parentId) new Notice("The central node cannot have a sibling.");
      else this.addSibling(id);
    } else if (action === "edit") this.editNode(id);
  }

  closeMobileSheet() {
    this.mobileSheetEl?.remove();
    this.mobileSheetEl = null;
  }

  showMobileSheet(title, items) {
    this.closeMobileSheet();
    const overlay = document.body.createDiv({ cls: "cmm-mobile-sheet-overlay" });
    const sheet = overlay.createDiv({ cls: "cmm-mobile-sheet", attr: { role: "dialog", "aria-label": title } });
    const header = sheet.createDiv({ cls: "cmm-mobile-sheet-header" });
    header.createEl("strong", { text: title });
    const close = header.createEl("button", { text: "×", attr: { "aria-label": "Close menu" } });
    close.addEventListener("click", () => this.closeMobileSheet());
    const body = sheet.createDiv({ cls: "cmm-mobile-sheet-body" });
    items.forEach((item) => {
      if (item.separator) {
        body.createDiv({ cls: "cmm-mobile-sheet-separator" });
        return;
      }
      const button = body.createEl("button", { text: item.label, cls: item.danger ? "is-danger" : "" });
      button.disabled = Boolean(item.disabled);
      button.addEventListener("click", () => {
        this.closeMobileSheet();
        item.action?.();
      });
    });
    overlay.addEventListener("pointerdown", (event) => {
      if (event.target === overlay) this.closeMobileSheet();
    });
    this.mobileSheetEl = overlay;
  }

  installLongPress(element, callback, blocked = () => false) {
    let timer = null;
    let startX = 0;
    let startY = 0;
    const cancel = () => {
      window.clearTimeout(timer);
      timer = null;
    };
    element.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" || event.button !== 0) return;
      if (element === this.svg && event.target !== this.svg) return;
      startX = event.clientX;
      startY = event.clientY;
      cancel();
      timer = window.setTimeout(() => {
        timer = null;
        if (blocked()) return;
        this.suppressClickUntil = Date.now() + 700;
        callback(event);
      }, 550);
    });
    element.addEventListener("pointermove", (event) => {
      if (timer && Math.hypot(event.clientX - startX, event.clientY - startY) > 10) cancel();
    });
    element.addEventListener("pointerup", cancel);
    element.addEventListener("pointercancel", cancel);
  }

  installMobileGestures() {
    let start = null;
    const distance = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    this.viewport.addEventListener("touchstart", (event) => {
      event.stopPropagation();
      this.hideNodeTooltip();
      this.hideNotesPreview();
      if (event.touches.length === 2) {
        event.preventDefault();
        const rect = this.viewport.getBoundingClientRect();
        const cx = (event.touches[0].clientX + event.touches[1].clientX) / 2 - rect.left;
        const cy = (event.touches[0].clientY + event.touches[1].clientY) / 2 - rect.top;
        start = { type: "pinch", distance: distance(event.touches[0], event.touches[1]), scale: this.scale, mapX: (cx - this.offsetX) / this.scale, mapY: (cy - this.offsetY) / this.scale };
      } else if (event.touches.length === 1) {
        start = { type: "pan", x: event.touches[0].clientX, y: event.touches[0].clientY, offsetX: this.offsetX, offsetY: this.offsetY, moved: false };
      }
      this.mobileGesture = start;
    }, { passive: false });
    this.viewport.addEventListener("touchmove", (event) => {
      event.stopPropagation();
      if (!start) return;
      if (start.type === "pinch" && event.touches.length === 2) {
        event.preventDefault();
        const rect = this.viewport.getBoundingClientRect();
        const cx = (event.touches[0].clientX + event.touches[1].clientX) / 2 - rect.left;
        const cy = (event.touches[0].clientY + event.touches[1].clientY) / 2 - rect.top;
        this.scale = Math.min(2.5, Math.max(0.1, start.scale * distance(event.touches[0], event.touches[1]) / Math.max(1, start.distance)));
        this.offsetX = cx - start.mapX * this.scale;
        this.offsetY = cy - start.mapY * this.scale;
        this.applyTransform();
      } else if (start.type === "pan" && event.touches.length === 1) {
        event.preventDefault();
        const touch = event.touches[0];
        if (Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > 6) {
          start.moved = true;
          this.suppressClickUntil = Date.now() + 350;
        }
        this.offsetX = start.offsetX + touch.clientX - start.x;
        this.offsetY = start.offsetY + touch.clientY - start.y;
        this.backgroundPanMoved = start.moved;
        this.applyTransform();
      }
    }, { passive: false });
    const finish = (event) => {
      event.stopPropagation();
      if (event.touches?.length === 1 && start?.type === "pinch") {
        const touch = event.touches[0];
        start = { type: "pan", x: touch.clientX, y: touch.clientY, offsetX: this.offsetX, offsetY: this.offsetY, moved: false };
      } else if (!event.touches?.length) start = null;
      this.mobileGesture = start;
    };
    this.viewport.addEventListener("touchend", finish, { passive: false });
    this.viewport.addEventListener("touchcancel", finish, { passive: false });
  }

  updateToolbarButtons() {
    if (this.undoButton) this.undoButton.disabled = this.undoStack.length === 0;
    if (this.redoButton) this.redoButton.disabled = this.redoStack.length === 0;
    if (this.zoomOutButton) this.zoomOutButton.disabled = this.scale <= 0.100001;
    if (this.zoomInButton) this.zoomInButton.disabled = this.scale >= 2.499999;
  }

  updateFocusStatus() {
    if (!this.focusStatus) return;
    const focused = this.focusedId ? this.getNode(this.focusedId) : null;
    this.focusStatus.hidden = !focused;
    if (!focused) return;
    const hiddenCount = Object.keys(this.map.nodes).filter((nodeId) => !this.isVisibleInFocus(nodeId)).length;
    const name = focused.text.length > 34 ? `${focused.text.slice(0, 33)}…` : focused.text;
    this.focusStatusLabel.textContent = `Focused: ${name} · ${hiddenCount} ${hiddenCount === 1 ? "node" : "nodes"} hidden`;
  }

  applyAppearance(background, highlight) {
    const safeBackground = normalizeBackground(background);
    const safeHighlight = NODE_COLORS[highlight] ? highlight : "blue";
    this.contentEl.removeClass("cmm-theme-system", "cmm-theme-dark", "cmm-theme-light", "cmm-theme-paper");
    this.contentEl.addClass(`cmm-theme-${safeBackground}`);
    this.contentEl.style.setProperty("--cmm-accent", NODE_COLORS[safeHighlight].hex);
    this.contentEl.style.setProperty("--cmm-root-text", NODE_COLORS[safeHighlight].text);
    const appearance = Object.assign({}, NODE_STRENGTH_DEFAULTS, this.mapData?.appearance || {});
    Object.keys(NODE_STRENGTH_DEFAULTS).forEach((key) => {
      const value = Math.min(100, Math.max(0, Number(appearance[key])));
      this.contentEl.style.setProperty(`--cmm-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`, `${Number.isFinite(value) ? value : NODE_STRENGTH_DEFAULTS[key]}%`);
    });
    const strength = Math.min(90, Math.max(0, Number(this.mapData?.appearance?.dimStrength) || 0));
    const nodeOpacity = 1 - strength / 100;
    this.contentEl.style.setProperty("--cmm-dim-node-opacity", String(nodeOpacity));
    this.contentEl.style.setProperty("--cmm-dim-edge-opacity", String(nodeOpacity));
  }

  getAppearance() {
    if (!this.mapData) this.mapData = createBlankMap(this.plugin.getDefaultAppearance());
    this.mapData.appearance = Object.assign({ dimUnrelated: true, dimStrength: 50 }, SPACING_DEFAULTS, NODE_STRENGTH_DEFAULTS, this.plugin.getDefaultAppearance(), this.mapData.appearance || {});
    this.mapData.appearance.background = normalizeBackground(this.mapData.appearance.background);
    if (!["right", "left", "down", "up", "radial"].includes(this.mapData.appearance.layout)) this.mapData.appearance.layout = "right";
    return this.mapData.appearance;
  }

  syncAppearanceControls() {
    const appearance = this.getAppearance();
    this.applyAppearance(appearance.background, appearance.highlight);
  }

  async setAppearance(background, highlight, layout) {
    const safeBackground = normalizeBackground(background);
    const safeHighlight = NODE_COLOR_NAMES.includes(highlight) ? highlight : "blue";
    const allowedLayouts = ["right", "left", "down", "up", "radial"];
    const safeLayout = allowedLayouts.includes(layout) ? layout : "right";
    const current = this.getAppearance();
    if (current.background === safeBackground && current.highlight === safeHighlight && current.layout === safeLayout) return;
    const layoutChanged = current.layout !== safeLayout;
    this.recordUndoState();
    this.map.appearance = Object.assign({}, current, { background: safeBackground, highlight: safeHighlight, layout: safeLayout });
    this.applyAppearance(safeBackground, safeHighlight);
    await this.saveMap();
    this.render();
    if (layoutChanged) this.centerMap();
  }

  get map() { return this.mapData || (this.mapData = createBlankMap()); }
  getNode(id) { return this.map.nodes[id] || null; }

  effectiveNodeColor(nodeId) {
    let node = this.getNode(nodeId);
    while (node) {
      if (NODE_COLOR_NAMES.includes(node.color)) return node.color;
      node = node.parentId ? this.getNode(node.parentId) : null;
    }
    const mapColor = this.getAppearance().highlight;
    return NODE_COLOR_NAMES.includes(mapColor) ? mapColor : "blue";
  }

  async setBranchColor(nodeId, color) {
    const node = this.getNode(nodeId);
    if (!node || (color !== null && !NODE_COLOR_NAMES.includes(color))) return;
    if (!this.ensureEditable(nodeId)) return;
    this.recordUndoState();
    if (color === null) {
      delete node.color;
      delete node.colorSource;
    } else {
      node.color = color;
      node.colorSource = "manual";
    }
    await this.saveMap();
    this.render();
  }

  relationshipsForNode(nodeId) {
    return (this.map.relationships || []).filter((relationship) => relationship.fromId === nodeId || relationship.toId === nodeId);
  }

  startRelationship(nodeId) {
    if (!this.getNode(nodeId) || !this.ensureEditable(nodeId)) return;
    this.relationshipSourceId = nodeId;
    this.selectedId = nodeId;
    this.render();
    new Notice("Click another node to create the relationship. Click empty space or press Escape to cancel.");
  }

  cancelRelationship(showNotice = false) {
    if (!this.relationshipSourceId) return false;
    this.relationshipSourceId = null;
    this.render();
    if (showNotice) new Notice("Relationship creation canceled.");
    return true;
  }

  async createRelationship(fromId, toId) {
    if (!fromId || !toId || fromId === toId) {
      new Notice("Choose a different node for the relationship.");
      return;
    }
    if (!this.getNode(fromId) || !this.getNode(toId)) return;
    if (!this.ensureEditable(fromId) || !this.ensureEditable(toId)) {
      this.relationshipSourceId = null;
      this.render();
      return;
    }
    const duplicate = (this.map.relationships || []).some((relationship) =>
      (relationship.fromId === fromId && relationship.toId === toId)
      || (relationship.fromId === toId && relationship.toId === fromId));
    if (duplicate) {
      this.relationshipSourceId = null;
      this.render();
      new Notice("Those nodes are already linked.");
      return;
    }
    this.recordUndoState();
    if (!Array.isArray(this.map.relationships)) this.map.relationships = [];
    this.map.relationships.push({
      id: `relationship-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      fromId,
      toId
    });
    this.relationshipSourceId = null;
    this.selectedId = toId;
    await this.saveMap();
    this.render();
    new Notice("Relationship created.");
  }

  async removeRelationship(relationshipId) {
    const relationship = (this.map.relationships || []).find((entry) => entry.id === relationshipId);
    if (!relationship) return;
    if (!this.ensureEditable(relationship.fromId) || !this.ensureEditable(relationship.toId)) return;
    this.recordUndoState();
    this.map.relationships = this.map.relationships.filter((entry) => entry.id !== relationshipId);
    await this.saveMap();
    this.render();
    new Notice("Relationship removed.");
  }

  showRelationshipMenu(event, relationshipId) {
    const relationship = (this.map.relationships || []).find((entry) => entry.id === relationshipId);
    if (!relationship) return;
    const menu = new Menu();
    menu.addItem((item) => item
      .setTitle("Remove relationship")
      .setIcon("unlink")
      .onClick(() => this.removeRelationship(relationshipId)));
    menu.showAtMouseEvent(event);
  }

  showMobileRelationshipSheet(relationshipId) {
    this.showMobileSheet("Relationship", [
      { label: "Remove relationship", danger: true, action: () => this.removeRelationship(relationshipId) }
    ]);
  }

  isVisibleInFocus(nodeId) {
    if (!this.focusedId) return true;
    if (nodeId === this.focusedId || this.isDescendant(nodeId, this.focusedId)) return true;
    return this.isDescendant(this.focusedId, nodeId);
  }

  visibleChildren(node) {
    if (!node || node.collapsed) return [];
    return node.childIds.filter((childId) => this.getNode(childId));
  }

  layoutRootIds() {
    return this.map.rootIds.filter((id) => this.getNode(id));
  }

  focusBranch(nodeId) {
    if (!this.getNode(nodeId)) return;
    this.focusedId = nodeId;
    this.selectedId = nodeId;
    this.render();
  }

  clearBranchFocus() {
    if (!this.focusedId) return;
    this.focusedId = null;
    this.render();
  }

  showFullMap() {
    if (this.focusedId) {
      this.focusedId = null;
      this.render();
    }
    this.centerMap();
  }

  createNode(text, parentId = null, notes = "") {
    const effectiveParentId = parentId || this.map.rootIds[0] || null;
    const id = `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.map.nodes[id] = { id, text, parentId: effectiveParentId, childIds: [], collapsed: false };
    if (notes) this.map.nodes[id].notes = notes;
    if (effectiveParentId) {
      const parent = this.getNode(effectiveParentId);
      parent.childIds.push(id);
      if (Array.isArray(parent.manualChildIds)) parent.manualChildIds.push(id);
      if (parent.id === this.map.rootIds[0] && this.getAppearance().randomBranchColors === true) {
        const choices = NODE_COLOR_NAMES.filter((color) => color !== this.getAppearance().highlight);
        this.map.nodes[id].color = choices[Math.floor(Math.random() * choices.length)] || NODE_COLOR_NAMES[0];
        this.map.nodes[id].colorSource = "automatic";
      }
      this.applyChildSort(parent);
    }
    else this.map.rootIds.push(id);
    return this.map.nodes[id];
  }

  applyChildSort(parent) {
    if (!parent || !["asc", "desc"].includes(parent.childSort)) return;
    const direction = parent.childSort === "asc" ? 1 : -1;
    parent.childIds.sort((a, b) => direction * (this.getNode(a)?.text || "").localeCompare(this.getNode(b)?.text || "", undefined, { sensitivity: "base", numeric: true }));
  }

  async setChildSort(nodeId, mode) {
    const node = this.getNode(nodeId);
    if (!node || !["none", "asc", "desc"].includes(mode)) return;
    if (!this.ensureEditable(nodeId)) return;
    const current = ["asc", "desc"].includes(node.childSort) ? node.childSort : "none";
    if (current === mode) return;
    this.recordUndoState();
    if (mode === "none") {
      const manual = Array.isArray(node.manualChildIds) ? node.manualChildIds.filter((id) => node.childIds.includes(id)) : [...node.childIds];
      node.childIds.forEach((id) => { if (!manual.includes(id)) manual.push(id); });
      node.childIds = manual;
      delete node.manualChildIds;
      delete node.childSort;
    } else {
      if (!Array.isArray(node.manualChildIds)) node.manualChildIds = [...node.childIds];
      node.childSort = mode;
      this.applyChildSort(node);
    }
    await this.saveMap();
    this.render();
  }

  serializeSubtree(nodeId, includeChildren = true) {
    const node = this.getNode(nodeId);
    if (!node) return null;
    const copy = { text: node.text, notes: node.notes || "", color: NODE_COLOR_NAMES.includes(node.color) ? node.color : null, colorSource: ["manual", "automatic"].includes(node.colorSource) ? node.colorSource : null, collapsed: Boolean(node.collapsed) };
    copy.children = includeChildren ? node.childIds.map((id) => this.serializeSubtree(id, true)).filter(Boolean) : [];
    return copy;
  }

  copyNode(nodeId) {
    const data = this.serializeSubtree(nodeId, false);
    if (!data) return;
    this.plugin.branchClipboard = data;
    new Notice("Node copied. Select a destination node and paste it as a child.");
  }

  copyBranch(nodeId) {
    const data = this.serializeSubtree(nodeId, true);
    if (!data) return;
    this.plugin.branchClipboard = data;
    const count = this.subtreeNodeCount(nodeId);
    new Notice(`${count === 1 ? "Node" : `${count} nodes`} copied. Select a destination node and paste as a child.`);
  }

  async pasteBranch(parentId) {
    const parent = this.getNode(parentId);
    const source = this.plugin.branchClipboard;
    if (!parent || !source) {
      new Notice("Nothing has been copied yet.");
      return;
    }
    if (!this.ensureEditable(parentId)) return;
    this.recordUndoState();
    const clone = (entry, targetParentId) => {
      const id = `node-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const node = { id, text: entry.text || "Untitled", parentId: targetParentId, childIds: [], collapsed: Boolean(entry.collapsed) };
      if (entry.notes) node.notes = entry.notes;
      if (NODE_COLOR_NAMES.includes(entry.color)) {
        node.color = entry.color;
        node.colorSource = ["manual", "automatic"].includes(entry.colorSource) ? entry.colorSource : "manual";
      }
      this.map.nodes[id] = node;
      const targetParent = this.getNode(targetParentId);
      targetParent.childIds.push(id);
      if (Array.isArray(targetParent.manualChildIds)) targetParent.manualChildIds.push(id);
      (entry.children || []).forEach((child) => clone(child, id));
      this.applyChildSort(targetParent);
      return id;
    };
    const pastedId = clone(source, parentId);
    parent.collapsed = false;
    await this.saveMap();
    this.selectedId = pastedId;
    this.render();
    this.ensureNodeVisible(pastedId);
  }

  promptForNode(title, parentId, afterSave, selectCreated = false, preserveSelectionId = null) {
    if (parentId && !this.ensureEditable(parentId)) return;
    new NodeEditorModal(this.app, this.plugin, title, { text: "New idea", notes: "" }, async (text, notes) => {
      this.recordUndoState();
      const node = this.createNode(text, parentId, notes);
      if (selectCreated) this.selectedId = node.id;
      else if (preserveSelectionId && this.getNode(preserveSelectionId)) this.selectedId = preserveSelectionId;
      await this.saveMap();
      this.render();
      if (afterSave) afterSave(node);
    }).open();
  }

  addChild(parentId) {
    if (!this.getNode(parentId)) return;
    this.promptForNode("Add child node", parentId, null, false, parentId);
  }

  addSibling(nodeId) {
    const node = this.getNode(nodeId);
    if (!node) return;
    if (!node.parentId) {
      new Notice("The central node cannot have a sibling.");
      return;
    }
    if (!this.ensureEditable(nodeId)) return;
    this.promptForNode("Add sibling node", node.parentId, null, false, nodeId);
  }

  activeSelectedNodeId() {
    const visibleSelection = this.scene && this.scene.querySelector(".cmm-node.is-selected");
    const visibleId = visibleSelection && visibleSelection.dataset ? visibleSelection.dataset.nodeId : null;
    return visibleId && this.getNode(visibleId) ? visibleId : this.selectedId;
  }

  showNodeSearch() {
    if (this.searchPanelEl?.isConnected) {
      this.searchInputEl?.focus();
      this.searchInputEl?.select();
      return;
    }
    const panel = this.contentEl.createDiv({ cls: "cmm-search-panel", attr: { role: "dialog", "aria-label": "Search nodes" } });
    const header = panel.createDiv({ cls: "cmm-search-header" });
    header.createEl("strong", { text: "Search nodes" });
    const close = header.createEl("button", { text: "×", attr: { type: "button", "aria-label": "Close search" } });
    const body = panel.createDiv({ cls: "cmm-search-body" });
    const input = body.createEl("input", { attr: { type: "search", placeholder: "Find node title…", "aria-label": "Search node titles" } });
    const controls = body.createDiv({ cls: "cmm-search-controls" });
    const status = controls.createSpan({ cls: "cmm-search-status", text: "Type to search" });
    const previous = controls.createEl("button", { text: "‹", attr: { type: "button", "aria-label": "Previous match" } });
    const next = controls.createEl("button", { text: "›", attr: { type: "button", "aria-label": "Next match" } });
    this.searchPanelEl = panel;
    this.searchInputEl = input;
    this.searchStatusEl = status;
    this.searchPreviousButton = previous;
    this.searchNextButton = next;
    this.searchMatches = [];
    this.searchIndex = -1;

    const updateQuery = () => {
      this.searchMatches = this.findNodeMatches(input.value);
      this.searchIndex = this.searchMatches.length ? 0 : -1;
      this.updateSearchPanelStatus();
      if (this.searchIndex >= 0) this.revealSearchMatch(this.searchMatches[this.searchIndex]);
    };
    input.addEventListener("input", updateQuery);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.moveSearchMatch(event.shiftKey ? -1 : 1);
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.closeNodeSearch();
      }
    });
    previous.addEventListener("click", () => this.moveSearchMatch(-1));
    next.addEventListener("click", () => this.moveSearchMatch(1));
    close.addEventListener("click", () => this.closeNodeSearch());
    panel.addEventListener("pointerdown", (event) => event.stopPropagation());
    this.installSearchPanelDragging(header, close);
    this.positionSearchPanel();
    this.updateSearchPanelStatus();
    window.setTimeout(() => input.focus(), 0);
  }

  closeNodeSearch() {
    this.searchDragCleanup?.();
    this.searchDragCleanup = null;
    this.searchPanelEl?.remove();
    this.searchPanelEl = null;
    this.searchInputEl = null;
    this.searchStatusEl = null;
    this.searchPreviousButton = null;
    this.searchNextButton = null;
    this.searchMatches = [];
    this.searchIndex = -1;
    this.viewport?.focus();
  }

  updateSearchPanelStatus() {
    const count = this.searchMatches.length;
    if (this.searchStatusEl) this.searchStatusEl.textContent = count ? `${this.searchIndex + 1} of ${count}` : (this.searchInputEl?.value.trim() ? "No matches" : "Type to search");
    if (this.searchPreviousButton) this.searchPreviousButton.disabled = count < 2;
    if (this.searchNextButton) this.searchNextButton.disabled = count < 2;
  }

  moveSearchMatch(direction) {
    if (!this.searchMatches.length) return;
    this.searchIndex = (this.searchIndex + direction + this.searchMatches.length) % this.searchMatches.length;
    this.updateSearchPanelStatus();
    this.revealSearchMatch(this.searchMatches[this.searchIndex]);
  }

  positionSearchPanel() {
    if (!this.searchPanelEl) return;
    window.setTimeout(() => {
      if (!this.searchPanelEl) return;
      const saved = this.plugin.data.searchPanelGeometry || {};
      const maxLeft = Math.max(6, this.contentEl.clientWidth - this.searchPanelEl.offsetWidth - 6);
      const maxTop = Math.max(50, this.contentEl.clientHeight - this.searchPanelEl.offsetHeight - 6);
      const defaultLeft = Math.max(6, this.contentEl.clientWidth - this.searchPanelEl.offsetWidth - 14);
      this.searchPanelEl.style.left = `${Math.min(maxLeft, Math.max(6, Number.isFinite(saved.left) ? saved.left : defaultLeft))}px`;
      this.searchPanelEl.style.top = `${Math.min(maxTop, Math.max(50, Number.isFinite(saved.top) ? saved.top : 56))}px`;
    }, 0);
  }

  installSearchPanelDragging(handle, closeButton) {
    let drag = null;
    const move = (event) => {
      if (!drag || !this.searchPanelEl) return;
      const maxLeft = Math.max(6, this.contentEl.clientWidth - this.searchPanelEl.offsetWidth - 6);
      const maxTop = Math.max(50, this.contentEl.clientHeight - this.searchPanelEl.offsetHeight - 6);
      this.searchPanelEl.style.left = `${Math.min(maxLeft, Math.max(6, drag.left + event.clientX - drag.x))}px`;
      this.searchPanelEl.style.top = `${Math.min(maxTop, Math.max(50, drag.top + event.clientY - drag.y))}px`;
    };
    const up = () => {
      if (!drag || !this.searchPanelEl) return;
      drag = null;
      this.searchPanelEl.removeClass("is-dragging");
      this.plugin.data.searchPanelGeometry = {
        left: Math.round(parseFloat(this.searchPanelEl.style.left) || 0),
        top: Math.round(parseFloat(this.searchPanelEl.style.top) || 56)
      };
      this.plugin.savePluginData();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    const down = (event) => {
      if (event.button !== 0 || event.target === closeButton || !this.searchPanelEl) return;
      drag = { x: event.clientX, y: event.clientY, left: parseFloat(this.searchPanelEl.style.left) || 0, top: parseFloat(this.searchPanelEl.style.top) || 56 };
      this.searchPanelEl.addClass("is-dragging");
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      event.preventDefault();
    };
    handle.addEventListener("pointerdown", down);
    this.searchDragCleanup = () => {
      handle.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }

  findNodeMatches(query) {
    const needle = String(query || "").trim().toLocaleLowerCase();
    if (!needle) return [];
    const matches = [];
    const visit = (nodeId) => {
      const node = this.getNode(nodeId);
      if (!node) return;
      if (node.text.toLocaleLowerCase().includes(needle)) matches.push(nodeId);
      node.childIds.forEach(visit);
    };
    this.map.rootIds.forEach(visit);
    return matches;
  }

  async revealSearchMatch(nodeId) {
    const node = this.getNode(nodeId);
    if (!node) return;
    let changed = false;
    let ancestor = node.parentId ? this.getNode(node.parentId) : null;
    while (ancestor) {
      if (ancestor.collapsed) {
        if (!changed) this.recordUndoState();
        ancestor.collapsed = false;
        changed = true;
      }
      ancestor = ancestor.parentId ? this.getNode(ancestor.parentId) : null;
    }
    if (this.focusedId && !this.isVisibleInFocus(nodeId)) this.focusedId = null;
    this.selectedId = nodeId;
    if (changed) await this.saveMap();
    this.render();
    this.ensureNodeVisible(nodeId, 64);
    this.keepSearchMatchClearOfPanel(nodeId);
    if (!this.searchPanelEl?.isConnected) this.viewport?.focus();
  }

  keepSearchMatchClearOfPanel(nodeId) {
    if (!this.searchPanelEl?.isConnected || !this.viewport) return;
    const position = this.layout()[nodeId];
    if (!position) return;
    const size = this.nodeDimensions(position.depth);
    const viewportRect = this.viewport.getBoundingClientRect();
    const panelRect = this.searchPanelEl.getBoundingClientRect();
    const nodeRect = {
      left: viewportRect.left + this.offsetX + position.x * this.scale,
      top: viewportRect.top + this.offsetY + position.y * this.scale,
      right: viewportRect.left + this.offsetX + (position.x + size.width) * this.scale,
      bottom: viewportRect.top + this.offsetY + (position.y + size.height) * this.scale
    };
    const gap = 18;
    if (nodeRect.right + gap <= panelRect.left || nodeRect.left - gap >= panelRect.right || nodeRect.bottom + gap <= panelRect.top || nodeRect.top - gap >= panelRect.bottom) return;
    const options = [
      { dx: panelRect.left - gap - nodeRect.right, dy: 0 },
      { dx: panelRect.right + gap - nodeRect.left, dy: 0 },
      { dx: 0, dy: panelRect.top - gap - nodeRect.bottom },
      { dx: 0, dy: panelRect.bottom + gap - nodeRect.top }
    ];
    const insideViewport = options.filter(({ dx, dy }) => nodeRect.left + dx >= viewportRect.left + gap && nodeRect.right + dx <= viewportRect.right - gap && nodeRect.top + dy >= viewportRect.top + gap && nodeRect.bottom + dy <= viewportRect.bottom - gap);
    const choices = insideViewport.length ? insideViewport : options;
    choices.sort((a, b) => Math.hypot(a.dx, a.dy) - Math.hypot(b.dx, b.dy));
    this.offsetX += choices[0].dx;
    this.offsetY += choices[0].dy;
    this.applyTransform();
  }

  editNode(nodeId) {
    const node = this.getNode(nodeId);
    if (!node) return;
    if (!this.ensureEditable(nodeId)) return;
    new NodeEditorModal(this.app, this.plugin, "Edit node", node, async (text, notes) => {
      const oldNotes = node.notes || "";
      if (node.text === text && oldNotes === notes) return;
      this.recordUndoState();
      node.text = text;
      if (notes) node.notes = notes;
      else delete node.notes;
      if (node.parentId) this.applyChildSort(this.getNode(node.parentId));
      await this.saveMap();
      this.render();
    }).open();
  }

  async toggleCollapsed(nodeId) {
    const node = this.getNode(nodeId);
    if (!node || node.childIds.length === 0) return;
    if (!this.ensureValidMap()) return;
    const beforePosition = this.layout()[nodeId];
    const anchorX = beforePosition ? this.offsetX + beforePosition.x * this.scale : null;
    const anchorY = beforePosition ? this.offsetY + beforePosition.y * this.scale : null;
    this.recordUndoState();
    node.collapsed = !node.collapsed;
    await this.saveMap();
    this.render();
    if (anchorX !== null && anchorY !== null) {
      const afterPosition = this.layout()[nodeId];
      if (afterPosition) {
        this.offsetX = anchorX - afterPosition.x * this.scale;
        this.offsetY = anchorY - afterPosition.y * this.scale;
        this.applyTransform();
      }
    }
  }

  isDescendant(candidateId, ancestorId) {
    let current = this.getNode(candidateId);
    while (current && current.parentId) {
      if (current.parentId === ancestorId) return true;
      current = this.getNode(current.parentId);
    }
    return false;
  }

  shouldDimNode(nodeId) {
    if (this.getAppearance().dimUnrelated === false) return false;
    const selected = this.selectedId ? this.getNode(this.selectedId) : null;
    if (!selected || !selected.parentId) return false;
    if (nodeId === selected.id) return false;
    if (this.isDescendant(nodeId, selected.id)) return false;
    if (this.isDescendant(selected.id, nodeId)) return false;
    return true;
  }

  edgeExtraClass(baseClass, nodeId) {
    const dimmed = this.shouldDimNode(nodeId) ? "is-dimmed" : "";
    return [baseClass, dimmed].filter(Boolean).join(" ");
  }

  lockingNodeId(nodeId) {
    let node = this.getNode(nodeId);
    while (node) {
      if (node.locked) return node.id;
      node = node.parentId ? this.getNode(node.parentId) : null;
    }
    return null;
  }

  ensureValidMap() {
    if (this.invalidSource === null) return true;
    new Notice("This invalid .ksmm file is read-only. Its original contents were not changed.");
    return false;
  }

  ensureEditable(nodeId) {
    if (!this.ensureValidMap()) return false;
    if (!this.lockingNodeId(nodeId)) return true;
    new Notice("This branch is locked. Unlock it from the node menu before editing it.");
    return false;
  }

  async toggleBranchLock(nodeId) {
    const node = this.getNode(nodeId);
    if (!node) return;
    if (!this.ensureValidMap()) return;
    const lockingId = this.lockingNodeId(nodeId);
    this.recordUndoState();
    if (lockingId) delete this.getNode(lockingId).locked;
    else node.locked = true;
    await this.saveMap();
    this.render();
    new Notice(lockingId ? "Branch unlocked." : "Branch locked against edits.");
  }

  async reparent(nodeId, newParentId) {
    const node = this.getNode(nodeId);
    const parent = this.getNode(newParentId);
    if (!node || !parent || nodeId === newParentId || this.isDescendant(newParentId, nodeId)) {
      new Notice("A node cannot be moved into itself or its descendants.");
      return;
    }
    if (!this.ensureEditable(nodeId) || !this.ensureEditable(newParentId)) return;
    if (node.parentId === newParentId) return;
    this.recordUndoState();
    const clearInheritedColorOverrides = (id) => {
      const target = this.getNode(id);
      if (!target) return;
      if (target.colorSource !== "manual") {
        delete target.color;
        delete target.colorSource;
      }
      target.childIds.forEach(clearInheritedColorOverrides);
    };
    clearInheritedColorOverrides(nodeId);
    if (node.parentId) {
      const oldParent = this.getNode(node.parentId);
      oldParent.childIds = oldParent.childIds.filter((id) => id !== nodeId);
      if (Array.isArray(oldParent.manualChildIds)) oldParent.manualChildIds = oldParent.manualChildIds.filter((id) => id !== nodeId);
    } else {
      this.map.rootIds = this.map.rootIds.filter((id) => id !== nodeId);
    }
    node.parentId = newParentId;
    parent.childIds.push(nodeId);
    if (Array.isArray(parent.manualChildIds)) parent.manualChildIds.push(nodeId);
    this.applyChildSort(parent);
    parent.collapsed = false;
    await this.saveMap();
    this.render();
  }

  async reorderSibling(nodeId, targetId, placement) {
    const node = this.getNode(nodeId);
    const target = this.getNode(targetId);
    if (!node || !target || nodeId === targetId || node.parentId !== target.parentId) return;
    if (!this.ensureEditable(nodeId) || !this.ensureEditable(targetId)) return;
    const siblings = node.parentId ? this.getNode(node.parentId)?.childIds : this.map.rootIds;
    if (!siblings) return;
    if (node.parentId && ["asc", "desc"].includes(this.getNode(node.parentId)?.childSort)) {
      new Notice("Turn off child sorting before manually rearranging these siblings.");
      return;
    }
    const originalOrder = [...siblings];
    const reordered = siblings.filter((id) => id !== nodeId);
    const targetIndex = reordered.indexOf(targetId);
    if (targetIndex < 0) return;
    reordered.splice(targetIndex + (placement === "after" ? 1 : 0), 0, nodeId);
    if (reordered.every((id, index) => id === originalOrder[index])) return;
    this.recordUndoState();
    if (node.parentId) this.getNode(node.parentId).childIds = reordered;
    else this.map.rootIds = reordered;
    await this.saveMap();
    this.render();
  }

  subtreeNodeCount(nodeId) {
    const node = this.getNode(nodeId);
    if (!node) return 0;
    return 1 + node.childIds.reduce((total, childId) => total + this.subtreeNodeCount(childId), 0);
  }

  deleteNode(nodeId) {
    const node = this.getNode(nodeId);
    if (!node) return;
    if (!node.parentId) {
      new Notice("The central node cannot be deleted.");
      return;
    }
    if (!this.ensureEditable(nodeId)) return;
    if (node.childIds.length) {
      const nodeCount = this.subtreeNodeCount(nodeId);
      new DeleteSubtreeConfirmModal(this.app, node.text, nodeCount, () => this.deleteNodeConfirmed(nodeId)).open();
      return;
    }
    this.deleteNodeConfirmed(nodeId);
  }

  async deleteNodeConfirmed(nodeId) {
    const node = this.getNode(nodeId);
    if (!node) return;
    if (!this.ensureEditable(nodeId)) return;
    const removesFocusedBranch = this.focusedId && (this.focusedId === nodeId || this.isDescendant(this.focusedId, nodeId));
    this.recordUndoState();
    const removeSubtree = (id) => {
      const target = this.getNode(id);
      if (!target) return;
      [...target.childIds].forEach(removeSubtree);
      this.map.relationships = (this.map.relationships || []).filter((relationship) => relationship.fromId !== id && relationship.toId !== id);
      delete this.map.nodes[id];
    };
    if (node.parentId) {
      const parent = this.getNode(node.parentId);
      parent.childIds = parent.childIds.filter((id) => id !== nodeId);
      if (Array.isArray(parent.manualChildIds)) parent.manualChildIds = parent.manualChildIds.filter((id) => id !== nodeId);
    } else {
      this.map.rootIds = this.map.rootIds.filter((id) => id !== nodeId);
    }
    removeSubtree(nodeId);
    if (removesFocusedBranch) this.focusedId = null;
    this.selectedId = null;
    await this.saveMap();
    this.render();
  }

  showNodeMenu(event, nodeId) {
    const node = this.getNode(nodeId);
    const lockingId = this.lockingNodeId(nodeId);
    const menu = new Menu();
    menu.addItem((item) => item.setTitle("Add child").setIcon("corner-down-right").onClick(() => this.addChild(nodeId)));
    if (node.parentId) menu.addItem((item) => item.setTitle("Add sibling").setIcon("plus").onClick(() => this.addSibling(nodeId)));
    menu.addItem((item) => item.setTitle("Edit node and notes").setIcon("pencil").onClick(() => this.editNode(nodeId)));
    if ((node.notes || "").trim()) {
      menu.addItem((item) => item.setTitle("Open notes").setIcon("notebook-text").onClick(() => this.editNode(nodeId)));
    }
    menu.addItem((item) => item.setTitle("Copy node").setIcon("copy").onClick(() => this.copyNode(nodeId)));
    menu.addItem((item) => item.setTitle("Copy branch").setIcon("copy-plus").onClick(() => this.copyBranch(nodeId)));
    menu.addItem((item) => item
      .setTitle("Paste as child")
      .setIcon("clipboard-paste")
      .setDisabled(!this.plugin.branchClipboard)
      .onClick(() => this.pasteBranch(nodeId)));
    menu.addItem((item) => item
      .setTitle(this.relationshipSourceId === nodeId ? "Cancel relationship link" : "Create relationship link")
      .setIcon(this.relationshipSourceId === nodeId ? "x" : "link")
      .onClick(() => this.relationshipSourceId === nodeId ? this.cancelRelationship(true) : this.startRelationship(nodeId)));
    const nodeRelationships = this.relationshipsForNode(nodeId);
    if (nodeRelationships.length) {
      menu.addItem((item) => {
        item.setTitle("Remove relationship link").setIcon("unlink");
        const submenu = item.setSubmenu();
        nodeRelationships.forEach((relationship) => {
          const otherId = relationship.fromId === nodeId ? relationship.toId : relationship.fromId;
          const otherName = this.getNode(otherId)?.text || "Missing node";
          submenu.addItem((choice) => choice.setTitle(otherName).onClick(() => this.removeRelationship(relationship.id)));
        });
      });
    }
    if (node.childIds.length) {
      menu.addItem((item) => item.setTitle(node.collapsed ? "Expand children" : "Fold children").setIcon(node.collapsed ? "chevrons-right" : "chevrons-down").onClick(() => this.toggleCollapsed(nodeId)));
      menu.addItem((item) => {
        item.setTitle("Sort children").setIcon("arrow-down-a-z");
        const submenu = item.setSubmenu();
        const sortMode = ["asc", "desc"].includes(node.childSort) ? node.childSort : "none";
        [{ value: "none", label: "Manual order" }, { value: "asc", label: "Alphabetical" }, { value: "desc", label: "Reverse alphabetical" }].forEach(({ value, label }) => {
          submenu.addItem((choice) => choice.setTitle(label).setChecked(sortMode === value).onClick(() => this.setChildSort(nodeId, value)));
        });
      });
    }
    menu.addItem((item) => {
      item.setTitle("Node color").setIcon("palette");
      const submenu = item.setSubmenu();
      submenu.addItem((subitem) => subitem
        .setTitle("Use inherited map color")
        .setChecked(!node.color)
        .onClick(() => this.setBranchColor(nodeId, null)));
      NODE_COLOR_NAMES.forEach((color) => {
        const label = color.charAt(0).toUpperCase() + color.slice(1);
        submenu.addItem((subitem) => subitem
          .setTitle(label)
          .setChecked(node.color === color)
          .onClick(() => this.setBranchColor(nodeId, color)));
      });
    });
    menu.addItem((item) => item
      .setTitle(this.focusedId === nodeId ? "Exit branch focus" : "Focus branch")
      .setIcon(this.focusedId === nodeId ? "scan-line" : "scan")
      .onClick(() => this.focusedId === nodeId ? this.clearBranchFocus() : this.focusBranch(nodeId)));
    menu.addItem((item) => item.setTitle("Full map").setIcon("maximize").onClick(() => this.showFullMap()));
    menu.addSeparator();
    menu.addItem((item) => item
      .setTitle(lockingId ? "Unlock branch" : "Lock branch")
      .setIcon(lockingId ? "lock-open" : "lock")
      .onClick(() => this.toggleBranchLock(nodeId)));
    if (node.parentId) menu.addItem((item) => item.setTitle("Delete node and children").setIcon("trash-2").onClick(() => this.deleteNode(nodeId)));
    menu.showAtMouseEvent(event);
  }

  showMobileNodeSheet(nodeId) {
    const node = this.getNode(nodeId);
    if (!node) return;
    const lockingId = this.lockingNodeId(nodeId);
    const items = [
      { label: "Add child", action: () => this.addChild(nodeId) }
    ];
    if (node.parentId) items.push({ label: "Add sibling", action: () => this.addSibling(nodeId) });
    items.push({ label: "Edit title and notes", action: () => this.editNode(nodeId) });
    items.push({ label: "Copy node", action: () => this.copyNode(nodeId) });
    items.push({ label: "Copy branch", action: () => this.copyBranch(nodeId) });
    items.push({ label: "Paste as child", disabled: !this.plugin.branchClipboard, action: () => this.pasteBranch(nodeId) });
    items.push({ label: this.relationshipSourceId === nodeId ? "Cancel relationship link" : "Create relationship link", action: () => this.relationshipSourceId === nodeId ? this.cancelRelationship(true) : this.startRelationship(nodeId) });
    this.relationshipsForNode(nodeId).forEach((relationship) => {
      const otherId = relationship.fromId === nodeId ? relationship.toId : relationship.fromId;
      const otherName = this.getNode(otherId)?.text || "Missing node";
      items.push({ label: `Remove link to ${otherName}`, danger: true, action: () => this.removeRelationship(relationship.id) });
    });
    if (node.childIds.length) items.push({ label: node.collapsed ? "Expand children" : "Fold children", action: () => this.toggleCollapsed(nodeId) });
    if (node.childIds.length) items.push({ label: "Sort children", action: () => this.showMobileSortSheet(nodeId) });
    items.push({ label: "Change branch color", action: () => this.showMobileColorSheet(nodeId) });
    items.push({ label: this.focusedId === nodeId ? "Exit branch focus" : "Focus branch", action: () => this.focusedId === nodeId ? this.clearBranchFocus() : this.focusBranch(nodeId) });
    items.push({ label: "Full map", action: () => this.showFullMap() });
    items.push({ separator: true });
    items.push({ label: lockingId ? "Unlock branch" : "Lock branch", action: () => this.toggleBranchLock(nodeId) });
    if (node.parentId) items.push({ label: "Delete node and children", danger: true, action: () => this.deleteNode(nodeId) });
    this.showMobileSheet(node.text || "Node", items);
  }

  showMobileColorSheet(nodeId) {
    const node = this.getNode(nodeId);
    if (!node) return;
    const items = [{ label: `${!node.color ? "✓ " : ""}Use inherited map color`, action: () => this.setBranchColor(nodeId, null) }];
    NODE_COLOR_NAMES.forEach((color) => items.push({
      label: `${node.color === color ? "✓ " : ""}${color.charAt(0).toUpperCase() + color.slice(1)}`,
      action: () => this.setBranchColor(nodeId, color)
    }));
    this.showMobileSheet("Branch color", items);
  }

  showMobileSortSheet(nodeId) {
    const node = this.getNode(nodeId);
    if (!node) return;
    const mode = ["asc", "desc"].includes(node.childSort) ? node.childSort : "none";
    this.showMobileSheet("Sort children", [
      { label: `${mode === "none" ? "✓ " : ""}Manual order`, action: () => this.setChildSort(nodeId, "none") },
      { label: `${mode === "asc" ? "✓ " : ""}Alphabetical`, action: () => this.setChildSort(nodeId, "asc") },
      { label: `${mode === "desc" ? "✓ " : ""}Reverse alphabetical`, action: () => this.setChildSort(nodeId, "desc") }
    ]);
  }

  showMobileBackgroundSheet() {
    const items = [
      { label: "New mind map", action: () => this.plugin.createNewMap() },
      { separator: true },
      { label: "Center map", action: () => this.centerMap() },
      { label: "Full map", action: () => this.showFullMap() }
    ];
    if (this.focusedId) items.push({ label: "Exit branch focus", action: () => this.clearBranchFocus() });
    items.push({ separator: true });
    items.push({ label: "Search nodes", action: () => this.showNodeSearch() });
    items.push({ label: "Import", action: () => this.showMobileImportSheet() });
    items.push({ label: "Export", action: () => this.showMobileExportSheet() });
    items.push({ label: "Quick appearance", action: () => this.showMobileAppearanceSheet() });
    items.push({ label: "Map settings", action: () => this.showMapSettings() });
    items.push({ label: "Help", action: () => this.showHelp() });
    this.showMobileSheet("Map options", items);
  }

  showMobileImportSheet() {
    const destination = this.outlineImportDestination();
    this.showMobileSheet("Import", [
      { label: `Markdown from vault → ${destination}`, action: () => this.chooseMarkdownImport() },
      { label: `Markdown from device → ${destination}`, action: () => this.chooseMarkdownSystemImport() },
      { label: `OPML → ${destination}`, action: () => this.chooseOPMLImport() },
      { label: "The Kempf Simple Mind Map (.ksmm) → new map", action: () => this.chooseKSMMImport() },
      { label: "JSON backup → new map", action: () => this.chooseJSONBackupImport() }
    ]);
  }

  showMobileExportSheet() {
    this.showMobileSheet("Export", [
      { label: "Markdown", action: () => this.exportMarkdown() },
      { label: "OPML", action: () => this.exportOPML() },
      { label: "The Kempf Simple Mind Map (.ksmm)", action: () => this.exportKSMM() },
      { label: "JSON backup", action: () => this.exportJSONBackup() },
      { label: "PNG image", action: () => this.exportVisual("png") },
      { label: "JPG image", action: () => this.exportVisual("jpg") },
      { label: "SVG image", action: () => this.exportVisual("svg") },
      { label: "PDF document", action: () => this.exportVisual("pdf") }
    ]);
  }

  showMobileAppearanceSheet() {
    const appearance = this.getAppearance();
    this.showMobileSheet("Quick appearance", [
      ...Object.entries(BACKGROUND_OPTIONS).map(([value, label]) => ({ label: `${appearance.background === value ? "✓ " : ""}${label}`, action: () => this.applyQuickMapSetting("background", value) })),
      { separator: true },
      ...[
        ["right", "Right-facing"], ["left", "Left-facing"], ["down", "Down-facing"], ["up", "Up-facing"], ["radial", "Radial"]
      ].map(([value, label]) => ({ label: `${appearance.layout === value ? "✓ " : ""}${label}`, action: () => this.applyQuickMapSetting("layout", value) }))
    ]);
  }

  showBackgroundMenu(event) {
    const menu = new Menu();
    menu.addItem((item) => item.setTitle("Center map").setIcon("focus").onClick(() => this.centerMap()));
    menu.addItem((item) => item.setTitle("Full map").setIcon("maximize").onClick(() => this.showFullMap()));
    if (this.focusedId) {
      menu.addItem((item) => item.setTitle("Exit branch focus").setIcon("scan-line").onClick(() => this.clearBranchFocus()));
    }
    menu.addSeparator();
    menu.addItem((item) => item.setTitle("Search nodes").setIcon("search").onClick(() => this.showNodeSearch()));
    menu.addItem((item) => {
      item.setTitle("Import").setIcon("file-input");
      const submenu = item.setSubmenu();
      submenu.addItem((heading) => heading.setTitle(`Outline destination: ${this.outlineImportDestination()}`).setDisabled(true));
      submenu.addSeparator();
      submenu.addItem((subitem) => subitem.setTitle("Markdown from vault").onClick(() => this.chooseMarkdownImport()));
      submenu.addItem((subitem) => subitem.setTitle("Markdown from computer").onClick(() => this.chooseMarkdownSystemImport()));
      submenu.addItem((subitem) => subitem.setTitle("OPML").onClick(() => this.chooseOPMLImport()));
      submenu.addSeparator();
      submenu.addItem((subitem) => subitem.setTitle("The Kempf Simple Mind Map (.ksmm) → new map").onClick(() => this.chooseKSMMImport()));
      submenu.addItem((subitem) => subitem.setTitle("JSON backup → new map").onClick(() => this.chooseJSONBackupImport()));
    });
    menu.addItem((item) => {
      item.setTitle("Export").setIcon("file-output");
      const submenu = item.setSubmenu();
      submenu.addItem((subitem) => subitem.setTitle("Markdown").onClick(() => this.exportMarkdown()));
      submenu.addItem((subitem) => subitem.setTitle("OPML").onClick(() => this.exportOPML()));
      submenu.addItem((subitem) => subitem.setTitle("The Kempf Simple Mind Map (.ksmm)").onClick(() => this.exportKSMM()));
      submenu.addItem((subitem) => subitem.setTitle("JSON backup").onClick(() => this.exportJSONBackup()));
    });
    menu.addItem((item) => {
      item.setTitle("Export image").setIcon("image-down");
      const submenu = item.setSubmenu();
      [
        { format: "png", label: "PNG" },
        { format: "jpg", label: "JPG" },
        { format: "svg", label: "SVG" },
        { format: "pdf", label: "PDF" }
      ].forEach(({ format, label }) => submenu.addItem((subitem) => subitem
        .setTitle(label)
        .onClick(() => this.exportVisual(format))));
    });
    menu.addSeparator();
    menu.addItem((item) => {
      item.setTitle("Map settings").setIcon("settings");
      const submenu = item.setSubmenu();
      const appearance = this.getAppearance();
      submenu.addItem((heading) => heading.setTitle("Background").setDisabled(true));
      Object.entries(BACKGROUND_OPTIONS).forEach(([value, label]) => {
        submenu.addItem((choice) => choice
          .setTitle(label)
          .setChecked(appearance.background === value)
          .onClick(() => this.applyQuickMapSetting("background", value)));
      });
      submenu.addSeparator();
      submenu.addItem((heading) => heading.setTitle("Layout").setDisabled(true));
      [
        { value: "right", label: "Right-facing" },
        { value: "left", label: "Left-facing" },
        { value: "down", label: "Down-facing" },
        { value: "up", label: "Up-facing" },
        { value: "radial", label: "Radial" }
      ].forEach(({ value, label }) => {
        submenu.addItem((choice) => choice
          .setTitle(label)
          .setChecked(appearance.layout === value)
          .onClick(() => this.applyQuickMapSetting("layout", value)));
      });
      submenu.addSeparator();
      submenu.addItem((subitem) => subitem.setTitle("Open settings window…").setIcon("sliders-horizontal").onClick(() => this.showMapSettings()));
    });
    menu.showAtMouseEvent(event);
  }

  showMapSettings() {
    new MapSettingsModal(this.app, this.getAppearance(), (values) => this.applyMapSettings(values)).open();
  }

  async applyQuickMapSetting(key, value) {
    const next = Object.assign({}, this.getAppearance(), { [key]: value });
    await this.applyMapSettings(next);
  }

  async applyMapSettings(values) {
    if (this.invalidSource !== null) {
      new Notice("This invalid .ksmm file is read-only. Its original contents were not changed.");
      return;
    }
    const current = this.getAppearance();
    const next = {
      background: normalizeBackground(values.background),
      highlight: NODE_COLOR_NAMES.includes(values.highlight) ? values.highlight : "blue",
      layout: ["right", "left", "down", "up", "radial"].includes(values.layout) ? values.layout : "right",
      dimUnrelated: values.dimUnrelated !== false,
      dimStrength: Math.min(90, Math.max(0, Math.round(Number(values.dimStrength) || 0))),
      randomBranchColors: values.randomBranchColors === true,
      levelSpacing: Math.min(300, Math.max(65, Math.round(Number(values.levelSpacing) || SPACING_DEFAULTS.levelSpacing))),
      siblingSpacing: Math.min(300, Math.max(60, Math.round(Number(values.siblingSpacing) || SPACING_DEFAULTS.siblingSpacing))),
      nodePadding: Math.min(24, Math.max(7, Math.round(Number(values.nodePadding) || SPACING_DEFAULTS.nodePadding))),
      trunkSpacing: Math.min(70, Math.max(30, Math.round(Number(values.trunkSpacing) || SPACING_DEFAULTS.trunkSpacing)))
    };
    Object.keys(NODE_STRENGTH_DEFAULTS).forEach((key) => {
      const parsed = Number(values[key]);
      next[key] = Number.isFinite(parsed) ? Math.min(100, Math.max(0, Math.round(parsed / 5) * 5)) : NODE_STRENGTH_DEFAULTS[key];
    });
    if (Object.keys(next).every((key) => current[key] === next[key])) return;
    const layoutChanged = current.layout !== next.layout;
    const geometryChanged = layoutChanged || ["levelSpacing", "siblingSpacing", "nodePadding"].some((key) => current[key] !== next[key]);
    this.recordUndoState();
    this.map.appearance = Object.assign({}, current, next);
    this.applyAppearance(next.background, next.highlight);
    await this.saveMap();
    this.render();
    if (geometryChanged) this.centerMap();
  }

  chooseMarkdownImport() {
    new MarkdownFileSuggestModal(this.app, async (file) => {
      try {
        const markdown = await this.app.vault.cachedRead(file);
        await this.importMarkdownSource(markdown, file.basename);
      } catch (error) {
        new Notice(error.message || "The Markdown file could not be imported.");
      }
    }).open();
  }

  isBlankMap() {
    const roots = this.map.rootIds.map((id) => this.getNode(id)).filter(Boolean);
    return roots.length === 1 && roots[0].text === "Central idea" && !roots[0].notes && roots[0].childIds.length === 0 && !(this.map.relationships || []).length;
  }

  outlineImportDestination() {
    if (this.isBlankMap()) return "replace this blank map";
    const root = this.getNode(this.map.rootIds[0]);
    const name = String(root?.text || "central node").trim();
    const shortened = name.length > 28 ? `${name.slice(0, 27)}…` : name;
    return `under “${shortened}”`;
  }

  chooseMarkdownSystemImport() {
    this.chooseLocalTextFile(".md,.markdown,text/markdown,text/plain", async (file, source) => {
      await this.importMarkdownSource(source, file.name);
    });
  }

  prepareOutlineImport(imported, syntheticRootText, replaceBlankMap = false) {
    const normalized = normalizeSingleRootMap(imported, syntheticRootText);
    if (!normalized) throw new Error("The imported outline is too large, too deeply nested, or structurally invalid.");

    const candidate = JSON.parse(this.mapSnapshot());
    const usedIds = new Set(Object.keys(candidate.nodes));
    const idMap = new Map();
    let sequence = 0;
    Object.keys(normalized.nodes).forEach((oldId) => {
      let newId;
      do {
        newId = `imported-${Date.now()}-${sequence}-${Math.random().toString(36).slice(2, 8)}`;
        sequence += 1;
      } while (usedIds.has(newId));
      usedIds.add(newId);
      idMap.set(oldId, newId);
    });

    const importedNodes = {};
    Object.entries(normalized.nodes).forEach(([oldId, sourceNode]) => {
      const id = idMap.get(oldId);
      const node = JSON.parse(JSON.stringify(sourceNode));
      node.id = id;
      node.parentId = sourceNode.parentId ? idMap.get(sourceNode.parentId) : null;
      node.childIds = sourceNode.childIds.map((childId) => idMap.get(childId));
      if (Array.isArray(sourceNode.manualChildIds)) node.manualChildIds = sourceNode.manualChildIds.map((childId) => idMap.get(childId));
      importedNodes[id] = node;
    });
    const importedRootId = idMap.get(normalized.rootIds[0]);

    if (replaceBlankMap) {
      candidate.nodes = importedNodes;
      candidate.rootIds = [importedRootId];
      candidate.relationships = [];
    } else {
      const destinationRootId = candidate.rootIds[0];
      const destinationRoot = candidate.nodes[destinationRootId];
      importedNodes[importedRootId].parentId = destinationRootId;
      destinationRoot.childIds.push(importedRootId);
      if (Array.isArray(destinationRoot.manualChildIds)) destinationRoot.manualChildIds.push(importedRootId);
      Object.assign(candidate.nodes, importedNodes);
    }

    if (!normalizeSingleRootMap(candidate, syntheticRootText)) {
      throw new Error("The combined map would be too large, too deeply nested, or structurally invalid.");
    }
    return { candidate, importedRootId };
  }

  async importMarkdownSource(markdown, sourceName) {
    if (this.invalidSource !== null) throw new Error("This invalid .ksmm file is read-only.");
    const imported = this.parseMarkdownOutline(markdown);
    if (!imported.rootIds.length) throw new Error("No Markdown headings or list items were found.");
    const roots = this.map.rootIds.map((id) => this.getNode(id)).filter(Boolean);
    const isBlank = this.isBlankMap();
    if (!roots[0] || !this.ensureEditable(roots[0].id)) return;
    const importName = String(sourceName || "Imported outline").replace(/\.(?:md|markdown)$/i, "").trim() || "Imported outline";
    const { candidate, importedRootId } = this.prepareOutlineImport(imported, importName, isBlank);
    this.recordUndoState();
    this.mapData = candidate;
    this.selectedId = importedRootId;
    await this.saveMap();
    this.render();
    this.centerMap();
    this.viewport.focus();
    new Notice(`Imported ${imported.count} nodes from ${sourceName}.`);
  }

  chooseLocalTextFile(accept, onChoose) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      input.remove();
      if (!file) return;
      try {
        await onChoose(file, await file.text());
      } catch (error) {
        new Notice(error.message || "The selected file could not be imported.");
      }
    }, { once: true });
    input.click();
  }

  importedOutlineFromElements(elements) {
    const nodes = {};
    const rootIds = [];
    let count = 0;
    const visit = (element, parentId) => {
      const text = (element.getAttribute("text") || element.getAttribute("title") || "Untitled").trim();
      const id = `node-${Date.now()}-${count}-${Math.random().toString(36).slice(2, 7)}`;
      count += 1;
      nodes[id] = { id, text: text || "Untitled", parentId, childIds: [], collapsed: false };
      if (parentId) nodes[parentId].childIds.push(id);
      else rootIds.push(id);
      Array.from(element.children).filter((child) => child.tagName.toLowerCase() === "outline").forEach((child) => visit(child, id));
    };
    elements.forEach((element) => visit(element, null));
    return { nodes, rootIds, count };
  }

  chooseOPMLImport() {
    this.chooseLocalTextFile(".opml,.xml,text/x-opml,application/xml,text/xml", async (file, source) => {
      if (this.invalidSource !== null) throw new Error("This invalid .ksmm file is read-only.");
      const documentNode = new DOMParser().parseFromString(source, "application/xml");
      if (documentNode.querySelector("parsererror")) throw new Error("This OPML file contains invalid XML.");
      const body = documentNode.querySelector("opml > body") || documentNode.querySelector("body");
      if (!body) throw new Error("No OPML body was found.");
      const outlines = Array.from(body.children).filter((child) => child.tagName.toLowerCase() === "outline");
      const imported = this.importedOutlineFromElements(outlines);
      if (!imported.count) throw new Error("No OPML outline nodes were found.");
      const rootId = this.map.rootIds[0];
      if (!this.ensureEditable(rootId)) return;
      const importName = file.name.replace(/\.(?:opml|xml)$/i, "").trim() || "Imported outline";
      const { candidate } = this.prepareOutlineImport(imported, importName, this.isBlankMap());
      this.recordUndoState();
      this.mapData = candidate;
      await this.saveMap();
      this.render();
      this.showFullMap();
      new Notice(`Imported ${imported.count} nodes from ${file.name}.`);
    });
  }

  chooseKSMMImport() {
    this.chooseLocalTextFile(".ksmm,application/json", async (file, source) => {
      const parsed = JSON.parse(source);
      const stem = file.name.replace(/\.ksmm$/i, "").trim() || "Imported mind map";
      if (!normalizeSingleRootMap(parsed, stem)) throw new Error("This is not a valid .ksmm map.");
      const parentPath = this.file && this.file.parent && this.file.parent.path !== "/" ? this.file.parent.path : this.plugin.pluginFolderPath();
      const path = this.uniqueVaultPath(parentPath, stem, "ksmm", " import");
      const importedFile = await this.app.vault.create(path, JSON.stringify(parsed, null, 2));
      const leaf = this.app.workspace.getLeaf("tab");
      await leaf.openFile(importedFile);
      this.app.workspace.revealLeaf(leaf);
      new Notice(`Imported ${file.name} as ${importedFile.path}.`);
    });
  }

  chooseJSONBackupImport() {
    this.chooseLocalTextFile(".json,application/json", async (file, source) => {
      const parsed = JSON.parse(source);
      if (parsed?.format && parsed.format !== "kempfs-simple-mind-map-backup") throw new Error("This JSON file is not a valid backup from The Kempf Simple Mind Map.");
      const restored = parsed?.map || parsed;
      const backupName = String(parsed?.sourceFile || file.name)
        .replace(/(?:-backup)?\.json$/i, "")
        .replace(/\.ksmm$/i, "")
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
        .trim() || "Restored mind map";
      if (!normalizeSingleRootMap(restored, backupName)) throw new Error("This JSON backup does not contain a valid mind map.");
      restored.appearance = Object.assign({}, this.plugin.getDefaultAppearance(), restored.appearance || {});
      const parentPath = this.file && this.file.parent && this.file.parent.path !== "/" ? this.file.parent.path : this.plugin.pluginFolderPath();
      const path = this.uniqueVaultPath(parentPath, backupName, "ksmm", " restored");
      const restoredFile = await this.app.vault.create(path, JSON.stringify(restored, null, 2));
      const leaf = this.app.workspace.getLeaf("tab");
      await leaf.openFile(restoredFile);
      this.app.workspace.revealLeaf(leaf);
      new Notice(`Backup restored as ${restoredFile.path}.`);
    });
  }

  uniqueVaultPath(parentPath, baseName, extension, numberedSuffix = " export") {
    let counter = 0;
    let path;
    do {
      const suffix = counter === 0 ? "" : `${numberedSuffix} ${counter + 1}`;
      path = normalizePath(`${parentPath ? `${parentPath}/` : ""}${baseName}${suffix}.${extension}`);
      counter += 1;
    } while (this.app.vault.getAbstractFileByPath(path));
    return path;
  }

  parseMarkdownOutline(markdown) {
    const entries = [];
    let mostRecentHeadingLevel = -1;
    markdown.split(/\r?\n/).forEach((line) => {
      const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (heading) {
        mostRecentHeadingLevel = heading[1].length - 1;
        entries.push({ kind: "heading", level: mostRecentHeadingLevel, text: heading[2], indent: 0 });
        return;
      }
      const listItem = line.match(/^(\s*)(?:[-*+]|\d+[.)])\s+(.+)$/);
      if (listItem) {
        const whitespace = listItem[1].replace(/\t/g, "    ").length;
        entries.push({ kind: "list", headingBase: mostRecentHeadingLevel, text: listItem[2], indent: whitespace });
      }
    });

    const positiveIndents = entries.filter((entry) => entry.kind === "list" && entry.indent > 0).map((entry) => entry.indent);
    const indentUnit = positiveIndents.length ? Math.max(1, Math.min(...positiveIndents)) : 2;
    const nodes = {};
    const rootIds = [];
    const stack = [];
    let count = 0;

    const cleanText = (text) => text
      .replace(/^\[[ xX-]\]\s*/, "")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[*_~`]/g, "")
      .trim();

    entries.forEach((entry) => {
      const text = cleanText(entry.text);
      if (!text) return;
      const requestedLevel = entry.kind === "heading"
        ? entry.level
        : entry.headingBase + 1 + Math.round(entry.indent / indentUnit);
      const level = Math.max(0, requestedLevel);
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      const parentId = stack.length ? stack[stack.length - 1].id : null;
      const id = `node-${Date.now()}-${count}-${Math.random().toString(36).slice(2, 7)}`;
      nodes[id] = { id, text, parentId, childIds: [], collapsed: false };
      if (parentId) nodes[parentId].childIds.push(id);
      else rootIds.push(id);
      stack.push({ level, id });
      count += 1;
    });
    return { nodes, rootIds, count };
  }

  async exportMarkdown() {
    if (!this.file) {
      new Notice("Open a .ksmm file before exporting.");
      return;
    }
    new OutlineExportWarningModal(this.app, "Markdown", () => this.exportMarkdownConfirmed()).open();
  }

  async exportMarkdownConfirmed() {
    const lines = [];
    const writeChildren = (nodeId, depth) => {
      const node = this.getNode(nodeId);
      if (!node) return;
      const text = node.text.replace(/\s+/g, " ").trim();
      if (depth === 0) lines.push(`# ${text}`);
      else lines.push(`${"  ".repeat(depth - 1)}- ${text}`);
      node.childIds.forEach((childId) => writeChildren(childId, depth + 1));
    };
    this.map.rootIds.forEach((rootId, index) => {
      if (index > 0) lines.push("");
      writeChildren(rootId, 0);
    });

    if (await this.saveExportAs(`${this.file.basename}.md`, `${lines.join("\n")}\n`, "text/markdown;charset=utf-8")) {
      new Notice("Markdown exported.");
    }
  }

  xmlEscape(value) {
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  }

  async exportOPML() {
    if (!this.file) return void new Notice("Open a .ksmm file before exporting.");
    new OutlineExportWarningModal(this.app, "OPML", () => this.exportOPMLConfirmed()).open();
  }

  async exportOPMLConfirmed() {
    const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<opml version="2.0">', "  <head>", `    <title>${this.xmlEscape(this.file.basename)}</title>`, "  </head>", "  <body>"];
    const writeNode = (nodeId, depth) => {
      const node = this.getNode(nodeId);
      if (!node) return;
      const indent = "  ".repeat(depth + 2);
      const children = node.childIds.map((id) => this.getNode(id)).filter(Boolean);
      if (!children.length) lines.push(`${indent}<outline text="${this.xmlEscape(node.text)}"/>`);
      else {
        lines.push(`${indent}<outline text="${this.xmlEscape(node.text)}">`);
        node.childIds.forEach((childId) => writeNode(childId, depth + 1));
        lines.push(`${indent}</outline>`);
      }
    };
    this.map.rootIds.forEach((rootId) => writeNode(rootId, 0));
    lines.push("  </body>", "</opml>", "");
    if (await this.saveExportAs(`${this.file.basename}.opml`, lines.join("\n"), "text/x-opml;charset=utf-8")) {
      new Notice("OPML exported.");
    }
  }

  async exportKSMM() {
    if (!this.file) return void new Notice("Open a .ksmm file before exporting.");
    if (await this.saveExportAs(`${this.file.basename}.ksmm`, `${JSON.stringify(this.mapData, null, 2)}\n`, "application/json;charset=utf-8")) {
      new Notice("Native map exported.");
    }
  }

  async exportJSONBackup() {
    if (!this.file) return void new Notice("Open a .ksmm file before exporting a backup.");
    const backup = {
      format: "kempfs-simple-mind-map-backup",
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      sourceFile: this.file.name,
      map: this.mapData
    };
    if (await this.saveExportAs(`${this.file.basename}-backup.json`, `${JSON.stringify(backup, null, 2)}\n`, "application/json;charset=utf-8")) {
      new Notice("JSON backup exported.");
    }
  }

  exportFileType(filename) {
    const extension = filename.split(".").pop().toLowerCase();
    const labels = { md: "Markdown", opml: "OPML", ksmm: "The Kempf Simple Mind Map", json: "JSON backup", png: "PNG image", jpg: "JPEG image", svg: "SVG image", pdf: "PDF document" };
    return { extension, label: labels[extension] || "File" };
  }

  exportDefaultPath(filename) {
    try {
      const adapter = this.app.vault.adapter;
      if (!adapter || typeof adapter.getBasePath !== "function") return filename;
      const path = require("path");
      const vaultRoot = adapter.getBasePath();
      const parentPath = this.file && this.file.parent && this.file.parent.path !== "/" ? this.file.parent.path : "";
      return path.join(vaultRoot, parentPath, filename);
    } catch (error) {
      return filename;
    }
  }

  async saveExportAs(filename, content, mimeType) {
    const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
    const type = this.exportFileType(filename);
    try {
      const electron = require("electron");
      const dialog = electron.remote && electron.remote.dialog;
      if (dialog && typeof dialog.showSaveDialog === "function") {
        const result = await dialog.showSaveDialog({
          title: "Export mind map",
          defaultPath: this.exportDefaultPath(filename),
          filters: [{ name: type.label, extensions: [type.extension] }]
        });
        if (result.canceled || !result.filePath) return false;
        await require("fs").promises.writeFile(result.filePath, Buffer.from(bytes));
        return true;
      }
    } catch (error) {
      // Continue to browser/mobile save handling.
    }

    if (typeof window.showSaveFilePicker === "function") {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: type.label, accept: { [mimeType.split(";")[0]]: [`.${type.extension}`] } }]
        });
        const writable = await handle.createWritable();
        await writable.write(new Blob([bytes], { type: mimeType }));
        await writable.close();
        return true;
      } catch (error) {
        if (error && error.name === "AbortError") return false;
        throw error;
      }
    }

    const blob = new Blob([bytes], { type: mimeType });
    const url = URL.createObjectURL(blob);
    try {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      return true;
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  exportBounds(padding = 48) {
    const positions = this.layout();
    const entries = Object.entries(positions).filter(([id]) => this.isVisibleInFocus(id)).map(([, position]) => position);
    if (!entries.length) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    entries.forEach((position) => {
      const size = this.nodeDimensions(position.depth);
      minX = Math.min(minX, position.x);
      minY = Math.min(minY, position.y);
      maxX = Math.max(maxX, position.x + size.width);
      maxY = Math.max(maxY, position.y + size.height);
    });
    return {
      x: minX - padding,
      y: minY - padding,
      width: Math.max(1, maxX - minX + padding * 2),
      height: Math.max(1, maxY - minY + padding * 2)
    };
  }

  wrapExportLabel(text, maxWidth, fontSize) {
    const maxCharacters = Math.max(4, Math.floor(maxWidth / (fontSize * 0.58)));
    const words = String(text || "").trim().split(/\s+/).filter(Boolean);
    const lines = [];
    let current = "";
    words.forEach((word) => {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= maxCharacters || !current) current = candidate;
      else { lines.push(current); current = word; }
    });
    if (current) lines.push(current);
    if (!lines.length) lines.push("");
    if (lines.length > 2) {
      lines[1] = `${lines.slice(1).join(" ").slice(0, Math.max(1, maxCharacters - 1)).trimEnd()}…`;
      lines.length = 2;
    }
    return lines;
  }

  makeExportScene(rasterSafe, background, textColor) {
    const scene = this.scene.cloneNode(true);
    scene.removeAttribute("transform");
    scene.querySelectorAll(".is-selected, .is-drop-target, .is-dragging, .is-relationship-source").forEach((element) => {
      element.classList.remove("is-selected", "is-drop-target", "is-dragging", "is-relationship-source");
    });
    if (!rasterSafe) return scene;

    scene.querySelectorAll("foreignObject.cmm-node-label-area").forEach((labelArea) => {
      const group = labelArea.parentElement;
      const node = group && this.getNode(group.dataset.nodeId);
      if (!group || !node) {
        labelArea.remove();
        return;
      }
      const isRoot = group.classList.contains("cmm-level-root");
      const isParent = group.classList.contains("cmm-level-parent");
      const fontSize = isRoot ? 18 : isParent ? 16 : 14;
      const fontWeight = isRoot ? 700 : isParent ? 600 : 400;
      const areaWidth = Number(labelArea.getAttribute("width")) || 140;
      const nodeHeight = Number(group.querySelector("rect")?.getAttribute("height")) || 52;
      const lines = this.wrapExportLabel(node.text, areaWidth, fontSize);
      const labelX = isRoot ? (Number(labelArea.getAttribute("x")) || 0) + areaWidth / 2 : 12;
      const label = this.svgEl("text", {
        x: labelX,
        y: lines.length === 1 ? nodeHeight / 2 + fontSize * 0.34 : nodeHeight / 2 - fontSize * 0.18,
        class: `cmm-export-label${isRoot ? " is-root" : ""}`,
        style: `font-size:${fontSize}px;font-weight:${fontWeight};fill:${isRoot ? "var(--cmm-node-root-text)" : textColor}${isRoot ? ";text-anchor:middle" : ""}`
      });
      lines.forEach((line, index) => {
        const span = this.svgEl("tspan", { x: labelX, dy: index === 0 ? 0 : fontSize * 1.2 });
        span.textContent = line;
        label.appendChild(span);
      });
      labelArea.replaceWith(label);
    });
    return scene;
  }

  exportSvgText(rasterSafe = false) {
    const bounds = this.exportBounds();
    if (!bounds) return null;
    const appearance = this.getAppearance();
    const light = usesLightPalette(appearance.background);
    const systemBackground = getComputedStyle(this.contentEl).getPropertyValue("--background-primary").trim();
    const background = appearance.background === "paper" ? "#f7f3e8" : appearance.background === "dark" ? "#11151c" : systemBackground || (light ? "#ffffff" : "#11151c");
    const textColor = light ? "#25231f" : "#eef2f8";
    const border = light ? "#b8c4d6" : "#374151";
    const dimStrength = Math.min(90, Math.max(0, Number(appearance.dimStrength) || 0));
    const dimNodeOpacity = 1 - dimStrength / 100;
    const dimEdgeOpacity = dimNodeOpacity;
    const strengthPrefix = light ? "light" : "dark";
    const rootStrength = appearance[`${strengthPrefix}RootStrength`] ?? NODE_STRENGTH_DEFAULTS[`${strengthPrefix}RootStrength`];
    const level1Strength = appearance[`${strengthPrefix}Level1Strength`] ?? NODE_STRENGTH_DEFAULTS[`${strengthPrefix}Level1Strength`];
    const level2Strength = appearance[`${strengthPrefix}Level2Strength`] ?? NODE_STRENGTH_DEFAULTS[`${strengthPrefix}Level2Strength`];
    const deepStrength = appearance[`${strengthPrefix}DeepStrength`] ?? NODE_STRENGTH_DEFAULTS[`${strengthPrefix}DeepStrength`];
    const scene = this.makeExportScene(rasterSafe, background, textColor);
    const svg = this.svgEl("svg", {
      xmlns: "http://www.w3.org/2000/svg",
      width: Math.ceil(bounds.width),
      height: Math.ceil(bounds.height),
      viewBox: `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`
    });
    const style = this.svgEl("style");
    style.textContent = `
      .cmm-edge{fill:none;opacity:.9;stroke-linecap:round;stroke-linejoin:round}
      .cmm-edge.is-dimmed{opacity:${dimEdgeOpacity}}
      .cmm-edge-level-1{stroke:var(--cmm-edge-accent);stroke-width:4}
      .cmm-edge-level-2{stroke:color-mix(in srgb,var(--cmm-edge-accent) 70%,${background});stroke-width:3}
      .cmm-edge-level-3{stroke:color-mix(in srgb,var(--cmm-edge-accent) 45%,${background});stroke-width:2}
      .cmm-relationship{fill:none;stroke:${textColor};stroke-width:2;stroke-dasharray:7 7;stroke-linecap:round;opacity:.55}
      .cmm-relationship-hit{display:none}
      .cmm-relationship-group.is-dimmed{opacity:${dimEdgeOpacity}}
      .cmm-node rect{stroke:${border};stroke-width:1.5}
      .cmm-node.is-dimmed{opacity:${dimNodeOpacity}}
      .cmm-node rect{fill:color-mix(in srgb,var(--cmm-node-accent) ${level2Strength}%,${background})}
      .cmm-level-root rect{fill:color-mix(in srgb,var(--cmm-node-accent) ${rootStrength}%,${background});stroke:color-mix(in srgb,var(--cmm-node-accent) 72%,#fff);stroke-width:4;filter:drop-shadow(0 0 8px var(--cmm-node-accent)) drop-shadow(0 0 3px var(--cmm-node-accent))}
      .cmm-level-parent rect{fill:color-mix(in srgb,var(--cmm-node-accent) ${level1Strength}%,${background})}
      .cmm-level-deep rect{fill:color-mix(in srgb,var(--cmm-node-accent) ${deepStrength}%,${background})}
      .cmm-node-label{position:relative;top:50%;transform:translateY(-50%);width:100%;max-height:100%;display:-webkit-box;overflow:hidden;color:${textColor};font-family:Arial,sans-serif;line-height:1.2;overflow-wrap:anywhere;word-break:break-word;-webkit-box-orient:vertical;-webkit-line-clamp:2}
      .cmm-level-root .cmm-node-label{font-size:18px;font-weight:700;color:var(--cmm-node-root-text);text-align:center}
      .cmm-level-parent .cmm-node-label{font-size:16px;font-weight:600}
      .cmm-level-detail .cmm-node-label{font-size:14px;font-weight:400}
      .cmm-level-deep .cmm-node-label{font-size:14px;font-weight:400}
      .cmm-badge{fill:var(--cmm-node-accent);font:700 12px Arial,sans-serif;text-anchor:middle}
      .cmm-level-root .cmm-badge{fill:var(--cmm-node-root-text)}
      .cmm-fold-toggle-hit{fill:transparent!important;stroke:none!important}
      .cmm-export-label{font-family:Arial,sans-serif;dominant-baseline:auto}
      .cmm-lock-icon{fill:none;stroke:${textColor};stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
      .cmm-level-root .cmm-lock-icon{stroke:var(--cmm-node-root-text)}
    `;
    svg.appendChild(style);
    svg.appendChild(this.svgEl("rect", { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, fill: background }));
    svg.appendChild(scene);
    return { text: new XMLSerializer().serializeToString(svg), bounds };
  }

  async rasterizeExport(svgText, bounds, format) {
    const maxDimension = 4096;
    const renderScale = Math.min(2, maxDimension / Math.max(bounds.width, bounds.height));
    const width = Math.max(1, Math.round(bounds.width * renderScale));
    const height = Math.max(1, Math.round(bounds.height * renderScale));
    const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error("The map could not be rendered as an image."));
        image.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0, width, height);
      const mime = format === "png" ? "image/png" : "image/jpeg";
      const output = await new Promise((resolve, reject) => canvas.toBlob(
        (result) => result ? resolve(result) : reject(new Error("The image export failed.")),
        mime,
        format === "jpg" ? 0.92 : undefined
      ));
      return { bytes: new Uint8Array(await output.arrayBuffer()), width, height };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  makePdfFromJpeg(jpeg, imageWidth, imageHeight) {
    const encoder = new TextEncoder();
    const pageLandscape = imageWidth >= imageHeight;
    const pageWidth = pageLandscape ? 792 : 612;
    const pageHeight = pageLandscape ? 612 : 792;
    const fit = Math.min((pageWidth - 36) / imageWidth, (pageHeight - 36) / imageHeight);
    const drawWidth = imageWidth * fit;
    const drawHeight = imageHeight * fit;
    const drawX = (pageWidth - drawWidth) / 2;
    const drawY = (pageHeight - drawHeight) / 2;
    const content = `q\n${drawWidth.toFixed(2)} 0 0 ${drawHeight.toFixed(2)} ${drawX.toFixed(2)} ${drawY.toFixed(2)} cm\n/Im0 Do\nQ\n`;
    const parts = [encoder.encode("%PDF-1.4\n%KSMM\n")];
    const offsets = [0];
    const length = () => parts.reduce((sum, part) => sum + part.length, 0);
    const addObject = (number, chunks) => {
      offsets[number] = length();
      parts.push(encoder.encode(`${number} 0 obj\n`), ...chunks, encoder.encode("\nendobj\n"));
    };
    addObject(1, [encoder.encode("<< /Type /Catalog /Pages 2 0 R >>")]);
    addObject(2, [encoder.encode("<< /Type /Pages /Kids [3 0 R] /Count 1 >>")]);
    addObject(3, [encoder.encode(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`)]);
    addObject(4, [encoder.encode(`<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream`)]);
    addObject(5, [encoder.encode(`<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`), jpeg, encoder.encode("\nendstream")]);
    const xrefOffset = length();
    let xref = "xref\n0 6\n0000000000 65535 f \n";
    for (let index = 1; index <= 5; index += 1) xref += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
    xref += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    parts.push(encoder.encode(xref));
    const total = length();
    const pdf = new Uint8Array(total);
    let offset = 0;
    parts.forEach((part) => { pdf.set(part, offset); offset += part.length; });
    return pdf;
  }

  async exportVisual(format) {
    try {
      if (!this.file) throw new Error("Open a .ksmm file before exporting.");
      const exported = this.exportSvgText(format !== "svg");
      if (!exported) throw new Error("There is nothing to export.");
      let content;
      let mimeType;
      if (format === "svg") {
        content = exported.text;
        mimeType = "image/svg+xml;charset=utf-8";
      } else if (format === "png" || format === "jpg") {
        const raster = await this.rasterizeExport(exported.text, exported.bounds, format);
        content = raster.bytes;
        mimeType = format === "png" ? "image/png" : "image/jpeg";
      } else if (format === "pdf") {
        const raster = await this.rasterizeExport(exported.text, exported.bounds, "jpg");
        content = this.makePdfFromJpeg(raster.bytes, raster.width, raster.height);
        mimeType = "application/pdf";
      }
      if (await this.saveExportAs(`${this.file.basename}.${format}`, content, mimeType)) new Notice("Map exported.");
    } catch (error) {
      new Notice(error.message || "The map could not be exported.");
    }
  }

  navigateNode(direction) {
    const currentId = this.activeSelectedNodeId();
    if (!currentId) return false;
    const currentNode = this.getNode(currentId);
    if (!currentNode) return false;
    const positions = this.layout();
    const current = positions[currentId];
    if (!current || !this.isVisibleInFocus(currentId)) return false;
    const currentSize = this.nodeDimensions(current.depth);
    const currentCenter = {
      x: current.x + currentSize.width / 2,
      y: current.y + currentSize.height / 2
    };
    const axis = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 }
    }[direction];
    if (!axis) return false;
    const layoutMode = this.getAppearance().layout || "right";
    const horizontalHierarchy = layoutMode === "right" || layoutMode === "left" || layoutMode === "radial";
    const hierarchyKey = horizontalHierarchy
      ? direction === "ArrowLeft" || direction === "ArrowRight"
      : direction === "ArrowUp" || direction === "ArrowDown";

    let best = null;
    Object.entries(positions).forEach(([nodeId, position]) => {
      if (nodeId === currentId || !this.isVisibleInFocus(nodeId)) return;
      const candidateNode = this.getNode(nodeId);
      if (!candidateNode) return;
      const size = this.nodeDimensions(position.depth);
      const dx = position.x + size.width / 2 - currentCenter.x;
      const dy = position.y + size.height / 2 - currentCenter.y;
      const forward = dx * axis.x + dy * axis.y;
      if (forward <= 1) return;
      const sideways = Math.abs(dx * axis.y - dy * axis.x);
      const distance = Math.hypot(dx, dy);
      const score = distance + sideways * 2;
      const directlyRelated = candidateNode.parentId === currentId || currentNode.parentId === nodeId;
      const sibling = candidateNode.parentId === currentNode.parentId;
      if ((hierarchyKey && !directlyRelated) || (!hierarchyKey && !sibling)) return;
      if (!best || score < best.score || (score === best.score && forward < best.forward)) {
        best = { nodeId, score, forward };
      }
    });
    if (!best) return false;
    this.selectedId = best.nodeId;
    this.render();
    this.ensureNodeVisible(best.nodeId);
    return true;
  }

  ensureNodeVisible(nodeId, margin = 32) {
    if (!this.viewport) return;
    const position = this.layout()[nodeId];
    if (!position) return;
    const size = this.nodeDimensions(position.depth);
    const left = position.x * this.scale + this.offsetX;
    const top = position.y * this.scale + this.offsetY;
    const right = left + size.width * this.scale;
    const bottom = top + size.height * this.scale;
    const viewportWidth = this.viewport.clientWidth || 900;
    const viewportHeight = this.viewport.clientHeight || 600;
    if (left < margin) this.offsetX += margin - left;
    else if (right > viewportWidth - margin) this.offsetX -= right - (viewportWidth - margin);
    if (top < margin) this.offsetY += margin - top;
    else if (bottom > viewportHeight - margin) this.offsetY -= bottom - (viewportHeight - margin);
    this.applyTransform();
  }

  onKeyDown(event) {
    if (this.isMobile) return;
    if (event.key === "Escape" && this.relationshipSourceId) {
      event.preventDefault();
      this.cancelRelationship(true);
      return;
    }
    const modifier = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (modifier && key === "f") {
      event.preventDefault();
      this.showNodeSearch();
      return;
    }
    if (modifier && key === "c") {
      const selectedId = this.activeSelectedNodeId();
      if (selectedId) {
        event.preventDefault();
        this.copyBranch(selectedId);
      }
      return;
    }
    if (modifier && key === "v") {
      const selectedId = this.activeSelectedNodeId();
      if (selectedId) {
        event.preventDefault();
        this.pasteBranch(selectedId);
      }
      return;
    }
    if (modifier && key === "z") {
      event.preventDefault();
      if (event.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (modifier && key === "y") {
      event.preventDefault();
      this.redo();
      return;
    }
    const activeNodeId = this.activeSelectedNodeId();
    if (!activeNodeId) return;
    if (event.key === "Tab" || (!modifier && key === "c")) {
      event.preventDefault();
      this.addChild(activeNodeId);
    } else if (event.key === "Enter") {
      event.preventDefault();
      this.editNode(activeNodeId);
    } else if (!modifier && key === "s") {
      event.preventDefault();
      this.addSibling(activeNodeId);
    } else if (event.key === "F2") {
      event.preventDefault();
      this.editNode(activeNodeId);
    } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      this.navigateNode(event.key);
    } else if (event.key === " ") {
      const node = this.getNode(activeNodeId);
      if (node && node.childIds.length) {
        event.preventDefault();
        this.toggleCollapsed(node.id);
      }
    } else if (event.key === "Delete") {
      event.preventDefault();
      this.deleteNode(activeNodeId);
    }
  }

  onWheel(event) {
    event.preventDefault();
    const rect = this.viewport.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    const oldScale = this.scale;
    this.scale = Math.min(2.5, Math.max(0.1, this.scale * (event.deltaY < 0 ? 1.1 : 0.9)));
    this.offsetX = mouseX - ((mouseX - this.offsetX) / oldScale) * this.scale;
    this.offsetY = mouseY - ((mouseY - this.offsetY) / oldScale) * this.scale;
    this.applyTransform();
  }

  zoomBy(factor) {
    if (!this.viewport) return;
    const centerX = this.viewport.clientWidth / 2;
    const centerY = this.viewport.clientHeight / 2;
    const oldScale = this.scale;
    this.scale = Math.min(2.5, Math.max(0.1, this.scale * factor));
    this.offsetX = centerX - ((centerX - this.offsetX) / oldScale) * this.scale;
    this.offsetY = centerY - ((centerY - this.offsetY) / oldScale) * this.scale;
    this.applyTransform();
  }

  onBackgroundPointerDown(event) {
    if (event.pointerType === "touch") return;
    const leftBackgroundPan = event.button === 0 && event.target === this.svg;
    const middlePan = event.button === 1;
    if (!leftBackgroundPan && !middlePan) return;
    event.preventDefault();
    if (leftBackgroundPan) this.backgroundPanMoved = false;
    this.panning = true;
    const startX = event.clientX;
    const startY = event.clientY;
    const originalX = this.offsetX;
    const originalY = this.offsetY;
    const move = (moveEvent) => {
      if (!this.panning) return;
      if (leftBackgroundPan && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > 4) {
        this.backgroundPanMoved = true;
      }
      this.offsetX = originalX + moveEvent.clientX - startX;
      this.offsetY = originalY + moveEvent.clientY - startY;
      this.applyTransform();
    };
    const up = () => {
      this.panning = false;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  onBackgroundClick(event) {
    if (event.button !== 0 || event.target !== this.svg) return;
    const wasPan = this.backgroundPanMoved;
    this.backgroundPanMoved = false;
    if (wasPan) return;
    if (this.relationshipSourceId) {
      this.cancelRelationship(true);
      return;
    }
    if (!this.selectedId) return;
    this.selectedId = null;
    this.viewport.focus();
    this.render();
  }

  applyTransform() {
    if (this.scene) this.scene.setAttribute("transform", `translate(${this.offsetX} ${this.offsetY}) scale(${this.scale})`);
    this.updateToolbarButtons();
  }

  visibleTree() {
    const result = [];
    const visit = (id, depth) => {
      const node = this.getNode(id);
      if (!node) return;
      result.push({ node, depth });
      if (!node.collapsed) node.childIds.forEach((childId) => visit(childId, depth + 1));
    };
    this.map.rootIds.forEach((id) => visit(id, 0));
    return result;
  }

  nodeDimensions(depth) {
    const padding = Math.min(24, Math.max(7, Number(this.getAppearance().nodePadding) || SPACING_DEFAULTS.nodePadding));
    const delta = (padding - SPACING_DEFAULTS.nodePadding) * 2;
    if (depth === 0) return { width: 260 + delta, height: 80 + delta, levelClass: "cmm-level-root" };
    if (depth === 1) return { width: 200 + delta, height: 60 + delta, levelClass: "cmm-level-parent" };
    if (depth === 2) return { width: 180 + delta, height: 52 + delta, levelClass: "cmm-level-detail" };
    return { width: 180 + delta, height: 52 + delta, levelClass: "cmm-level-deep" };
  }

  buildDirectionalTree(rootId, direction, globalDepth = 0) {
    const positions = {};
    const vertical = direction === "up" || direction === "down";
    const sign = direction === "left" || direction === "up" ? -1 : 1;
    const appearance = this.getAppearance();
    const siblingScale = appearance.siblingSpacing / SPACING_DEFAULTS.siblingSpacing;
    const levelScale = appearance.levelSpacing / SPACING_DEFAULTS.levelSpacing;
    const largestCrossSize = Math.max(...[0, 1, 2, 3].map((offset) => {
      const size = this.nodeDimensions(globalDepth + offset);
      return vertical ? size.width : size.height;
    }));
    const leafGap = Math.max((vertical ? 220 : 88) * siblingScale, largestCrossSize + 8);
    const requestedDepthGap = (vertical ? 138 : 250) * levelScale;
    let leafCursor = 0;

    const depthPosition = (localDepth) => {
      let distance = 0;
      for (let step = 1; step <= localDepth; step += 1) {
        const previous = this.nodeDimensions(globalDepth + step - 1);
        const current = this.nodeDimensions(globalDepth + step);
        const minimum = vertical
          ? previous.height / 2 + current.height / 2 + 8
          : previous.width / 2 + current.width / 2 + 8;
        distance += Math.max(requestedDepthGap, minimum);
      }
      return sign * distance;
    };

    const place = (id, localDepth, depth) => {
      const node = this.getNode(id);
      if (!node) return 0;
      const children = this.visibleChildren(node);
      let crossCenter;
      if (!children.length) {
        crossCenter = leafCursor;
        leafCursor += leafGap;
      } else {
        const childCenters = children.map((childId) => place(childId, localDepth + 1, depth + 1));
        crossCenter = (childCenters[0] + childCenters[childCenters.length - 1]) / 2;
      }
      const size = this.nodeDimensions(depth);
      const axisPosition = depthPosition(localDepth);
      positions[id] = vertical
        ? { x: crossCenter - size.width / 2, y: axisPosition - size.height / 2, depth }
        : { x: axisPosition - size.width / 2, y: crossCenter - size.height / 2, depth };
      return crossCenter;
    };

    place(rootId, 0, globalDepth);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    Object.values(positions).forEach((position) => {
      const size = this.nodeDimensions(position.depth);
      minX = Math.min(minX, position.x);
      minY = Math.min(minY, position.y);
      maxX = Math.max(maxX, position.x + size.width);
      maxY = Math.max(maxY, position.y + size.height);
    });
    return { positions, bounds: { minX, minY, maxX, maxY } };
  }

  visibleLeafCount(nodeId) {
    const node = this.getNode(nodeId);
    if (!node) return 0;
    const children = this.visibleChildren(node);
    if (!children.length) return 1;
    return children.reduce((total, childId) => total + this.visibleLeafCount(childId), 0);
  }

  layout() {
    const mode = this.getAppearance().layout || "right";
    if (mode === "radial") return this.radialLayout();
    const positions = {};
    const vertical = mode === "down" || mode === "up";
    const siblingScale = this.getAppearance().siblingSpacing / SPACING_DEFAULTS.siblingSpacing;
    let crossCursor = 0;
    this.layoutRootIds().forEach((id) => {
      const tree = this.buildDirectionalTree(id, mode, 0);
      const crossMin = vertical ? tree.bounds.minX : tree.bounds.minY;
      const crossMax = vertical ? tree.bounds.maxX : tree.bounds.maxY;
      const shift = crossCursor - crossMin;
      Object.entries(tree.positions).forEach(([nodeId, position]) => {
        positions[nodeId] = vertical
          ? { ...position, x: position.x + shift }
          : { ...position, y: position.y + shift };
      });
      crossCursor += crossMax - crossMin + 96 * siblingScale;
    });
    return positions;
  }

  radialLayout() {
    const positions = {};
    const appearance = this.getAppearance();
    const siblingScale = appearance.siblingSpacing / SPACING_DEFAULTS.siblingSpacing;
    const levelScale = appearance.levelSpacing / SPACING_DEFAULTS.levelSpacing;
    let forestCursor = 0;
    this.layoutRootIds().forEach((rootId) => {
      const root = this.getNode(rootId);
      if (!root) return;
      const rootPositions = {};
      const rootSize = this.nodeDimensions(0);
      rootPositions[rootId] = { x: -rootSize.width / 2, y: -rootSize.height / 2, depth: 0 };
      const branches = this.visibleChildren(root);
      const sides = { right: [], left: [] };
      const sideWeight = { right: 0, left: 0 };
      branches.forEach((branchId) => {
        const weight = this.visibleLeafCount(branchId);
        const direction = sideWeight.right <= sideWeight.left ? "right" : "left";
        sides[direction].push({ branchId, weight });
        sideWeight[direction] += weight;
      });

      ["right", "left"].forEach((direction) => {
        const trees = sides[direction].map(({ branchId }) => ({ branchId, ...this.buildDirectionalTree(branchId, direction, 1) }));
        const laneGap = 76 * siblingScale;
        const totalHeight = trees.reduce((total, tree) => total + tree.bounds.maxY - tree.bounds.minY, 0)
          + Math.max(0, trees.length - 1) * laneGap;
        let laneCursor = -totalHeight / 2;
        trees.forEach((tree) => {
          const branchPosition = tree.positions[tree.branchId];
          const branchSize = this.nodeDimensions(1);
          const minimumAnchor = rootSize.width / 2 + branchSize.width / 2 + 8;
          const anchorDistance = Math.max(270 * levelScale, minimumAnchor);
          const anchorX = direction === "right" ? anchorDistance - branchSize.width / 2 : -anchorDistance - branchSize.width / 2;
          const shiftX = anchorX - branchPosition.x;
          const shiftY = laneCursor - tree.bounds.minY;
          Object.entries(tree.positions).forEach(([nodeId, position]) => {
            rootPositions[nodeId] = { ...position, x: position.x + shiftX, y: position.y + shiftY };
          });
          laneCursor += tree.bounds.maxY - tree.bounds.minY + laneGap;
        });
      });

      let minY = Infinity;
      let maxY = -Infinity;
      Object.values(rootPositions).forEach((position) => {
        const size = this.nodeDimensions(position.depth);
        minY = Math.min(minY, position.y);
        maxY = Math.max(maxY, position.y + size.height);
      });
      const forestShiftY = forestCursor - minY;
      Object.entries(rootPositions).forEach(([nodeId, position]) => {
        positions[nodeId] = { ...position, y: position.y + forestShiftY };
      });
      forestCursor += maxY - minY + 180 * siblingScale;
    });
    return positions;
  }

  edgePoint(position, size, toward) {
    const centerX = position.x + size.width / 2;
    const centerY = position.y + size.height / 2;
    const dx = toward.x - centerX;
    const dy = toward.y - centerY;
    const divisor = Math.max(Math.abs(dx) / (size.width / 2), Math.abs(dy) / (size.height / 2), 0.0001);
    return { x: centerX + dx / divisor, y: centerY + dy / divisor };
  }

  connectorAnchor(position, size, direction, outgoing) {
    const centerX = position.x + size.width / 2;
    const centerY = position.y + size.height / 2;
    if (direction === "right") return { x: outgoing ? position.x + size.width : position.x, y: centerY };
    if (direction === "left") return { x: outgoing ? position.x : position.x + size.width, y: centerY };
    if (direction === "down") return { x: centerX, y: outgoing ? position.y + size.height : position.y };
    return { x: centerX, y: outgoing ? position.y : position.y + size.height };
  }

  svgEl(tag, attrs = {}) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, String(value)));
    return element;
  }

  connectorPath(start, end, direction = null) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const horizontal = direction
      ? direction === "right" || direction === "left"
      : Math.abs(dx) >= Math.abs(dy);
    const trunkFactor = Math.min(0.7, Math.max(0.3, Number(this.getAppearance().trunkSpacing) / 100 || 0.48));
    if (horizontal) {
      const middleX = start.x + dx * trunkFactor;
      return `M ${start.x} ${start.y} C ${middleX} ${start.y}, ${middleX} ${end.y}, ${end.x} ${end.y}`;
    }
    const middleY = start.y + dy * trunkFactor;
    return `M ${start.x} ${start.y} C ${start.x} ${middleY}, ${end.x} ${middleY}, ${end.x} ${end.y}`;
  }

  edgeLevelClass(depth) {
    if (depth === 1) return "cmm-edge-level-1";
    if (depth === 2) return "cmm-edge-level-2";
    return "cmm-edge-level-3";
  }

  nodeDisplayColor(colorName, depth) {
    const color = NODE_COLORS[colorName] || NODE_COLORS.blue;
    const appearance = this.getAppearance();
    const light = usesLightPalette(appearance.background);
    const background = appearance.background === "paper" ? "#f7f3e8" : light ? "#ffffff" : "#11151c";
    const amount = depth === 0 ? 1 : depth === 1 ? 0.7 : 0.55;
    return mixHexColor(color.hex, background, amount);
  }

  appendEdge(pathData, edgeLevelClass, extraClass = "", colorName = null, colorDepth = 0) {
    const solidColor = this.nodeDisplayColor(colorName, colorDepth);
    const strokeWidth = edgeLevelClass === "cmm-edge-level-1" ? 4 : edgeLevelClass === "cmm-edge-level-2" ? 3 : 2;
    let style = `--cmm-edge-accent: ${solidColor}; stroke: ${solidColor}; stroke-width: ${strokeWidth}px`;
    const path = this.svgEl("path", {
      d: pathData,
      class: `cmm-edge ${edgeLevelClass}${extraClass ? ` ${extraClass}` : ""}`,
      style
    });
    this.scene.appendChild(path);
  }

  renderConnectorGroup(from, children) {
    if (!children.length) return;
    const fromSize = this.nodeDimensions(from.depth);
    const layoutMode = this.getAppearance().layout || "right";
    const fromCenter = { x: from.x + fromSize.width / 2, y: from.y + fromSize.height / 2 };
    children.forEach((to) => {
      const toSize = this.nodeDimensions(to.depth);
      const toCenter = { x: to.x + toSize.width / 2, y: to.y + toSize.height / 2 };
      const dx = toCenter.x - fromCenter.x;
      const direction = layoutMode === "radial"
        ? (dx >= 0 ? "right" : "left")
        : layoutMode;
      const start = this.connectorAnchor(from, fromSize, direction, true);
      const end = this.connectorAnchor(to, toSize, direction, false);
      this.appendEdge(
        this.connectorPath(start, end, direction),
        this.edgeLevelClass(to.depth),
        this.edgeExtraClass("", to.nodeId),
        this.effectiveNodeColor(from.nodeId),
        from.depth
      );
    });
  }

  renderRelationships(positions) {
    (this.map.relationships || []).forEach((relationship) => {
      const from = positions[relationship.fromId];
      const to = positions[relationship.toId];
      if (!from || !to || !this.isVisibleInFocus(relationship.fromId) || !this.isVisibleInFocus(relationship.toId)) return;
      const fromSize = this.nodeDimensions(from.depth);
      const toSize = this.nodeDimensions(to.depth);
      const fromCenter = { x: from.x + fromSize.width / 2, y: from.y + fromSize.height / 2 };
      const toCenter = { x: to.x + toSize.width / 2, y: to.y + toSize.height / 2 };
      const start = this.edgePoint(from, fromSize, toCenter);
      const end = this.edgePoint(to, toSize, fromCenter);
      const pathData = this.connectorPath(start, end);
      const dimmed = this.shouldDimNode(relationship.fromId) && this.shouldDimNode(relationship.toId);
      const group = this.svgEl("g", { class: `cmm-relationship-group${dimmed ? " is-dimmed" : ""}` });
      const path = this.svgEl("path", { d: pathData, class: "cmm-relationship" });
      const hit = this.svgEl("path", { d: pathData, class: "cmm-relationship-hit" });
      const openMenu = (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (this.isMobile) this.showMobileRelationshipSheet(relationship.id);
        else this.showRelationshipMenu(event, relationship.id);
      };
      hit.addEventListener("contextmenu", openMenu);
      this.installLongPress(hit, () => this.showMobileRelationshipSheet(relationship.id));
      group.append(path, hit);
      this.scene.appendChild(group);
    });
  }

  render() {
    if (!this.scene) return;
    this.hideNodeTooltip();
    this.hideNotesPreview();
    this.scene.replaceChildren();
    const positions = this.layout();

    this.renderRelationships(positions);

    Object.values(this.map.nodes).forEach((node) => {
      if (!positions[node.id] || !this.isVisibleInFocus(node.id) || node.collapsed) return;
      const children = node.childIds.map((childId) => positions[childId] && this.isVisibleInFocus(childId) ? { ...positions[childId], nodeId: childId } : null).filter(Boolean);
      this.renderConnectorGroup({ ...positions[node.id], nodeId: node.id }, children);
    });

    Object.entries(positions).forEach(([id, position]) => {
      if (!this.isVisibleInFocus(id)) return;
      const node = this.getNode(id);
      const locked = Boolean(this.lockingNodeId(id));
      const hasNotes = Boolean((node.notes || "").trim());
      const { width, height, levelClass } = this.nodeDimensions(position.depth);
      const nodeColor = NODE_COLORS[this.effectiveNodeColor(id)] || NODE_COLORS.blue;
      const group = this.svgEl("g", { class: `cmm-node ${levelClass}${id === this.selectedId ? " is-selected" : ""}${id === this.relationshipSourceId ? " is-relationship-source" : ""}${locked ? " is-locked" : ""}${this.shouldDimNode(id) ? " is-dimmed" : ""}`, transform: `translate(${position.x} ${position.y})`, tabindex: "0", style: `--cmm-node-accent: ${nodeColor.hex}; --cmm-node-root-text: ${nodeColor.text}` });
      group.dataset.nodeId = id;
      const rect = this.svgEl("rect", { width, height, rx: 10, ry: 10 });
      const rightReserve = 18 + (node.childIds.length ? 34 : 0) + (locked ? 22 : 0) + (hasNotes ? 24 : 0);
      const rootInset = position.depth === 0 ? Math.max(18, rightReserve) : 12;
      const labelArea = this.svgEl("foreignObject", {
        x: rootInset,
        y: 5,
        width: position.depth === 0 ? width - rootInset * 2 : width - rightReserve,
        height: height - 10,
        class: "cmm-node-label-area"
      });
      const label = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
      label.setAttribute("class", "cmm-node-label");
      label.textContent = node.text;
      labelArea.appendChild(label);
      group.append(rect, labelArea);
      let actionCursor = width - 18;
      if (node.childIds.length) {
        const foldToggle = this.svgEl("g", {
          class: "cmm-fold-toggle",
          role: "button",
          tabindex: "0",
          "aria-label": node.collapsed ? "Expand children" : "Fold children"
        });
        foldToggle.appendChild(this.svgEl("rect", {
          x: actionCursor - 16,
          y: 2,
          width: 32,
          height: 30,
          rx: 7,
          ry: 7,
          class: "cmm-fold-toggle-hit"
        }));
        const badge = this.svgEl("text", { x: actionCursor, y: 20, class: "cmm-badge" });
        badge.textContent = node.collapsed ? `+${node.childIds.length}` : "−";
        foldToggle.appendChild(badge);
        foldToggle.addEventListener("pointerdown", (event) => event.stopPropagation());
        foldToggle.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.toggleCollapsed(id);
        });
        foldToggle.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          event.stopPropagation();
          this.toggleCollapsed(id);
        });
        group.appendChild(foldToggle);
        actionCursor -= 34;
      }
      if (locked) {
        const lock = this.svgEl("g", { class: "cmm-lock-icon", transform: `translate(${actionCursor - 7} 14)` });
        lock.appendChild(this.svgEl("rect", { x: 1, y: 6, width: 12, height: 10, rx: 2, ry: 2 }));
        lock.appendChild(this.svgEl("path", { d: "M 4 6 V 4 A 3 3 0 0 1 10 4 V 6" }));
        group.appendChild(lock);
        actionCursor -= 22;
      }
      if (hasNotes) {
        const notesIndicator = this.svgEl("g", {
          class: "cmm-notes-indicator",
          transform: `translate(${actionCursor - 8} ${height / 2 - 8})`,
          role: "button",
          tabindex: "0",
          "aria-label": `Open notes for ${node.text}`
        });
        notesIndicator.appendChild(this.svgEl("circle", { cx: 8, cy: 8, r: 10, class: "cmm-notes-indicator-hit" }));
        notesIndicator.appendChild(this.svgEl("path", { d: "M 4 3 H 10 L 13 6 V 13 H 4 Z M 10 3 V 6 H 13 M 6 9 H 11 M 6 11 H 10" }));
        notesIndicator.addEventListener("pointerdown", (event) => event.stopPropagation());
        if (!this.isMobile) {
          notesIndicator.addEventListener("pointerenter", (event) => {
            this.hideNodeTooltip();
            this.scheduleNotesPreview(event.currentTarget, node);
          });
          notesIndicator.addEventListener("pointerleave", () => this.hideNotesPreview());
        }
        notesIndicator.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.hideNotesPreview();
          this.editNode(id);
        });
        notesIndicator.addEventListener("dblclick", (event) => event.stopPropagation());
        notesIndicator.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          event.stopPropagation();
          this.hideNotesPreview();
          this.editNode(id);
        });
        group.appendChild(notesIndicator);
      }
      group.addEventListener("click", (event) => {
        event.stopPropagation();
        if (Date.now() < this.suppressClickUntil) return;
        if (this.relationshipSourceId) {
          this.createRelationship(this.relationshipSourceId, id);
          return;
        }
        this.selectedId = id;
        this.viewport.focus();
        this.render();
      });
      if (!this.isMobile) {
        group.addEventListener("pointerenter", () => this.scheduleNodeTooltip(group, label, node));
        group.addEventListener("pointerleave", () => this.hideNodeTooltip());
      }
      group.addEventListener("dblclick", (event) => { event.stopPropagation(); this.editNode(id); });
      group.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.selectedId = id;
        this.viewport.focus();
        if (this.isMobile) this.showMobileNodeSheet(id);
        else this.showNodeMenu(event, id);
        this.render();
      });
      this.installLongPress(group, () => {
        this.selectedId = id;
        this.render();
        this.showMobileNodeSheet(id);
      }, () => Boolean(this.draggedId) || this.mobileGesture?.type === "pinch");
      group.addEventListener("pointerdown", (event) => this.startNodeDrag(event, id, group));
      this.scene.appendChild(group);
    });
    this.applyTransform();
    this.updateToolbarButtons();
    this.updateFocusStatus();
  }

  clearNodeDropTarget() {
    this.dropTargetId = null;
    this.dropPlacement = null;
    this.scene?.querySelectorAll(".is-drop-target").forEach((element) => element.removeClass("is-drop-target"));
    this.scene?.querySelector(".cmm-insertion-line")?.remove();
  }

  findNodeDropCandidate(pointerX, pointerY) {
    const dragged = this.getNode(this.draggedId);
    if (!dragged) return null;
    const positions = this.layout();

    for (const [id, position] of Object.entries(positions)) {
      if (id === this.draggedId || !this.isVisibleInFocus(id) || this.isDescendant(id, this.draggedId) || this.lockingNodeId(id)) continue;
      const { width, height } = this.nodeDimensions(position.depth);
      if (pointerX >= position.x && pointerX <= position.x + width && pointerY >= position.y && pointerY <= position.y + height) {
        return { targetId: id, placement: "child", position };
      }
    }

    const siblings = dragged.parentId ? this.getNode(dragged.parentId)?.childIds : this.map.rootIds;
    if (!siblings) return null;
    const parent = dragged.parentId ? this.getNode(dragged.parentId) : null;
    if (parent && ["asc", "desc"].includes(parent.childSort)) return null;
    const layoutMode = this.getAppearance().layout || "right";
    const horizontalOrder = ["up", "down"].includes(layoutMode);
    const effectiveScale = Number.isFinite(this.scale) && this.scale > 0 ? this.scale : 1;
    const gapReach = 44 / effectiveScale;
    const crossReach = 32 / effectiveScale;
    let best = null;
    siblings.forEach((id) => {
      if (id === this.draggedId || !positions[id] || !this.isVisibleInFocus(id) || this.lockingNodeId(id)) return;
      const position = positions[id];
      const { width, height } = this.nodeDimensions(position.depth);
      const crossInside = horizontalOrder
        ? pointerY >= position.y - crossReach && pointerY <= position.y + height + crossReach
        : pointerX >= position.x - crossReach && pointerX <= position.x + width + crossReach;
      if (!crossInside) return;
      const edges = horizontalOrder
        ? [
          { placement: "before", line: position.x - 8, inside: pointerX >= position.x - gapReach && pointerX < position.x },
          { placement: "after", line: position.x + width + 8, inside: pointerX > position.x + width && pointerX <= position.x + width + gapReach }
        ]
        : [
          { placement: "before", line: position.y - 8, inside: pointerY >= position.y - gapReach && pointerY < position.y },
          { placement: "after", line: position.y + height + 8, inside: pointerY > position.y + height && pointerY <= position.y + height + gapReach }
        ];
      edges.forEach((edge) => {
        if (!edge.inside) return;
        const coordinate = horizontalOrder ? pointerX : pointerY;
        const score = Math.abs(coordinate - edge.line);
        if (!best || score < best.score) best = { targetId: id, placement: edge.placement, position, score };
      });
    });
    return best;
  }

  updateNodeDropTarget(event) {
    if (!this.draggedId) return;
    const rect = this.viewport.getBoundingClientRect();
    const pointerX = (event.clientX - rect.left - this.offsetX) / this.scale;
    const pointerY = (event.clientY - rect.top - this.offsetY) / this.scale;
    const candidate = this.findNodeDropCandidate(pointerX, pointerY);
    this.clearNodeDropTarget();
    if (!candidate) return;
    this.dropTargetId = candidate.targetId;
    this.dropPlacement = candidate.placement;
    if (candidate.placement === "child") {
      this.scene.querySelector(`[data-node-id="${CSS.escape(candidate.targetId)}"]`)?.addClass("is-drop-target");
      return;
    }
    const { position } = candidate;
    const { width, height } = this.nodeDimensions(position.depth);
    const layoutMode = this.getAppearance().layout || "right";
    const horizontalOrder = ["up", "down"].includes(layoutMode);
    const line = this.svgEl("line", { class: "cmm-insertion-line" });
    if (horizontalOrder) {
      const x = position.x + (candidate.placement === "before" ? -8 : width + 8);
      line.setAttribute("x1", x); line.setAttribute("x2", x);
      line.setAttribute("y1", position.y); line.setAttribute("y2", position.y + height);
    } else {
      const y = position.y + (candidate.placement === "before" ? -8 : height + 8);
      line.setAttribute("x1", position.x); line.setAttribute("x2", position.x + width);
      line.setAttribute("y1", y); line.setAttribute("y2", y);
    }
    this.scene.appendChild(line);
  }

  startNodeDrag(event, id, group) {
    if (event.button !== 0 || event.pointerType === "touch") return;
    if (this.lockingNodeId(id)) return;
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    const move = (moveEvent) => {
      if (this.mobileGesture?.type === "pinch") return;
      if (!moved && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > 6) {
        moved = true;
        this.hideNodeTooltip();
        this.hideNotesPreview();
        this.draggedId = id;
        group.addClass("is-dragging");
      }
      if (moved) this.updateNodeDropTarget(moveEvent);
    };
    const up = async (upEvent) => {
      if (moved) this.updateNodeDropTarget(upEvent);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      group.removeClass("is-dragging");
      const target = this.dropTargetId;
      const placement = this.dropPlacement;
      this.draggedId = null;
      this.clearNodeDropTarget();
      if (moved && target) {
        if (placement === "before" || placement === "after") await this.reorderSibling(id, target, placement);
        else await this.reparent(id, target);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  centerMap() {
    if (!this.viewport) return;
    const positions = this.layout();
    const entries = Object.entries(positions).filter(([id]) => this.isVisibleInFocus(id)).map(([, position]) => position);
    if (!entries.length) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    entries.forEach((position) => {
      const size = this.nodeDimensions(position.depth);
      minX = Math.min(minX, position.x);
      minY = Math.min(minY, position.y);
      maxX = Math.max(maxX, position.x + size.width);
      maxY = Math.max(maxY, position.y + size.height);
    });
    const viewportWidth = this.viewport.clientWidth || 900;
    const viewportHeight = this.viewport.clientHeight || 600;
    const mapWidth = Math.max(1, maxX - minX);
    const mapHeight = Math.max(1, maxY - minY);
    this.scale = Math.min(1, Math.max(0.1, Math.min((viewportWidth - 80) / mapWidth, (viewportHeight - 80) / mapHeight)));
    this.offsetX = (viewportWidth - mapWidth * this.scale) / 2 - minX * this.scale;
    this.offsetY = (viewportHeight - mapHeight * this.scale) / 2 - minY * this.scale;
    this.applyTransform();
  }

  hideNodeTooltip() {
    window.clearTimeout(this.nodeTooltipTimer);
    this.nodeTooltipTimer = null;
    this.nodeTooltipEl?.remove();
    this.nodeTooltipEl = null;
  }

  scheduleNodeTooltip(group, label, node) {
    this.hideNodeTooltip();
    if (this.isMobile || this.plugin.data.showNodeTooltips === false || this.draggedId) return;
    this.nodeTooltipTimer = window.setTimeout(() => {
      this.nodeTooltipTimer = null;
      if (this.plugin.data.showNodeTooltips === false || this.draggedId || !group.isConnected || !group.matches(":hover")) return;
      const truncated = label.scrollHeight > label.clientHeight + 1 || label.scrollWidth > label.clientWidth + 1;
      if (!truncated) return;
      const tooltip = document.body.createDiv({ cls: "cmm-node-tooltip", text: node.text, attr: { role: "tooltip" } });
      tooltip.style.visibility = "hidden";
      const nodeRect = group.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      const margin = 10;
      const left = Math.min(window.innerWidth - tooltipRect.width - margin, Math.max(margin, nodeRect.left + nodeRect.width / 2 - tooltipRect.width / 2));
      const above = nodeRect.top - tooltipRect.height - 8;
      const top = above >= margin ? above : Math.min(window.innerHeight - tooltipRect.height - margin, nodeRect.bottom + 8);
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
      tooltip.style.visibility = "visible";
      this.nodeTooltipEl = tooltip;
    }, 400);
  }

  hideNotesPreview() {
    window.clearTimeout(this.notesPreviewTimer);
    this.notesPreviewTimer = null;
    this.notesPreviewEl?.remove();
    this.notesPreviewEl = null;
  }

  scheduleNotesPreview(indicator, node) {
    this.hideNotesPreview();
    if (this.isMobile || this.draggedId || !(node.notes || "").trim()) return;
    this.notesPreviewTimer = window.setTimeout(() => {
      this.notesPreviewTimer = null;
      if (this.draggedId || !indicator.isConnected || !indicator.matches(":hover")) return;
      const normalized = node.notes.trim().replace(/\s+/g, " ");
      const preview = normalized.length > 180 ? `${normalized.slice(0, 177)}…` : normalized;
      const tooltip = document.body.createDiv({ cls: "cmm-notes-preview", text: preview, attr: { role: "tooltip" } });
      tooltip.style.visibility = "hidden";
      const anchorRect = indicator.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      const margin = 10;
      const left = Math.min(window.innerWidth - tooltipRect.width - margin, Math.max(margin, anchorRect.left + anchorRect.width / 2 - tooltipRect.width / 2));
      const above = anchorRect.top - tooltipRect.height - 8;
      const top = above >= margin ? above : Math.min(window.innerHeight - tooltipRect.height - margin, anchorRect.bottom + 8);
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
      tooltip.style.visibility = "visible";
      this.notesPreviewEl = tooltip;
    }, 350);
  }

  showHelp() {
    this.plugin.openHelpWindow();
  }

  async onClose() {
    this.hideNodeTooltip();
    this.hideNotesPreview();
    this.closeNodeSearch();
    this.closeMobileSheet();
    if (this.headerRenameHandler && this.containerEl) this.containerEl.removeEventListener("click", this.headerRenameHandler);
    this.headerRenameHandler = null;
  }
}

class KempfSimpleMindMapSettingsTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "The Kempf Simple Mind Map options" });

    new Setting(containerEl)
      .setName("Show full node name on hover")
      .setDesc("Show a node's complete name after a short delay when its text is truncated.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.data.showNodeTooltips !== false);
        toggle.onChange(async (value) => {
          this.plugin.data.showNodeTooltips = value;
          if (!value) this.plugin.hideAllNodeTooltips();
          await this.plugin.savePluginData();
        });
      });

    new Setting(containerEl)
      .setName("Default background")
      .setDesc("Background used when creating a new .ksmm map.")
      .addDropdown((dropdown) => {
        Object.entries(BACKGROUND_OPTIONS).forEach(([value, label]) => dropdown.addOption(value, label));
        dropdown.setValue(normalizeBackground(this.plugin.data.backgroundTheme));
        dropdown.onChange(async (value) => {
          this.plugin.data.backgroundTheme = normalizeBackground(value);
          await this.plugin.savePluginData();
        });
      });

    new Setting(containerEl)
      .setName("Default highlight color")
      .setDesc("Root, connector, and selection color used when creating a new .ksmm map.")
      .addDropdown((dropdown) => {
        ["blue", "cyan", "teal", "green", "lime", "yellow", "orange", "red", "pink", "purple", "indigo"].forEach((color) => {
          dropdown.addOption(color, color.charAt(0).toUpperCase() + color.slice(1));
        });
        dropdown.setValue(this.plugin.data.highlightColor || "blue");
        dropdown.onChange(async (value) => {
          const allowed = ["blue", "cyan", "teal", "green", "lime", "yellow", "orange", "red", "pink", "purple", "indigo"];
          this.plugin.data.highlightColor = allowed.includes(value) ? value : "blue";
          await this.plugin.savePluginData();
        });
      });

    new Setting(containerEl)
      .setName("Default layout")
      .setDesc("Layout used when creating a new .ksmm map. Existing maps keep their own layout.")
      .addDropdown((dropdown) => {
        ["right", "left", "down", "up", "radial"].forEach((layout) => {
          dropdown.addOption(layout, layout.charAt(0).toUpperCase() + layout.slice(1));
        });
        dropdown.setValue(this.plugin.data.defaultLayout || "right");
        dropdown.onChange(async (value) => {
          this.plugin.data.defaultLayout = value;
          await this.plugin.savePluginData();
        });
      });

    new Setting(containerEl)
      .setName("Random colors for new branches")
      .setDesc("Default for new maps. When enabled, each new child of the central node receives a random branch color.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.data.randomBranchColors === true)
        .onChange(async (value) => {
          this.plugin.data.randomBranchColors = value;
          await this.plugin.savePluginData();
        }));

    const folders = this.app.vault.getAllLoadedFiles()
      .filter((file) => file instanceof TFolder && file.path !== "/")
      .sort((a, b) => a.path.localeCompare(b.path));

    containerEl.createEl("h3", { text: "New map folder" });

    new Setting(containerEl)
      .setName("Use an existing folder")
      .setDesc("Choose where new .ksmm maps are saved. To use a folder that does not exist yet, create it below.")
      .addDropdown((dropdown) => {
        dropdown.addOption("", "Vault root");
        folders.forEach((folder) => dropdown.addOption(folder.path, folder.path));
        const selectedFolder = folders.some((folder) => folder.path === this.plugin.data.defaultFolder)
          ? this.plugin.data.defaultFolder
          : "";
        dropdown.setValue(selectedFolder || "");
        dropdown.onChange(async (value) => {
          this.plugin.data.defaultFolder = value;
          await this.plugin.savePluginData();
        });
      });

    let newFolderPath = "";
    new Setting(containerEl)
      .setName("Create a new folder")
      .setDesc("Type a folder name or path. The plugin will create it in your vault and immediately use it for new maps. Nested folders are supported.")
      .addText((text) => {
        text.setPlaceholder("Mind Maps or Projects/Mind Maps");
        text.onChange((value) => (newFolderPath = value));
      })
      .addButton((button) => {
        button.setButtonText("Create folder and use it").setCta().onClick(async () => {
          const cleanPath = normalizePath(newFolderPath.trim().replace(/^\/+|\/+$/g, ""));
          if (!cleanPath || cleanPath === "/") {
            new Notice("Enter a folder name first.");
            return;
          }
          try {
            await this.plugin.createFolderPath(cleanPath);
            this.plugin.data.defaultFolder = cleanPath;
            await this.plugin.savePluginData();
            new Notice(`New mind maps will be saved in ${cleanPath}.`);
            this.display();
          } catch (error) {
            new Notice(error.message || "The folder could not be created.");
          }
        });
      });
  }
}

module.exports = class KempfSimpleMindMapPlugin extends Plugin {
  async onload() {
    this.data = Object.assign({ backgroundTheme: "system", highlightColor: "blue", defaultLayout: "right", defaultFolder: "", helpWindowGeometry: null, nodeEditorGeometry: null, searchPanelGeometry: null, showNodeTooltips: true, randomBranchColors: false }, await this.loadData());
    this.data.backgroundTheme = normalizeBackground(this.data.backgroundTheme || this.data.theme);
    this.branchClipboard = null;
    this.helpWindowEl = null;
    this.helpResizeObserver = null;
    this.helpSaveTimer = null;
    this.registerView(VIEW_TYPE, (leaf) => new KempfSimpleMindMapView(leaf, this));
    this.registerExtensions(["ksmm"], VIEW_TYPE);
    this.addSettingTab(new KempfSimpleMindMapSettingsTab(this.app, this));
    this.addRibbonIcon("list-tree", "Create The Kempf Simple Mind Map", () => this.createNewMap());
    this.addCommand({ id: "new-kempfs-simple-mind-map", name: "Create new mind map", callback: () => this.createNewMap() });
  }

  async savePluginData() { await this.saveData(this.data); }

  hideAllNodeTooltips() {
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => leaf.view?.hideNodeTooltip?.());
  }

  scheduleHelpGeometrySave() {
    window.clearTimeout(this.helpSaveTimer);
    this.helpSaveTimer = window.setTimeout(async () => {
      if (!this.helpWindowEl || !this.helpWindowEl.isConnected) return;
      const rect = this.helpWindowEl.getBoundingClientRect();
      this.data.helpWindowGeometry = {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
      await this.savePluginData();
    }, 180);
  }

  closeHelpWindow() {
    if (!this.helpWindowEl) return;
    const rect = this.helpWindowEl.getBoundingClientRect();
    this.data.helpWindowGeometry = {
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
    this.helpResizeObserver?.disconnect();
    this.helpResizeObserver = null;
    this.helpWindowEl.remove();
    this.helpWindowEl = null;
    this.savePluginData();
  }

  openHelpWindow() {
    if (this.helpWindowEl && this.helpWindowEl.isConnected) {
      this.helpWindowEl.style.zIndex = String(10000 + Math.floor(Date.now() % 1000));
      this.helpWindowEl.focus();
      return;
    }

    const saved = this.data.helpWindowGeometry || {};
    const width = Math.min(window.innerWidth - 24, Math.max(420, Number(saved.width) || 560));
    const height = Math.min(window.innerHeight - 24, Math.max(320, Number(saved.height) || 620));
    const defaultLeft = Math.max(12, Math.round((window.innerWidth - width) / 2));
    const defaultTop = Math.max(12, Math.round((window.innerHeight - height) / 2));
    const left = Math.max(0, Math.min(window.innerWidth - width - 12, Math.max(12, Number(saved.left) || defaultLeft)));
    const top = Math.max(0, Math.min(window.innerHeight - height - 12, Math.max(12, Number(saved.top) || defaultTop)));

    const panel = document.body.createDiv({ cls: "cmm-help-window", attr: { tabindex: "-1", role: "dialog", "aria-label": "The Kempf Simple Mind Map Help" } });
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.width = `${width}px`;
    panel.style.height = `${height}px`;
    const titleBar = panel.createDiv({ cls: "cmm-help-titlebar" });
    titleBar.createEl("strong", { text: "The Kempf Simple Mind Map Help" });
    const closeButton = titleBar.createEl("button", { text: "×", cls: "cmm-help-close", attr: { "aria-label": "Close help" } });
    const content = panel.createDiv({ cls: "cmm-help-content" });

    const section = (heading, paragraphs, items = []) => {
      content.createEl("h2", { text: heading });
      paragraphs.forEach((text) => content.createEl("p", { text }));
      if (items.length) {
        const list = content.createEl("ul");
        items.forEach((text) => list.createEl("li", { text }));
      }
    };
    const mobile = Boolean(Platform?.isMobile);
    section("Start here", ["A mind map begins with one central idea. Select a node, then build outward with children and siblings. Your work saves automatically."], [
      "Click the map name above the canvas to rename the file.",
      mobile ? "Use Edit in the toolbar to change the selected node's title or notes." : "Double-click a node, press Enter, or press F2 to edit its title or notes.",
      mobile ? "Press and hold a node to open its actions." : "Right-click a node, or press and hold it on a touchscreen, for branch actions.",
      mobile ? "Press and hold empty space, or tap the three-dot button, for map options." : "Right-click empty space for map settings, layout choices, importing, and exporting."
    ]);
    section("Add and arrange ideas", [], [
      mobile ? "Select a node, then use +C to add a child or +S to add a sibling." : "Tab or C adds a child to the selected node.",
      mobile ? "The original node stays selected so you can quickly add several ideas." : "S adds a sibling. The original node stays selected so you can quickly add several ideas.",
      ...(mobile ? [] : ["Drag a node onto another node to move it into that branch.", "Drag a node above or below a sibling to change its manual order."]),
      "Copy a node by itself or copy its complete branch, then paste it beneath a node in this map or another open map.",
      "Sort a node's children alphabetically or in reverse. Returning to Manual order restores the saved manual order.",
      "Delete removes the selected node and its entire branch after confirmation."
    ]);
    section("Move around the map", [], [
      "Click a node to select it. Click empty space to clear the selection.",
      ...(mobile ? ["Drag with one finger to pan the map.", "Pinch with two fingers to zoom or pan without triggering Obsidian navigation."] : ["Use the arrow keys to move between parents, children, and siblings.", "Drag empty space with the left mouse button, or drag anywhere with the middle mouse button, to pan.", "Use the mouse wheel or the plus and minus buttons to zoom.", "Touchscreen laptops also support one-finger panning, pinch-to-zoom, and press-and-hold menus."]),
      "Full map fits the entire mind map on screen."
    ]);
    section("Titles and notes", [], [
      mobile ? "Select a node and tap Edit to open its title and notes." : "Double-click a node, press Enter, or press F2 to open its title and notes.",
      "A note indicator appears when a node has notes. Click it to read or edit them.",
      ...(mobile ? [] : ["Hover over a shortened title to see the full name. This can be turned off in plugin settings."])
    ]);
    section("Manage branches", [], [
      mobile ? "Tap the minus or numbered badge to fold or unfold a branch." : "Click the minus or numbered badge to fold or unfold a branch. Space does the same for the selected node.",
      "Focus branch shows only the selected branch and its path back to the central idea.",
      "A locked branch displays a padlock and is protected from accidental changes until you unlock it.",
      "Choose a node color to create a manual color override. Inheriting descendants follow it, while descendants with their own manual colors stay unchanged.",
      "When a branch is moved, nodes without manual color overrides inherit their new parent's color."
    ]);
    section("Change the look", [], [
      "Open Map Settings from the toolbar or by right-clicking empty space.",
      "Choose a light or dark background, a highlight color, and a right, left, down, up, or radial layout.",
      "Adjust level spacing, sibling spacing, node padding, and connector spacing while watching the live preview.",
      "Dim unrelated branches to make the selected branch easier to follow."
    ]);
    section("Import, export, and undo", [], [
      "Use Search or Ctrl/Cmd+F to open a small movable search panel. Previous and Next move through matches without letting the panel cover the selected node.",
      "Import Markdown, OPML, another .ksmm mind map, or a JSON backup.",
      "Export as Markdown, OPML, .ksmm, JSON backup, PNG, JPG, SVG, or PDF.",
      mobile ? "Use the undo and redo buttons in the toolbar." : "Use Ctrl/Cmd+Z to undo and Ctrl/Cmd+Shift+Z or Ctrl+Y to redo."
    ]);

    this.helpWindowEl = panel;
    closeButton.addEventListener("click", () => this.closeHelpWindow());
    closeButton.addEventListener("pointerdown", (event) => event.stopPropagation());

    let drag = null;
    titleBar.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target === closeButton) return;
      const rect = panel.getBoundingClientRect();
      drag = { startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top };
      titleBar.setPointerCapture(event.pointerId);
      panel.addClass("is-dragging");
      event.preventDefault();
    });
    titleBar.addEventListener("pointermove", (event) => {
      if (!drag) return;
      const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth);
      const maxTop = Math.max(0, window.innerHeight - panel.offsetHeight);
      panel.style.left = `${Math.min(maxLeft, Math.max(0, drag.left + event.clientX - drag.startX))}px`;
      panel.style.top = `${Math.min(maxTop, Math.max(0, drag.top + event.clientY - drag.startY))}px`;
    });
    const finishDrag = () => {
      if (!drag) return;
      drag = null;
      panel.removeClass("is-dragging");
      this.scheduleHelpGeometrySave();
    };
    titleBar.addEventListener("pointerup", finishDrag);
    titleBar.addEventListener("pointercancel", finishDrag);

    this.helpResizeObserver = new ResizeObserver(() => this.scheduleHelpGeometrySave());
    this.helpResizeObserver.observe(panel);
    panel.focus();
  }

  getDefaultAppearance() {
    return {
      background: normalizeBackground(this.data.backgroundTheme || this.data.theme),
      highlight: this.data.highlightColor || "blue",
      layout: ["right", "left", "down", "up", "radial"].includes(this.data.defaultLayout) ? this.data.defaultLayout : "right",
      randomBranchColors: this.data.randomBranchColors === true
    };
  }

  async createFolderPath(folderPath) {
    const segments = normalizePath(folderPath).split("/").filter(Boolean);
    let currentPath = "";
    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      const existing = this.app.vault.getAbstractFileByPath(currentPath);
      if (existing && !(existing instanceof TFolder)) {
        throw new Error(`${currentPath} already exists as a file.`);
      }
      if (!existing) await this.app.vault.createFolder(currentPath);
    }
  }

  async createNewMap() {
    new NodeEditorModal(this.app, this, "Create mind map", { text: "Central idea", notes: "" }, async (centralNodeText, centralNodeNotes) => {
      const parentPath = this.pluginFolderPath();
      const baseName = "Untitled mind map";
      let counter = 0;
      let path;
      do {
        const suffix = counter === 0 ? "" : ` ${counter + 1}`;
        path = normalizePath(`${parentPath ? `${parentPath}/` : ""}${baseName}${suffix}.ksmm`);
        counter += 1;
      } while (this.app.vault.getAbstractFileByPath(path));

      const map = createBlankMap(this.getDefaultAppearance(), centralNodeText, centralNodeNotes);
      const file = await this.app.vault.create(path, JSON.stringify(map, null, 2));
      const leaf = this.app.workspace.getLeaf("tab");
      await leaf.openFile(file);
      this.app.workspace.revealLeaf(leaf);
      window.setTimeout(() => {
        const view = leaf.view;
        if (!view || view.getViewType?.() !== VIEW_TYPE) return;
        const rootId = view.map?.rootIds?.[0];
        if (!rootId) return;
        view.selectedId = rootId;
        view.render();
        view.viewport?.focus();
      }, 0);
    }).open();
  }

  pluginFolderPath() {
    const rawFolder = (this.data.defaultFolder || "").trim();
    if (!rawFolder) return "";
    const configured = normalizePath(rawFolder);
    const target = configured ? this.app.vault.getAbstractFileByPath(configured) : null;
    return target instanceof TFolder ? configured : "";
  }

  onunload() {
    window.clearTimeout(this.helpSaveTimer);
    if (this.helpWindowEl && this.helpWindowEl.isConnected) {
      const rect = this.helpWindowEl.getBoundingClientRect();
      this.data.helpWindowGeometry = { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) };
      this.savePluginData();
    }
    this.helpResizeObserver?.disconnect();
    this.helpWindowEl?.remove();
    this.helpWindowEl = null;
    this.hideAllNodeTooltips();
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }
};
