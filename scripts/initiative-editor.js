(() => {
  const MODULE_ID = "initiative-editor";
  const TEMPLATE = `modules/${MODULE_ID}/templates/editor.html`;
  const BaseApplication = globalThis.Application ?? globalThis.foundry?.appv1?.api?.Application;

  console.log("Initiative Editor | Loading module script");

  if (!BaseApplication) {
    Hooks.once("ready", () => {
      ui.notifications.error("Initiative Editor could not find Foundry's Application API.");
    });
    return;
  }

  function collectionContents(collection) {
    if (!collection) return [];
    if (Array.isArray(collection)) return collection;
    if (Array.isArray(collection.contents)) return collection.contents;
    if (typeof collection.filter === "function") return collection.filter(() => true);
    if (typeof collection.values === "function") return Array.from(collection.values());
    return Array.from(collection);
  }

  class InitiativeEditorApp extends BaseApplication {
    constructor(...args) {
      super(...args);
      this._lastCheckedCombatantId = null;
    }

    static get defaultOptions() {
      return foundry.utils.mergeObject(super.defaultOptions, {
        id: "initiative-editor-app",
        title: "Initiative Editor",
        template: TEMPLATE,
        width: 460,
        height: "auto",
        resizable: true,
        classes: ["initiative-editor-window"]
      });
    }

    get combat() {
      return game.combat ?? null;
    }

    async getData() {
      const combat = this.combat;
      const selectedTokenIds = new Set(canvas?.tokens?.controlled?.map((token) => token.id) ?? []);
      const combatants = collectionContents(combat?.combatants);

      return {
        hasCombat: Boolean(combat),
        combatants: combatants.map((combatant, index) => {
          const actor = combatant.actor;
          const token = combatant.token;
          const tokenId = combatant.tokenId ?? token?.id ?? "";
          const isSelectedToken = selectedTokenIds.has(tokenId);

          return {
            id: combatant.id,
            tokenId,
            index: index + 1,
            name: combatant.name,
            img: token?.texture?.src || actor?.img || "icons/svg/mystery-man.svg",
            initiative: combatant.initiative ?? "",
            checked: isSelectedToken,
            isPlayerOwned: Boolean(actor?.hasPlayerOwner),
            disposition: token?.disposition ?? 0,
            defeated: Boolean(combatant.defeated)
          };
        })
      };
    }

    activateListeners(html) {
      super.activateListeners(html);

      html.find("[data-action='set-number']").on("click", (event) => this._setNumber(event));
      html.find("[data-action='players-first']").on("click", () => this._playersFirst());
      html.find("[data-action='apply-order']").on("click", () => this._applyOrder(html));
      html.find("[data-action='refresh']").on("click", () => this.render(false));
      html.find("[data-action='select-controlled']").on("click", () => this._selectControlledTokens(html));
      html.find("[data-action='select-players']").on("click", () => this._selectByOwnership(html, true));
      html.find("[data-action='select-npcs']").on("click", () => this._selectByOwnership(html, false));
      html.find("[data-action='select-all']").on("click", () => this._setChecked(html, true));
      html.find("[data-action='select-none']").on("click", () => this._setChecked(html, false));
      html.find("[name='combatant']").on("click", (event) => this._onCombatantCheckboxClick(event, html));
      html.find("[name='row-initiative']").on("change", (event) => this._setRowInitiative(event));
      html.find("[name='row-initiative']").on("keydown", (event) => this._onRowInitiativeKeydown(event));
      html.find("[name='row-initiative']").on("focus", (event) => event.currentTarget.select());
      html.find("[name='row-initiative']").on("click", (event) => event.currentTarget.select());
      html.find(".initiative-editor-row").on("dragstart", (event) => this._onDragStart(event));
      html.find(".initiative-editor-row").on("dragover", (event) => event.preventDefault());
      html.find(".initiative-editor-row").on("drop", (event) => this._onDrop(event));
    }

    async _setNumber(event) {
      const form = event.currentTarget.closest("form");
      const value = Number(form.querySelector("[name='initiative-value']").value);
      if (!Number.isFinite(value)) {
        ui.notifications.warn("Enter a valid initiative number.");
        return;
      }

      const ids = this._checkedCombatantIds(form);
      if (!ids.length) {
        ui.notifications.warn("Select one or more combatants first.");
        return;
      }

      await this._updateInitiatives(ids.map((id) => ({ id, initiative: value })));
      ui.notifications.info(`Set initiative to ${value} for ${ids.length} combatant${ids.length === 1 ? "" : "s"}.`);
      this.render(false);
    }

    async _playersFirst() {
      const combat = this.combat;
      if (!combat) return;

      const updates = collectionContents(combat.combatants).map((combatant) => ({
        id: combatant.id,
        initiative: combatant.actor?.hasPlayerOwner ? 10 : 0
      }));

      await this._updateInitiatives(updates);
      ui.notifications.info("Set player-owned combatants to 10 and everyone else to 0.");
      this.render(false);
    }

    async _applyOrder(html) {
      const form = html[0].querySelector("form");
      await this._applyOrderFromForm(form, { render: true, notify: true });
    }

    async _applyOrderFromForm(form, { render = false, notify = false } = {}) {
      const top = Number(form.querySelector("[name='order-start']").value);
      const step = Math.abs(Number(form.querySelector("[name='order-step']").value));

      if (!Number.isFinite(top) || !Number.isFinite(step) || step === 0) {
        ui.notifications.warn("Enter valid order start and step numbers.");
        return;
      }

      const rows = Array.from(form.querySelectorAll(".initiative-editor-row"));
      const updates = rows.map((row, index) => ({
        id: row.dataset.combatantId,
        initiative: top - (index * step)
      }));

      await this._updateInitiatives(updates);
      if (notify) ui.notifications.info("Applied initiative order from the editor list.");
      if (render) this.render(false);
    }

    async _updateInitiatives(updates) {
      const combat = this.combat;
      if (!combat) {
        ui.notifications.warn("There is no active combat encounter.");
        return;
      }

      const activeId = combat.combatant?.id;
      const payload = updates.map((update) => ({ _id: update.id, initiative: update.initiative }));
      await combat.updateEmbeddedDocuments("Combatant", payload);

      if (activeId) {
        const turn = combat.turns.findIndex((combatant) => combatant.id === activeId);
        if (turn >= 0 && combat.turn !== turn) await combat.update({ turn });
      }
    }

    async _setRowInitiative(event) {
      const input = event.currentTarget;
      const value = Number(input.value);
      if (!Number.isFinite(value)) {
        ui.notifications.warn("Enter a valid initiative number.");
        return;
      }

      const row = input.closest(".initiative-editor-row");
      if (!row?.dataset.combatantId) return;

      await this._updateInitiatives([{ id: row.dataset.combatantId, initiative: value }]);
      ui.notifications.info(`Set ${row.dataset.combatantName ?? "combatant"} to ${value}.`);
    }

    _onRowInitiativeKeydown(event) {
      if (event.key !== "Enter") return;
      event.preventDefault();
      event.currentTarget.blur();
    }

    _checkedCombatantIds(form) {
      return Array.from(form.querySelectorAll("[name='combatant']:checked")).map((input) => input.value);
    }

    _setChecked(html, checked) {
      html[0].querySelectorAll("[name='combatant']").forEach((input) => {
        input.checked = checked;
      });
      this._lastCheckedCombatantId = null;
    }

    _selectControlledTokens(html) {
      const selectedTokenIds = new Set(canvas?.tokens?.controlled?.map((token) => token.id) ?? []);
      html[0].querySelectorAll(".initiative-editor-row").forEach((row) => {
        row.querySelector("[name='combatant']").checked = selectedTokenIds.has(row.dataset.tokenId);
      });
      this._lastCheckedCombatantId = null;
    }

    _selectByOwnership(html, playerOwned) {
      html[0].querySelectorAll(".initiative-editor-row").forEach((row) => {
        row.querySelector("[name='combatant']").checked = row.dataset.playerOwned === String(playerOwned);
      });
      this._lastCheckedCombatantId = null;
    }

    _onCombatantCheckboxClick(event, html) {
      const checkbox = event.currentTarget;
      const root = html[0] ?? html;
      const checkboxes = Array.from(root.querySelectorAll("[name='combatant']"));

      if (event.shiftKey && this._lastCheckedCombatantId) {
        const start = checkboxes.findIndex((input) => input.value === this._lastCheckedCombatantId);
        const end = checkboxes.indexOf(checkbox);

        if (start >= 0 && end >= 0) {
          const [from, to] = start < end ? [start, end] : [end, start];
          const checked = checkbox.checked;
          checkboxes.slice(from, to + 1).forEach((input) => {
            input.checked = checked;
          });
        }
      }

      this._lastCheckedCombatantId = checkbox.value;
    }

    _onDragStart(event) {
      const row = event.currentTarget;
      const list = row.closest(".initiative-editor-list");
      const selectedRows = Array.from(list.querySelectorAll(".initiative-editor-row"))
        .filter((candidate) => candidate.querySelector("[name='combatant']")?.checked);
      const rowsToMove = row.querySelector("[name='combatant']")?.checked ? selectedRows : [row];
      const ids = rowsToMove.map((candidate) => candidate.dataset.combatantId);

      event.originalEvent.dataTransfer.setData("application/json", JSON.stringify(ids));
      event.originalEvent.dataTransfer.setData("text/plain", row.dataset.combatantId);
      event.originalEvent.dataTransfer.effectAllowed = "move";
    }

    async _onDrop(event) {
      event.preventDefault();
      const target = event.currentTarget;
      const list = target.closest(".initiative-editor-list");
      let draggedIds = [];

      try {
        draggedIds = JSON.parse(event.originalEvent.dataTransfer.getData("application/json") || "[]");
      } catch (error) {
        draggedIds = [];
      }

      if (!draggedIds.length) {
        const draggedId = event.originalEvent.dataTransfer.getData("text/plain");
        if (draggedId) draggedIds = [draggedId];
      }

      const movingRows = draggedIds
        .map((id) => list.querySelector(`[data-combatant-id="${CSS.escape(id)}"]`))
        .filter(Boolean);

      if (!movingRows.length || movingRows.includes(target)) return;

      const targetBox = target.getBoundingClientRect();
      const after = event.originalEvent.clientY > targetBox.top + (targetBox.height / 2);
      let reference = after ? target.nextSibling : target;
      while (reference && movingRows.includes(reference)) {
        reference = reference.nextSibling;
      }

      const fragment = document.createDocumentFragment();
      movingRows.forEach((row) => fragment.append(row));
      list.insertBefore(fragment, reference);

      await this._applyOrderFromForm(list.closest("form"), { render: false, notify: false });
    }
  }

  function getApp() {
    if (!game.initiativeEditor) game.initiativeEditor = new InitiativeEditorApp();
    return game.initiativeEditor;
  }

  function isCombatTrackerApp(app) {
    const names = [
      app?.constructor?.name,
      app?.id,
      app?.options?.id,
      app?.tabName
    ].filter(Boolean).map((value) => String(value).toLowerCase());

    return names.some((value) => value.includes("combattracker") || value === "combat");
  }

  function createButton() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "initiative-editor-open";
    button.title = "Open Initiative Editor";
    button.setAttribute("aria-label", "Open Initiative Editor");
    button.innerHTML = `<i class="fas fa-list-ol"></i>`;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      getApp().render(true);
    });
    return button;
  }

  function addCombatTrackerButton(app, html) {
    if (!game.user?.isGM) return;

    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root || root.querySelector(".initiative-editor-open")) return;

    const target = root.querySelector([
      ".combat-tracker-header",
      ".encounter-controls",
      ".combat-controls",
      ".directory-header",
      ".window-content header",
      "header"
    ].join(", "));

    const button = createButton();
    if (target) target.append(button);
    else root.prepend(button);
  }

  function addFloatingLauncher() {
    if (!game.user?.isGM || document.querySelector(".initiative-editor-floating")) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "initiative-editor-floating";
    button.title = "Open Initiative Editor";
    button.innerHTML = `<i class="fas fa-list-ol"></i><span>Initiative</span>`;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      getApp().render(true);
    });

    document.body.append(button);
  }

  function addButtonToExistingCombatTracker() {
    const root = document.querySelector([
      "#combat",
      "#combat-tracker",
      "[data-application-id='combat']",
      "[data-tab='combat'].tab",
      ".combat-sidebar"
    ].join(", "));

    if (root) addCombatTrackerButton({ id: "combat" }, root);
  }

  function observeSidebar() {
    const sidebar = document.querySelector("#sidebar, #ui-right, body");
    if (!sidebar) return;

    const observer = new MutationObserver(() => addButtonToExistingCombatTracker());
    observer.observe(sidebar, { childList: true, subtree: true });
  }

  Hooks.once("ready", () => {
    if (!game.user?.isGM) return;
    if (!BaseApplication) {
      ui.notifications.error("Initiative Editor could not find Foundry's Application API.");
      return;
    }
    getApp();
    addFloatingLauncher();
    addButtonToExistingCombatTracker();
    observeSidebar();
  });

  Hooks.on("renderCombatTracker", addCombatTrackerButton);
  Hooks.on("renderApplicationV2", (app, element) => {
    if (isCombatTrackerApp(app)) addCombatTrackerButton(app, element);
  });

  ["createCombatant", "deleteCombatant"].forEach((hookName) => {
    Hooks.on(hookName, () => {
      if (game.initiativeEditor?.rendered) game.initiativeEditor.render(false);
    });
  });
})();
