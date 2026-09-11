(function () {
  "use strict";

  const engine = window.MatrixEngine;
  const data = engine.data;
  const championDatabase = window.CHAMPION_NAME_DATABASE || {};
  try {
    const saved = JSON.parse(localStorage.getItem("damage-matrix-customs") || "null");
    if (saved) {
      engine.customData.powers = Object.assign(engine.customData.powers, saved.powers || {});
      engine.customData.specials = Object.assign(engine.customData.specials, saved.specials || {});
    }
  } catch (error) {}
  data.powers = engine.allPowers();
  data.specials = engine.allSpecials();
  const skyClear = Object.values(engine.customData.powers).find((power) => power.displayName === "Sky Clear");
  if (skyClear && skyClear.severityOverride === undefined) {
    skyClear.severityOverride = 10;
    localStorage.setItem("damage-matrix-customs", JSON.stringify(engine.customData));
  }
  const committedCustoms = JSON.parse(JSON.stringify(engine.customData));
  const SAVED_BUILDS_KEY = "damage-matrix-saved-builds";
  let savedBuilds = {};
  try { savedBuilds = JSON.parse(localStorage.getItem(SAVED_BUILDS_KEY) || "null") || {}; } catch (error) {}
  const persistSavedBuilds = () => localStorage.setItem(SAVED_BUILDS_KEY, JSON.stringify(savedBuilds));
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const state = { search: "", selected: null, customDraft: null, customDirty: false, statValue: 1000000, statLimit: 100, theme: localStorage.getItem("damage-matrix-theme") || "dark", openGroups: new Set(["Powers", "Specials"]), activeView: "attacks", dot: { total: true, dps: true, burst: false }, defense: { stacking: "multiplicative", window: 10, inCombat: true, outOfCombat: false, daytime: false, dungeon: false }, build: { healthPercent: 100, maxHealth: 1000, champion: "", championQuery: "", trait: "", traitTier: 0, title: "", accessory: "", transformation: "", special: "", attacks: [], scalingMode: "multiplicative" }, buildSearch: {}, buildLibrary: { name: "", selected: "", confirmOverwrite: false, confirmDelete: false }, builds: { search: "", selected: null, openGroups: new Set(["Champions"]), matrixOpen: true, catalogOpen: true }, sim: { objective: "burst", metric: "dps", extraAttacks: 2, auto: { filter: "", filterTokens: [] }, openBuilds: new Set([0]), selected: 0, result: null }, matrix: { mode: "boss", category: "all", includeCustoms: true, excludeDamageless: true, filter: "", filterTokens: [], sort: "attack", direction: "asc" }, rebalance: { selected: [], drafts: {}, originals: {}, dirty: {}, exclude: { damage: false, tickCount: false, duration: false, endlag: false, cooldown: false }, target: "dps", search: "" } };
  const entries = [];
  const $ = (selector) => document.querySelector(selector);
  const format = (value) => value === null || value === undefined || !Number.isFinite(value) ? "-" : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const seconds = (value) => value === null || value === undefined ? "-" : `${format(value)}s`;
  const refreshEntries = () => entries.splice(0, entries.length, ...engine.catalog());
  const isCustomEntry = (entry) => !!(engine.customData.powers[entry.powerId] || engine.customData.specials[entry.specialId]);
  refreshEntries();

  // Full-view re-renders replace innerHTML, so a focused control must be found again by attribute
  // or typing drops out of the field after the first character.
  const FOCUS_KEYS = ["data-builds-search", "data-matrix-filter", "data-build-search", "data-champion-search", "data-stat-field", "data-build-field", "data-sim-field", "data-defense-window", "data-inline-field", "data-field", "data-build-library-name", "data-rebalance-search"];

  function captureFocus() {
    const active = document.activeElement;
    if (!active || !active.matches || !active.matches("input, select, textarea")) return null;
    const key = FOCUS_KEYS.find((name) => active.hasAttribute(name));
    if (!key) return null;
    const value = active.getAttribute(key);
    let start = null;
    let end = null;
    try { start = active.selectionStart; end = active.selectionEnd; } catch (error) {}
    return { selector: value ? `[${key}="${value}"]` : `[${key}]`, start, end };
  }

  function restoreFocus(token) {
    if (!token) return;
    const target = document.querySelector(token.selector);
    if (!target || target === document.activeElement) return;
    target.focus();
    if (typeof token.start === "number") {
      try { target.setSelectionRange(token.start, token.end); return; } catch (error) {}
    }
    // Number inputs expose no selection API, so re-assigning the value parks the caret at the end.
    if (target.value !== undefined) target.value = target.value;
  }

  function iconNode(icon, label) {
    const match = /^rbxassetid:\/\/(\d+)$/.exec(icon || "");
    const first = (label || "?").slice(0, 1).replace(/'/g, "");
    if (!match) return `<span class="leaf-icon fallback">${first}</span>`;
    return `<img class="leaf-icon" src="https://kizurex.github.io/afs-damage-calculator/assets/icons/${match[1]}.png" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'), { className: 'leaf-icon fallback', textContent: '${first}' }))">`;
  }

  function iconOnly(icon, label, className) {
    const match = /^rbxassetid:\/\/(\d+)$/.exec(icon || "");
    if (!match) return "";
    return `<img class="${className || "matrix-icon"}" src="https://kizurex.github.io/afs-damage-calculator/assets/icons/${match[1]}.png" alt="${label || ""}" loading="lazy">`;
  }

  const statIconIds = {};
  ["Strength", "Chakra", "Sword", "Durability"].forEach((stat) => {
    const power = Object.values(data.powers || {}).find((item) => item.statType === stat && /^rbxassetid:\/\/\d+$/.test(item.icon || ""));
    if (power) statIconIds[stat] = power.icon;
  });

  function specialForEntry(entry, move) {
    if (entry.specialId && data.specials[entry.specialId]) return data.specials[entry.specialId];
    if (move && move.specialCategory && data.specials[move.specialCategory]) return data.specials[move.specialCategory];
    return null;
  }

  function sourceIcon(entry, move) {
    const special = specialForEntry(entry, move);
    if (special) return iconOnly(special.icon, special.displayName, "matrix-icon");
    const sourceStat = move && (move.statFolder || move.statType);
    return iconOnly(statIconIds[sourceStat], sourceStat, "matrix-icon");
  }

  // Shared by every search/list result: prefer the move's own icon, otherwise fall back to its source's (special or stat) icon.
  function attackIcon(entry, move) {
    if (/^rbxassetid:\/\/\d+$/.test(move && move.icon || "")) return move.icon;
    const special = specialForEntry(entry, move);
    if (special && /^rbxassetid:\/\/\d+$/.test(special.icon || "")) return special.icon;
    const sourceStat = move && (move.statFolder || move.statType);
    return statIconIds[sourceStat] || null;
  }

  function matchingEntries() {
    const query = state.search.toLowerCase();
    return entries.filter((entry) => {
      const power = data.powers[entry.powerId];
      const text = `${power.displayName || entry.powerId} ${entry.folder} ${entry.source || ""} ${power.statType || ""}`.toLowerCase();
      return (!$("#hide-utility").checked || engine.damagingHits(power).length > 0) && (!query || text.includes(query));
    });
  }

  function makeGroup(id, title, groupEntries, root, summaryIcon) {
    const details = document.createElement("details");
    details.open = state.openGroups.has(id) || state.search.length > 0;
    const summary = document.createElement("summary");
    summary.innerHTML = `${summaryIcon || ""}<span>${title} (${groupEntries.length})</span>`;
    details.append(summary);
    const order = { Z: 0, X: 1, C: 2, V: 3 };
    groupEntries.sort((a, b) => (order[a.keybind] ?? 9) - (order[b.keybind] ?? 9) || (data.powers[a.powerId].displayName || a.powerId).localeCompare(data.powers[b.powerId].displayName || b.powerId)).forEach((entry) => {
      const power = data.powers[entry.powerId];
      const button = document.createElement("button");
      button.className = `attack-link${state.selected && state.selected.key === entry.key ? " active" : ""}`;
      button.innerHTML = `${iconNode(attackIcon(entry, power), power.displayName || entry.powerId)}<span>${entry.keybind ? `<b class="keybind">${entry.keybind}</b> ` : ""}${power.displayName || entry.powerId}</span>`;
      button.onclick = () => { state.selected = entry; renderCatalog(); renderAttack(); };
      details.append(button);
    });
    details.addEventListener("toggle", () => details.open ? state.openGroups.add(id) : state.openGroups.delete(id));
    root.append(details);
  }

  function renderCatalog() {
    const catalog = $("#catalog");
    const matching = matchingEntries();
    catalog.innerHTML = "";
    $("#move-count").textContent = matching.length;
    const powersRoot = document.createElement("details");
    powersRoot.open = state.openGroups.has("Powers") || state.search.length > 0;
    powersRoot.innerHTML = `<summary>Powers (${matching.filter((e) => e.group === "Powers").length})</summary>`;
    const folders = new Map();
    matching.filter((e) => e.group === "Powers").forEach((entry) => { if (!folders.has(entry.folder)) folders.set(entry.folder, []); folders.get(entry.folder).push(entry); });
    [...folders].sort(([a], [b]) => a.localeCompare(b)).forEach(([folder, list]) => makeGroup(`Powers/${folder}`, folder, list, powersRoot));
    powersRoot.addEventListener("toggle", () => powersRoot.open ? state.openGroups.add("Powers") : state.openGroups.delete("Powers"));
    catalog.append(powersRoot);

    const specialsRoot = document.createElement("details");
    specialsRoot.open = state.openGroups.has("Specials") || state.search.length > 0;
    specialsRoot.innerHTML = `<summary>Specials (${matching.filter((e) => e.group === "Specials").length})</summary>`;
    const kinds = new Map();
    matching.filter((e) => e.group === "Specials").forEach((entry) => { if (!kinds.has(entry.folder)) kinds.set(entry.folder, []); kinds.get(entry.folder).push(entry); });
    [...kinds].sort(([a], [b]) => a.localeCompare(b)).forEach(([kind, list]) => {
      const kindRoot = document.createElement("details");
      const kindId = `Specials/${kind}`;
      kindRoot.open = state.openGroups.has(kindId) || state.search.length > 0;
      kindRoot.innerHTML = `<summary>${({ Authority: "Authorities", Bloodline: "Bloodlines", BreathingTechnique: "Breathing Styles", CursedTechnique: "Cursed Techniques", Fruit: "Fruits", Kagune: "Kagunes", Permanent: "Permanent", Reiatsu: "Reiatsu", Stand: "Stands" })[kind] || kind} (${list.length})</summary>`;
      const sources = new Map();
      list.forEach((entry) => { if (!sources.has(entry.source || "Other")) sources.set(entry.source || "Other", []); sources.get(entry.source || "Other").push(entry); });
      [...sources].sort(([a], [b]) => a.localeCompare(b)).forEach(([source, sourceList]) => {
        const sourceEntry = sourceList[0];
        const sourceIconMarkup = sourceEntry ? sourceIcon(sourceEntry, data.powers[sourceEntry.powerId]) : "";
        makeGroup(`${kindId}/${source}`, source, sourceList, kindRoot, sourceIconMarkup);
      });
      kindRoot.addEventListener("toggle", () => kindRoot.open ? state.openGroups.add(kindId) : state.openGroups.delete(kindId));
      specialsRoot.append(kindRoot);
    });
    specialsRoot.addEventListener("toggle", () => specialsRoot.open ? state.openGroups.add("Specials") : state.openGroups.delete("Specials"));
    catalog.append(specialsRoot);
    renderCustoms(catalog);
  }

  function saveCustoms() {
    localStorage.setItem("damage-matrix-customs", JSON.stringify(engine.customData));
    const blob = new Blob([`window.CUSTOM_DATA = ${JSON.stringify(engine.customData, null, 2)};`], { type: "text/javascript" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "customs.js"; link.click(); URL.revokeObjectURL(link.href);
  }

  function customPowerTemplate(id, name, statType) {
    return { id, displayName: name, description: "Custom attack", baseCooldown: 8, bossDamage: 10, playerDamage: 10, damageMultiplier: 1, statType, category: "Power", statFolder: statType, runtime: { activationTillFirstHitbox: 0, activationTillEndlagEnd: 1, activationTillCooldownStart: 1, durationSeconds: 1, hits: [{ label: "Hit", count: 1, startsAt: 0, duration: 1, damage: { basis: "power", multiplier: 1 }, hitbox: { shape: "Ball", size: [10, 10, 10] } }], statuses: [] } };
  }

  function renderCustoms(catalog) {
    const root = document.createElement("details");
    root.className = "customs-tree";
    root.open = true;
    root.innerHTML = `<summary>Customs (${Object.keys(engine.customData.powers).length + Object.keys(engine.customData.specials).length})</summary>`;
    const controls = document.createElement("div");
    controls.className = "custom-actions";
    controls.innerHTML = '<button type="button" data-add-power>Add attack</button><button type="button" data-add-special>Add special</button>';
    controls.querySelector("[data-add-power]").onclick = () => openCustomEditor("power");
    controls.querySelector("[data-add-special]").onclick = () => openCustomEditor("special");
    root.append(controls);

    const customEntries = engine.catalog().filter((entry) => engine.customData.powers[entry.powerId]);
    const powersRoot = document.createElement("details");
    powersRoot.open = true;
    powersRoot.innerHTML = `<summary>Powers (${customEntries.filter((entry) => !entry.specialId).length})</summary>`;
    const powerGroups = new Map();
    customEntries.filter((entry) => !entry.specialId).forEach((entry) => {
      if (!powerGroups.has(entry.folder)) powerGroups.set(entry.folder, []);
      powerGroups.get(entry.folder).push(entry);
    });
    [...powerGroups].forEach(([folder, list]) => makeGroup(`Customs/Powers/${folder}`, folder, list, powersRoot));
    root.append(powersRoot);

    const specialsRoot = document.createElement("details");
    specialsRoot.open = true;
    specialsRoot.innerHTML = `<summary>Specials (${Object.keys(engine.customData.specials).length})</summary>`;
    const specialKinds = new Map();
    Object.values(engine.customData.specials).forEach((special) => {
      if (!specialKinds.has(special.kind || "Other")) specialKinds.set(special.kind || "Other", []);
      specialKinds.get(special.kind || "Other").push(special);
    });
    [...specialKinds].forEach(([kind, specials]) => {
      const kindRoot = document.createElement("details");
      kindRoot.open = true;
      kindRoot.innerHTML = `<summary>${kind} (${specials.length})</summary>`;
      specials.forEach((special) => {
        const sourceRoot = document.createElement("details");
        sourceRoot.open = true;
        const sourceButton = document.createElement("summary");
        sourceButton.textContent = `${special.displayName || special.id} (${(special.abilities || []).length})`;
        sourceButton.onclick = (event) => { event.preventDefault(); state.customDraft = Object.assign(JSON.parse(JSON.stringify(special)), { _customType: "special", _existingId: special.id }); state.customDirty = false; renderCustomSpecialOverview(special); };
        sourceRoot.append(sourceButton);
        const specialEntries = customEntries.filter((entry) => entry.specialId === special.id).sort((a, b) => ({ Z: 0, X: 1, C: 2, V: 3 }[a.keybind] ?? 9) - ({ Z: 0, X: 1, C: 2, V: 3 }[b.keybind] ?? 9));
        specialEntries.forEach((entry) => {
          const power = data.powers[entry.powerId];
          const button = document.createElement("button");
          button.className = "attack-link";
          button.innerHTML = `${iconNode(attackIcon(entry, power), power.displayName || power.id)}<span><b class="keybind">${entry.keybind || ""}</b> ${power.displayName || power.id}</span>`;
          button.onclick = () => { state.selected = entry; state.customDraft = null; renderAttack(); };
          sourceRoot.append(button);
        });
        kindRoot.append(sourceRoot);
      });
      specialsRoot.append(kindRoot);
    });
    root.append(specialsRoot);
    catalog.append(root);
  }

  function openCustomEditor(type, id) {
    state.customDraft = id ? JSON.parse(JSON.stringify(type === "power" ? engine.customData.powers[id] : engine.customData.specials[id])) : type === "power" ? customPowerTemplate(`Custom_${Date.now()}`, "New attack", "Strength") : { id: `CustomSpecial_${Date.now()}`, displayName: "New special", kind: "Fruit", abilities: [] };
    state.customDraft._customType = type;
    state.customDraft._existingId = id || null;
    state.customDirty = false;
    renderCustomEditor();
  }

  function renderCustomSpecialOverview(special) {
    const view = $("#view-attacks");
    const abilities = special.abilities || [];
    view.innerHTML = `<section class="custom-editor-panel"><div class="custom-editor-header"><div><span class="eyebrow">CUSTOM SPECIAL</span><h2>${special.displayName || special.id}</h2><p class="move-source">${special.kind || "Other"}</p></div><div class="header-actions"><button class="icon-button" data-edit-special title="Edit special">✎</button><button class="icon-button danger-icon" data-delete-special title="Delete special">×</button></div></div><div class="detail-grid">${detail("Special type", special.kind || "Other")}${detail("Attacks", abilities.length)}${detail("Source", "Custom data")}${detail("Keybinds", abilities.map((ability) => ability.key).join(" · ") || "-")}</div><div class="section-title"><h3>Attacks</h3><span>click an attack to open its full damage view</span></div><div class="custom-special-attacks">${abilities.map((ability) => `<button data-custom-ability="${ability.powerId}"><b>${ability.key}</b> ${ability.displayName || ability.powerId}</button>`).join("")}</div></section>`;
    view.querySelector("[data-edit-special]").onclick = () => renderCustomEditor();
    view.querySelector("[data-delete-special]").onclick = () => { abilities.forEach((ability) => delete engine.customData.powers[ability.powerId]); delete engine.customData.specials[special.id]; state.customDraft = null; localStorage.setItem("damage-matrix-customs", JSON.stringify(engine.customData)); data.powers = engine.allPowers(); data.specials = engine.allSpecials(); refreshEntries(); renderCatalog(); renderAttack(); };
    view.querySelectorAll("[data-custom-ability]").forEach((button) => button.onclick = () => { state.selected = entries.find((entry) => entry.powerId === button.dataset.customAbility) || null; state.customDraft = null; renderAttack(); });
  }

  function renderCustomEditor() {
    const view = $("#view-attacks");
    const draft = state.customDraft;
    if (!draft) return renderAttack();
    const isPower = draft._customType === "power";
    const statusOptions = [...new Set(Object.values(data.powers).flatMap((power) => (power.runtime && power.runtime.statuses || []).map((status) => status.effect)).filter(Boolean))].sort();
    const powerFields = `<label>Name<input data-field="displayName" value="${draft.displayName || ""}"></label><label>Damage type<select data-field="statType"><option>None</option><option>Strength</option><option>Chakra</option><option>Sword</option></select></label><label>BossDMG<input data-field="bossDamage" type="number" value="${draft.bossDamage ?? 0}"></label><label>PlayerDMG<input data-field="playerDamage" type="number" value="${draft.playerDamage ?? 0}"></label><label>PvE multiplier<input data-field="damageMultiplier" type="number" value="${draft.damageMultiplier ?? 0}"></label><label>Severity override<input data-field="severityOverride" type="number" min="0" max="10" step="1" value="${draft.severityOverride ?? ""}" placeholder="Automatic"></label><label>Cooldown<input data-field="baseCooldown" type="number" value="${draft.baseCooldown ?? 0}"></label><label>Activation till cooldown<input data-field="activationTillCooldownStart" type="number" step="any" value="${draft.runtime?.activationTillCooldownStart ?? 0}"></label><label>Activation till endlag ends<input data-field="activationTillEndlagEnd" type="number" step="any" value="${draft.runtime?.activationTillEndlagEnd ?? 0}"></label><label>Activation till first hitbox<input data-field="activationTillFirstHitbox" type="number" step="any" value="${draft.runtime?.activationTillFirstHitbox ?? 0}"></label><label>Duration<input data-field="durationSeconds" type="number" step="any" value="${draft.runtime?.durationSeconds ?? 0}"></label><label>Tick count<input data-field="tickCount" type="number" min="0" step="1" value="${draft.runtime?.hits?.[0]?.count ?? 0}"></label><label>Hitbox type<select data-field="hitboxType"><option>Ball</option><option>Block</option><option>Box</option><option>Cylinder</option><option>Projectile</option></select></label><label>Hitbox X<input data-field="hitboxX" type="number" value="${draft.runtime?.hits?.[0]?.hitbox?.size?.[0] ?? 0}"></label><label>Hitbox Y<input data-field="hitboxY" type="number" value="${draft.runtime?.hits?.[0]?.hitbox?.size?.[1] ?? 0}"></label><label>Hitbox Z<input data-field="hitboxZ" type="number" value="${draft.runtime?.hits?.[0]?.hitbox?.size?.[2] ?? 0}"></label><label>Native status<select data-field="statusEffect"><option>None</option>${statusOptions.map((status) => `<option>${status}</option>`).join("")}</select></label>`;
    const specialFields = `<label>Special name<input data-field="displayName" value="${draft.displayName || ""}"></label><label>Special type<select data-field="kind"><option>Authority</option><option>Bloodline</option><option>BreathingTechnique</option><option>CursedTechnique</option><option>Fruit</option><option>Kagune</option><option>Permanent</option><option>Reiatsu</option><option>Stand</option></select></label><div class="custom-ability-editor"><b>Attacks (1–4)</b>${["Z", "X", "C", "V"].map((key, index) => { const ability = (draft.abilities || [])[index] || {}; return `<div class="custom-ability-row"><strong>${key}</strong><input data-ability-index="${index}" value="${ability.displayName || ""}" placeholder="Optional move name"><select data-ability-type="${index}"><option>None</option><option>Strength</option><option>Chakra</option><option>Sword</option></select></div>`; }).join("")}</div>`;
    const fields = isPower ? powerFields : specialFields;
    view.innerHTML = `<section class="custom-editor-panel"><div class="custom-editor-header"><div><span class="eyebrow">CUSTOMS</span><h2>${isPower ? "Custom attack" : "Custom special"}</h2></div><div class="custom-editor-actions"><button data-custom-save${state.customDirty ? "" : " hidden"}>✓ Save</button><button data-custom-discard${state.customDirty ? "" : " hidden"}>× Discard</button></div></div><div class="custom-form">${fields}</div><p class="severity-explain">Edits use the same data-driven move shape as live powers and specials. Choose None for a non-damaging move such as a time stop.</p></section>`;
    if (isPower) $("[data-field='statType']").value = draft.statType || "None";
    if (!isPower) $("[data-field='kind']").value = draft.kind || "Fruit";
    if (isPower) {
      const hit = draft.runtime?.hits?.[0] || {};
      $("[data-field='hitboxType']").value = hit.hitbox?.shape || "Ball";
      $("[data-field='statusEffect']").value = draft.runtime?.statuses?.[0]?.effect || "None";
    }
    view.querySelectorAll("[data-ability-type]").forEach((select) => { const ability = draft.abilities[Number(select.dataset.abilityType)] || {}; select.value = ability.statType || "None"; });
    const markDirty = () => { state.customDirty = true; view.querySelectorAll("[data-custom-save], [data-custom-discard]").forEach((button) => { button.hidden = false; }); };
    view.querySelectorAll("[data-field]").forEach((input) => input.addEventListener(input.tagName === "SELECT" ? "change" : "input", () => { const key = input.dataset.field; const value = input.type === "number" ? Number(input.value) : input.value; const hit = draft.runtime?.hits?.[0]; if (key === "statType") { draft.statType = value; if (value === "None") { draft.statType = "Durability"; draft.damageMultiplier = 0; draft.bossDamage = 0; draft.playerDamage = 0; draft.runtime.hits = []; } } else if (key === "tickCount" && hit) hit.count = Math.max(0, Math.trunc(value)); else if (key === "hitboxType" && hit) hit.hitbox.shape = value; else if (key === "hitboxX" && hit) hit.hitbox.size[0] = Math.max(0, value); else if (key === "hitboxY" && hit) hit.hitbox.size[1] = Math.max(0, value); else if (key === "hitboxZ" && hit) hit.hitbox.size[2] = Math.max(0, value); else if (key === "statusEffect") draft.runtime.statuses = value === "None" ? [] : [{ effect: value, target: "both" }]; else if (["activationTillCooldownStart", "activationTillEndlagEnd", "activationTillFirstHitbox", "durationSeconds"].includes(key)) draft.runtime[key] = Math.max(0, value); else draft[key] = value; markDirty(); }));
    view.querySelectorAll("[data-ability-index]").forEach((input) => input.addEventListener("input", () => { const index = Number(input.dataset.abilityIndex); draft.abilities[index] = Object.assign(draft.abilities[index] || {}, { key: ["Z", "X", "C", "V"][index], displayName: input.value, powerId: `${draft.id}_${["Z", "X", "C", "V"][index]}` }); markDirty(); }));
    view.querySelectorAll("[data-ability-type]").forEach((select) => select.addEventListener("change", () => { const index = Number(select.dataset.abilityType); draft.abilities[index] = Object.assign(draft.abilities[index] || { key: ["Z", "X", "C", "V"][index] }, { statType: select.value }); markDirty(); }));
    const save = view.querySelector("[data-custom-save]"); if (save) save.onclick = commitCustomDraft;
    const discard = view.querySelector("[data-custom-discard]"); if (discard) discard.onclick = () => { state.customDraft = null; state.customDirty = false; renderAttack(); };
  }

  function commitCustomDraft() {
    const draft = state.customDraft;
    const type = draft._customType;
    const id = draft._existingId || draft.id;
    delete draft._customType; delete draft._existingId;
    if (type === "power") engine.customData.powers[id] = draft;
    else {
      draft.abilities = draft.abilities.filter((ability) => ability && ability.displayName).slice(0, 4);
      draft.abilities.forEach((ability) => { const powerId = ability.powerId || `${id}_${ability.key}`; const move = customPowerTemplate(powerId, ability.displayName, ability.statType === "None" ? "Durability" : (ability.statType || "Strength")); move.isSpecial = true; move.specialType = draft.kind; if (ability.statType === "None") { move.bossDamage = 0; move.playerDamage = 0; move.damageMultiplier = 0; move.runtime.hits = []; } engine.customData.powers[powerId] = Object.assign(engine.customData.powers[powerId] || move, { displayName: ability.displayName }); ability.powerId = powerId; });
      engine.customData.specials[id] = draft;
    }
    localStorage.setItem("damage-matrix-customs", JSON.stringify(engine.customData));
    state.customDraft = null; state.customDirty = false; data.powers = engine.allPowers(); data.specials = engine.allSpecials(); refreshEntries(); renderCatalog(); renderAttack();
  }

  const card = (title, value, note) => `<article class="stat-card"><h4>${title}</h4><strong>${value}</strong><small>${note || ""}</small></article>`;
  const detail = (label, value) => `<div class="detail"><label>${label}</label><strong>${value}</strong></div>`;
  const profileCards = (label, profile, pve, move) => `<section class="damage-profile"><div class="profile-heading"><h3>${label}</h3><span>${pve ? `× ${format(move.damageMultiplier)} ${move.statType || "stat"}` : "flat live value"}</span></div><div class="stat-grid">${card("Per hit", format(profile.hits[0] ? profile.hits[0].perHit : 0), `${format(profile.totalHits)} hits`)}${card("Direct damage", format(profile.direct), `${format(profile.totalHits)} hits`)}${card("Damage over time", profile.dotDamage ? format(profile.dotDamage) : "None", profile.dotDamage ? `${format(profile.dotPerSecond)}/s over ${seconds(profile.dotSeconds)}` : "no applied DoT")}${card("Total damage", format(profile.total), `${format(profile.direct)} direct${profile.dotFlags.total ? ` + ${format(profile.dotDamage)} DoT` : " · DoT excluded"}`)}${card("DPS", format(profile.dps), `damage ÷ ${seconds(profile.cycle)} cycle · DoT ${profile.dotFlags.dps ? "in" : "out"}`)}${card("Burst", format(profile.burst), `over ${seconds(profile.burstWindow)} · DoT ${profile.dotFlags.burst ? "in" : "out"}`)}${card("Active DPS", format(profile.activeDps), `damage ÷ ${seconds(profile.duration)} active duration · DoT ${profile.dotFlags.dps ? "in" : "out"}`)}</div></section>`;

  function inlineField(label, value, field, type, options) {
    const control = type === "select" ? `<select data-inline-field="${field}">${options.map((option) => `<option${String(option) === String(value) ? " selected" : ""}>${option}</option>`).join("")}</select>` : `<input data-inline-field="${field}" type="number" value="${value ?? 0}" step="${type === "integer" ? "1" : "any"}" min="0">`;
    return `<div class="detail inline-detail"><label>${label}</label>${control}</div>`;
  }

  function matrixSource(entry, move) {
    if (entry.specialId && data.specials[entry.specialId]) return data.specials[entry.specialId].displayName || entry.source || entry.specialId;
    return entry.source || move.specialCategory || move.statFolder || move.statType || "Power";
  }

  function matrixDamageType(move) {
    return ["Strength", "Chakra", "Sword"].includes(move.statType) ? move.statType : "Special";
  }

  function matrixColorStyle(row) {
    const colors = { Strength: "#d84a3a", Chakra: "#8f54d9", Sword: "#2d9a5b", Special: "#ff8b68" };
    return `--matrix-type: ${colors[row.damageType] || colors.Special};`;
  }

  function optionList(records, labelKey) {
    return Object.values(records || {}).sort((a, b) => (a[labelKey] || a.id).localeCompare(b[labelKey] || b.id));
  }

  function fullTransformForSpecial(specialId) {
    return Object.values(data.transformations || {}).find((item) => item.isSpecial && item.type === "Full" && data.powers[item.id]?.specialCategory === specialId) || null;
  }

  function transformForSpecial(specialId) {
    return Object.values(data.transformations || {}).find((item) => item.isSpecial && data.powers[item.id]?.specialCategory === specialId) || null;
  }

  function fullTransformSpecialIds() {
    return new Set(Object.values(data.transformations || {}).filter((item) => item.isSpecial && item.type === "Full" && data.powers[item.id]?.specialCategory).map((item) => data.powers[item.id].specialCategory));
  }

  const SPECIAL_NAMES = { Authority: "Authorities", Bloodline: "Bloodlines", BreathingTechnique: "Breathing Styles", CursedTechnique: "Cursed Techniques", Fruit: "Fruits", Kagune: "Kagunes", Permanent: "Permanent", Reiatsu: "Reiatsu", Stand: "Stands" };
  const specialKindLabel = (folder) => SPECIAL_NAMES[folder] || folder || "";
  // Kits without a transformation can be swapped freely, but only one per kind can be equipped.
  const mixableSpecial = (id) => !!id && !transformForSpecial(id);
  const specialKindOf = (id) => { const special = id && data.specials && data.specials[id]; return special ? (special.kind || "Other") : ""; };
  let kindLockCache = { key: null, locks: null };

  function specialKindLocks(build) {
    const attacks = build.attacks || [];
    const key = `${build.special}|${attacks.join(",")}`;
    if (kindLockCache.key === key) return kindLockCache.locks;
    const locks = new Map();
    const claim = (id) => { const kind = specialKindOf(id); if (kind && !locks.has(kind)) locks.set(kind, id); };
    claim(build.special);
    attacks.forEach((entryKey) => {
      const entry = entries.find((item) => item.key === entryKey);
      if (entry && entry.specialId) claim(entry.specialId);
    });
    kindLockCache = { key, locks };
    return locks;
  }

  function entryAllowed(entry, build) {
    const transformation = build.transformation && data.transformations && data.transformations[build.transformation];
    if (transformation && !transformation.isSpecial && transformForSpecial(entry.specialId)) return false;
    if (fullTransformForSpecial(build.special)) return entry.specialId === build.special;
    if (entry.group === "Powers" || entry.specialId === build.special) return true;
    if (!mixableSpecial(entry.specialId)) return false;
    const owner = specialKindLocks(build).get(specialKindOf(entry.specialId));
    return !owner || owner === entry.specialId;
  }

  function selectOptions(records, labelKey, selected, placeholder) {
    return `<option value="">${placeholder}</option>${optionList(records, labelKey).map((item) => { const label = item[labelKey] || item.name || item.id; const suffix = item.id && label !== item.id ? ` (${item.id})` : ""; return `<option value="${item.id}"${selected === item.id ? " selected" : ""}>${label}${suffix}</option>`; }).join("")}`;
  }

  function championInfo(id) {
    const champion = data.champions && data.champions[id] || {};
    const local = championDatabase[id] || {};
    const displayName = champion.displayName || local.displayName || id;
    const originalName = local.originalName || id;
    const aliases = [...new Set([id, originalName, displayName, ...(local.aliases || [])].filter(Boolean))];
    return { id, displayName, originalName, aliases };
  }

  function championLabel(id) {
    const info = championInfo(id);
    return info.originalName && info.originalName !== info.displayName ? `${info.originalName} (${info.displayName})` : info.displayName;
  }

  function championSearchOptions() {
    return Object.keys(data.champions || {}).sort((a, b) => championLabel(a).localeCompare(championLabel(b))).map((id) => `<option value="${championLabel(id)}"></option>`).join("");
  }

  function findChampionId(query) {
    const text = query.trim().toLowerCase();
    if (!text) return "";
    return Object.keys(data.champions || {}).find((id) => championInfo(id).aliases.some((alias) => alias.toLowerCase() === text) || championLabel(id).toLowerCase() === text) || "";
  }

  function championInputValue() {
    return state.build.championQuery || (state.build.champion ? championLabel(state.build.champion) : "");
  }

  function buildSearchRecords(field) {
    const slot = slotFor(field);
    const icon = (item) => slot ? slot.icon(item) : null;
    if (field === "champion") return Object.keys(data.champions || {}).map((id) => ({ id, label: championLabel(id), aliases: championInfo(id).aliases, icon: icon(data.champions[id]) }));
    if (field === "trait") return optionList(data.traits, "name").map((item) => ({ id: item.id, label: item.name || item.id, aliases: [item.id, item.name || item.id], icon: icon(item) }));
    if (field === "title") return optionList(data.titles, "displayName").map((item) => ({ id: item.id, label: item.displayName || item.id, aliases: [item.id, item.displayName || item.id], icon: icon(item) }));
    if (field === "accessory") return optionList(data.accessories, "displayName").map((item) => ({ id: item.id, label: item.displayName || item.id, aliases: [item.id, item.displayName || item.id], icon: icon(item) }));
    if (field === "transformation") return optionList(data.transformations, "displayName").filter((item) => !item.isSpecial).map((item) => ({ id: item.id, label: item.displayName || item.id, aliases: [item.id, item.displayName || item.id], icon: icon(item) }));
    if (field === "special") return optionList(data.specials, "displayName").map((item) => ({ id: item.id, label: item.displayName || item.id, aliases: [item.id, item.displayName || item.id], icon: icon(item) }));
    return [];
  }

  function buildSearchValue(field) {
    if (state.buildSearch[field]) return state.buildSearch[field];
    const selected = state.build[field];
    return selected ? (buildSearchRecords(field).find((item) => item.id === selected)?.label || selected) : "";
  }

  function setBuildSearchSelection(field, id) {
    state.build[field] = id;
    state.buildSearch[field] = id ? (buildSearchRecords(field).find((item) => item.id === id)?.label || id) : "";
    if (field === "champion") state.build.championQuery = state.buildSearch[field];
    if (field === "trait") state.build.traitTier = 0;
    if (field === "special") {
      const fullTransform = fullTransformForSpecial(state.build.special);
      if (fullTransform) {
        state.build.transformation = fullTransform.id;
        state.buildSearch.transformation = activeTransformationName();
      }
    }
    if (field === "transformation" && (!state.build.transformation || !data.transformations[state.build.transformation]?.isSpecial) && fullTransformSpecialIds().has(state.build.special)) {
      state.build.special = "";
      state.buildSearch.special = "";
    }
  }

  function filteredBuildSearchRecords(field, query) {
    const text = query.trim().toLowerCase();
    return buildSearchRecords(field).filter((item) => !text || item.aliases.some((alias) => alias.toLowerCase().includes(text)) || item.label.toLowerCase().includes(text)).slice(0, 10);
  }

  function renderBuildSearchOptions(root, field, query) {
    const options = filteredBuildSearchRecords(field, query);
    const list = root.querySelector(".build-search-options");
    list.innerHTML = options.length ? options.map((item) => `<button type="button" data-search-option="${item.id}">${iconNode(item.icon, item.label)}<span>${item.label}</span></button>`).join("") : '<span class="build-search-empty">No matches</span>';
  }

  function buildSearchControl(field, label, placeholder) {
    return `<label class="build-search-field">${label}<span class="build-search"><input data-build-search="${field}" type="search" value="${buildSearchValue(field)}" placeholder="${placeholder}"><span class="build-search-options" hidden></span></span></label>`;
  }

  function mountBuildSearchPickers(view) {
    view.querySelectorAll("[data-build-search]").forEach((input) => {
      const field = input.dataset.buildSearch;
      const root = input.closest(".build-search");
      const list = root.querySelector(".build-search-options");
      const show = () => { renderBuildSearchOptions(root, field, input.value); list.hidden = false; };
      input.onfocus = show;
      input.oninput = () => {
        state.buildSearch[field] = input.value;
        if (field === "champion") state.build.championQuery = input.value;
        if (!input.value.trim()) setBuildSearchSelection(field, "");
        show();
        if (!input.value.trim()) renderMatrix();
      };
      input.onkeydown = (event) => {
        if (event.key !== "Enter") return;
        const first = filteredBuildSearchRecords(field, input.value)[0];
        if (!first) return;
        event.preventDefault();
        setBuildSearchSelection(field, first.id);
        renderMatrix();
      };
      input.onblur = () => setTimeout(() => { list.hidden = true; }, 120);
      list.onmousedown = (event) => {
        const button = event.target.closest("[data-search-option]");
        if (!button) return;
        event.preventDefault();
        setBuildSearchSelection(field, button.dataset.searchOption);
        renderMatrix();
      };
    });
  }

  function matrixFilterRecords() {
    const records = [];
    const seen = new Set();
    const add = (label, kind, icon) => {
      const key = `${kind}:${label}`;
      if (!label || seen.has(key)) return;
      seen.add(key);
      records.push({ label, kind, icon });
    };
    entries.forEach((entry) => {
      const power = data.powers[entry.powerId];
      if (!power || !entryAllowed(entry, state.build)) return;
      const move = engine.moveConfig(power, entry.standId);
      const special = specialForEntry(entry, move);
      const sourceStatIcon = statIconIds[move.statFolder || move.statType];
      add(move.displayName || entry.powerId, "Move", attackIcon(entry, move));
      add(matrixSource(entry, move), "Source", special ? special.icon : sourceStatIcon);
      add(matrixDamageType(move), "Damage type", statIconIds[matrixDamageType(move)]);
      if (entry.group === "Specials") add(specialKindLabel(entry.folder), "Special type", special ? special.icon : null);
    });
    return records.sort((a, b) => a.label.localeCompare(b.label));
  }

  function renderMatrixFilterOptions(root, query, store) {
    const text = query.trim().toLowerCase();
    const active = new Set(store.filterTokens.map((token) => `${token.kind}:${token.label}`.toLowerCase()));
    const options = matrixFilterRecords().filter((item) => !active.has(`${item.kind}:${item.label}`.toLowerCase()) && (!text || item.label.toLowerCase().includes(text))).slice(0, 12);
    const list = root.querySelector(".matrix-filter-options");
    list.innerHTML = options.length ? options.map((item) => `<button type="button" data-matrix-filter-option="${item.label}" data-matrix-filter-kind="${item.kind}">${iconNode(item.icon, item.label)}<span>${item.kind}</span>${item.label}</button>`).join("") : '<span class="build-search-empty">No matches</span>';
  }

  function addMatrixFilterToken(value, kind, store) {
    const label = typeof value === "string" ? value.trim() : value.label.trim();
    const tokenKind = kind || (typeof value === "string" ? "Any" : value.kind);
    if (!label) return;
    if (!store.filterTokens.some((item) => item.label.toLowerCase() === label.toLowerCase() && item.kind === tokenKind)) store.filterTokens.push({ label, kind: tokenKind });
    store.filter = "";
    store.refocusFilter = true;
  }

  function removeMatrixFilterToken(index, store) {
    store.filterTokens.splice(index, 1);
    store.refocusFilter = true;
  }

  function matrixFilterChips(store) {
    return store.filterTokens.map((token, index) => `<button type="button" class="matrix-filter-chip" data-remove-matrix-filter="${index}">${token.label}<small>${token.kind}</small><span>×</span></button>`).join("");
  }

  function mountMatrixFilter(view, store, rerender) {
    const input = view.querySelector("[data-matrix-filter]");
    if (!input) return;
    const root = input.closest(".matrix-filter-search");
    const list = root.querySelector(".matrix-filter-options");
    const show = () => { renderMatrixFilterOptions(root, input.value, store); list.hidden = false; };
    input.onfocus = show;
    input.oninput = () => { store.filter = input.value; store.refocusFilter = true; rerender(); };
    input.onkeydown = (event) => {
      if (event.key === "Backspace" && !input.value && store.filterTokens.length) {
        event.preventDefault();
        removeMatrixFilterToken(store.filterTokens.length - 1, store);
        rerender();
        return;
      }
      if (event.key !== "Enter") return;
      const first = matrixFilterRecords().filter((item) => !input.value.trim() || item.label.toLowerCase().includes(input.value.trim().toLowerCase()))[0];
      event.preventDefault();
      addMatrixFilterToken(first || input.value, null, store);
      store.refocusFilter = true;
      rerender();
    };
    input.onblur = () => setTimeout(() => { list.hidden = true; }, 120);
    list.onmousedown = (event) => {
      const button = event.target.closest("[data-matrix-filter-option]");
      if (!button) return;
      event.preventDefault();
      addMatrixFilterToken(button.dataset.matrixFilterOption, button.dataset.matrixFilterKind, store);
      rerender();
    };
    view.querySelectorAll("[data-remove-matrix-filter]").forEach((button) => button.onclick = () => { removeMatrixFilterToken(Number(button.dataset.removeMatrixFilter), store); rerender(); });
    const clear = view.querySelector("[data-clear-matrix-filter]");
    if (clear) clear.onclick = () => { store.filter = ""; store.filterTokens = []; store.refocusFilter = true; rerender(); };
    if (store.refocusFilter) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
      show();
      store.refocusFilter = false;
    }
  }

  function transformationOptions() {
    return `<option value="">No transformation</option>${optionList(data.transformations, "displayName").filter((item) => !item.isSpecial).map((item) => `<option value="${item.id}"${state.build.transformation === item.id ? " selected" : ""}>${item.displayName || item.id}</option>`).join("")}`;
  }

  function traitTierOptions() {
    const trait = state.build.trait && data.traits && data.traits[state.build.trait];
    const tiers = trait && trait.tiers || [];
    return tiers.length ? tiers.map((tier, index) => `<option value="${index}"${Number(state.build.traitTier) === index ? " selected" : ""}>${tier.rarity || `Tier ${index + 1}`}</option>`).join("") : '<option value="0">No tier</option>';
  }

  function activeTransformationName() {
    const transformation = state.build.transformation && data.transformations && data.transformations[state.build.transformation];
    return transformation ? transformation.displayName || transformation.id : "None";
  }

  function buffSummaryRows() {
    const mode = { pve: "mob", pvp: "duel", boss: "boss" }[state.matrix.mode] || "mob";
    return buffSamples().map((sample) => `<div><span>${sample.label}</span><strong>${format(engine.buildMultiplier(sample.move, mode, state))}×</strong></div>`).join("");
  }

  function buffSamples() {
    const selectedSpecial = state.build.special && data.specials[state.build.special];
    const specialKind = selectedSpecial ? selectedSpecial.kind : "Fruit";
    const specialLabel = selectedSpecial ? selectedSpecial.displayName || selectedSpecial.id : "Selected special";
    return [
      { label: "Str", move: { statType: "Strength" } },
      { label: "Cha", move: { statType: "Chakra" } },
      { label: "Swrd", move: { statType: "Sword" } },
      { label: specialLabel, move: { statType: "Durability", specialType: specialKind, specialCategory: state.build.special } },
    ];
  }

  function buildForSource(source) {
    const base = { healthPercent: state.build.healthPercent, scalingMode: state.build.scalingMode, special: state.build.special };
    if (source === "champion") return Object.assign(base, { champion: state.build.champion });
    if (source === "trait") return Object.assign(base, { trait: state.build.trait, traitTier: state.build.traitTier });
    if (source === "title") return Object.assign(base, { title: state.build.title });
    if (source === "accessory") return Object.assign(base, { accessory: state.build.accessory });
    if (source === "transformation") return Object.assign(base, { transformation: state.build.transformation });
    return base;
  }

  function buffBreakdownRows() {
    const mode = { pve: "mob", pvp: "duel", boss: "boss" }[state.matrix.mode] || "mob";
    const sources = [];
    if (state.build.champion) sources.push({ source: "champion", label: championLabel(state.build.champion) });
    if (state.build.trait) sources.push({ source: "trait", label: data.traits[state.build.trait]?.name || state.build.trait });
    if (state.build.title) sources.push({ source: "title", label: data.titles[state.build.title]?.displayName || state.build.title });
    if (state.build.accessory) sources.push({ source: "accessory", label: data.accessories[state.build.accessory]?.displayName || state.build.accessory });
    if (state.build.transformation) sources.push({ source: "transformation", label: activeTransformationName() });
    const headers = ["Type", "Total", ...sources.map((source) => source.label)];
    const rows = buffSamples().map((sample) => `<tr><th>${sample.label}</th><td>${format(engine.buildMultiplier(sample.move, mode, state))}×</td>${sources.map((source) => `<td>${format(engine.buildMultiplier(sample.move, mode, { build: buildForSource(source.source) }))}×</td>`).join("")}</tr>`).join("");
    return `<table><thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>`;
  }

  function matrixRows() {
    const mode = { pve: "pve", pvp: "player", boss: "boss" }[state.matrix.mode] || "pve";
    const tokens = state.matrix.filterTokens;
    const unique = new Set();
    return entries.map((entry) => {
      const basePower = data.powers[entry.powerId];
      if (!basePower) return null;
      if (!state.matrix.includeCustoms && isCustomEntry(entry)) return null;
      const move = engine.moveConfig(basePower, entry.standId);
      if (!entryAllowed(entry, state.build)) return null;
      if (state.matrix.excludeDamageless && engine.damagingHits(move).length === 0) return null;
      const profile = engine.calculate(move, state)[mode];
      const runtime = move.runtime || {};
      const row = {
        entry,
        attack: move.displayName || entry.powerId,
        source: matrixSource(entry, move),
        dmg: profile.total,
        dot: profile.dotDamage,
        ticks: profile.totalHits,
        dps: profile.dps,
        burst: profile.burst,
        startup: runtime.activationTillFirstHitbox,
        endlag: runtime.activationTillEndlagEnd,
        duration: runtime.durationSeconds,
        cooldown: move.baseCooldown,
        severity: profile.severity.tier,
        group: entry.group,
        folder: entry.folder,
        specialKind: entry.group === "Specials" ? specialKindLabel(entry.folder) : "",
        statType: move.statType,
        damageType: matrixDamageType(move),
        isSpecial: entry.group === "Specials" || move.isSpecial,
      };
      const key = `${entry.key}|${row.source}`;
      if (unique.has(key)) return null;
      unique.add(key);
      if (!tokensMatch(tokens, row.attack, row.source, row.damageType, row.specialKind)) return null;
      if (state.matrix.category === "powers" && row.group !== "Powers") return null;
      if (["Strength", "Chakra", "Sword"].includes(state.matrix.category) && row.statType !== state.matrix.category) return null;
      if (state.matrix.category === "specials" && row.group !== "Specials") return null;
      if (state.matrix.category.startsWith("special:") && row.folder !== state.matrix.category.slice(8)) return null;
      return row;
    }).filter(Boolean).sort((a, b) => {
      const field = state.matrix.sort;
      const left = a[field];
      const right = b[field];
      const result = typeof left === "number" || typeof right === "number" ? (left ?? -Infinity) - (right ?? -Infinity) : String(left || "").localeCompare(String(right || ""));
      return state.matrix.direction === "asc" ? result : -result;
    });
  }

  function renderMatrix() {
    const focus = captureFocus();
    const view = $("#view-matrix");
    const specialNames = { Authority: "Authorities", Bloodline: "Bloodlines", BreathingTechnique: "Breathing Styles", CursedTechnique: "Cursed Techniques", Fruit: "Fruits", Kagune: "Kagunes", Permanent: "Permanent", Reiatsu: "Reiatsu", Stand: "Stands" };
    const specialTypes = [...new Set(entries.filter((entry) => entry.group === "Specials").map((entry) => entry.folder))].sort((a, b) => (specialNames[a] || a).localeCompare(specialNames[b] || b));
    const rows = matrixRows();
    const modeLabel = { pve: "PvE", pvp: "PvP", boss: "Boss" }[state.matrix.mode] || "PvE";
    const columns = [["attack", "Attack"], ["source", "Source"], ["dmg", "DMG"], ["dot", "DoT"], ["ticks", "Ticks"], ["dps", "DPS"], ["burst", "Burst/s"], ["startup", "First Hit"], ["endlag", "Endlag"], ["duration", "Duration"], ["cooldown", "Cooldown"], ["severity", "Severity Rank"]];
    view.innerHTML = `<header class="matrix-header"><div><span class="eyebrow">DAMAGE MATRIX</span><h2>All Attacks</h2></div><span class="matrix-count">${rows.length} rows · ${modeLabel}</span></header><div class="matrix-controls"><label>Mode<select data-matrix-mode><option value="pve">PvE</option><option value="pvp">PvP</option><option value="boss">Boss</option></select></label><label>Category<select data-matrix-category><option value="all">All attacks</option><option value="powers">Powers</option><option value="Strength">Strength</option><option value="Chakra">Chakra</option><option value="Sword">Sword</option><option value="specials">Specials</option>${specialTypes.map((type) => `<option value="special:${type}">${specialNames[type] || type}</option>`).join("")}</select></label><label class="matrix-check"><input data-matrix-customs type="checkbox"${state.matrix.includeCustoms ? " checked" : ""}> Include customs/overrides</label><label>Filter<input data-matrix-filter type="search" value="${state.matrix.filter}" placeholder="Move or source"></label></div><div class="matrix-table-wrap"><table class="matrix-table"><thead><tr>${columns.map(([field, label]) => `<th class="${["dmg", "dot", "ticks", "dps", "burst", "startup", "endlag", "duration", "cooldown", "severity"].includes(field) ? "num" : ""}"><button type="button" data-matrix-sort="${field}">${label}${state.matrix.sort === field ? `<span>${state.matrix.direction === "asc" ? "▲" : "▼"}</span>` : ""}</button></th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr class="matrix-row ${row.isSpecial ? "matrix-is-special" : "matrix-is-power"} matrix-type-${row.damageType.toLowerCase()}" style="${matrixColorStyle(row)}"><td>${data.powers[row.entry.powerId]?.icon ? iconOnly(data.powers[row.entry.powerId].icon, row.attack, "matrix-icon") : ""}<strong>${row.attack}</strong></td><td>${sourceIcon(row.entry, data.powers[row.entry.powerId])}${row.source}</td><td class="num">${format(row.dmg)}</td><td class="num${row.dot ? " matrix-dot" : ""}">${row.dot ? format(row.dot) : "-"}</td><td class="num">${format(row.ticks)}</td><td class="num">${format(row.dps)}</td><td class="num">${format(row.burst)}</td><td class="num">${seconds(row.startup)}</td><td class="num">${seconds(row.endlag)}</td><td class="num">${seconds(row.duration)}</td><td class="num">${seconds(row.cooldown)}</td><td class="num"><span class="tier tier-${row.severity}">Tier ${row.severity}</span></td></tr>`).join("") || `<tr><td colspan="12" class="matrix-empty">No attacks match the current matrix filters.</td></tr>`}</tbody></table></div>`;
    const matrixFilter = view.querySelector("[data-matrix-filter]");
    if (matrixFilter) matrixFilter.closest("label").remove();
    view.querySelector(".matrix-controls").insertAdjacentHTML("beforeend", `<label class="matrix-check"><input data-matrix-damageless type="checkbox"${state.matrix.excludeDamageless ? " checked" : ""}> Exclude damageless</label><label class="matrix-check" title="Add damage-over-time totals to the DPS column"><input data-dot-flag="dps" type="checkbox"${state.dot.dps ? " checked" : ""}> DoT in DPS</label><label class="matrix-check" title="Add damage-over-time totals to the Burst column"><input data-dot-flag="burst" type="checkbox"${state.dot.burst ? " checked" : ""}> DoT in Burst</label><label class="matrix-check" title="Add damage-over-time totals to the DMG column"><input data-dot-flag="total" type="checkbox"${state.dot.total ? " checked" : ""}> DoT in DMG</label>`);
    view.querySelector(".matrix-controls").insertAdjacentHTML("afterend", `<section class="matrix-build"><div class="matrix-build-title"><span class="eyebrow">BASIC BUILD</span><strong>Stats</strong><small>${activeTransformationName()}</small></div><label>Stat value<input data-stat-field="statValue" type="number" min="0" value="${state.statValue}"></label><label>Stat limit %<input data-stat-field="statLimit" type="number" min="0" value="${state.statLimit}"></label><label>Current HP %<input data-build-field="healthPercent" type="number" min="0" max="100" value="${state.build.healthPercent}"></label><label>Max HP<input data-build-field="maxHealth" type="number" min="1" value="${state.build.maxHealth}"></label><label>Champion<input data-champion-search type="search" list="champion-options" value="${championInputValue()}" placeholder="Search champion"><datalist id="champion-options">${championSearchOptions()}</datalist></label><label>Trait<select data-build-field="trait">${selectOptions(data.traits, "name", state.build.trait, "No trait")}</select></label><label>Trait tier<select data-build-field="traitTier">${traitTierOptions()}</select></label><label>Title<select data-build-field="title">${selectOptions(data.titles, "displayName", state.build.title, "No title")}</select></label><label>Accessory<select data-build-field="accessory">${selectOptions(data.accessories, "displayName", state.build.accessory, "No accessory")}</select></label><label>Transformation<select data-build-field="transformation">${transformationOptions()}</select></label><label>Special<select data-build-field="special">${selectOptions(data.specials, "displayName", state.build.special, "No special")}</select></label><aside class="matrix-buffs"><b>Combined Buffs</b>${buffSummaryRows()}</aside></section>`);
    [["champion", "Champion", "Search champion"], ["trait", "Trait", "Search trait"], ["title", "Title", "Search title"], ["accessory", "Accessory", "Search accessory"], ["transformation", "Transformation", "Search transformation"], ["special", "Special", "Search special"]].forEach(([field, label, placeholder]) => {
      const control = field === "champion" ? view.querySelector("[data-champion-search]") : view.querySelector(`[data-build-field="${field}"]`);
      if (control) control.closest("label").outerHTML = buildSearchControl(field, label, placeholder);
    });
    view.querySelector(".matrix-buffs").innerHTML = `<div class="matrix-buffs-header"><b>Combined Buffs</b></div>${buffBreakdownRows()}`;
    view.querySelector(".matrix-build").insertAdjacentHTML("afterend", `<section class="matrix-filter-bar"><label>Filter<span class="matrix-filter-search"><span class="matrix-filter-chips">${matrixFilterChips(state.matrix)}<input data-matrix-filter type="search" value="${state.matrix.filter}" placeholder="Search moves or sources"></span><button type="button" data-clear-matrix-filter aria-label="Clear matrix filter">×</button><span class="matrix-filter-options" hidden></span></span></label></section>`);
    mountBuildSearchPickers(view);
    mountMatrixFilter(view, state.matrix, renderMatrix);
    view.querySelector("[data-matrix-mode]").value = state.matrix.mode;
    view.querySelector("[data-matrix-category]").value = state.matrix.category;
    view.querySelector("[data-matrix-mode]").onchange = (event) => { state.matrix.mode = event.target.value; renderMatrix(); };
    view.querySelector("[data-matrix-category]").onchange = (event) => { state.matrix.category = event.target.value; renderMatrix(); };
    view.querySelector("[data-matrix-customs]").closest("label").remove();
    view.querySelector("[data-matrix-damageless]").onchange = (event) => { state.matrix.excludeDamageless = event.target.checked; renderMatrix(); };
    view.querySelectorAll("[data-dot-flag]").forEach((input) => input.onchange = () => { state.dot[input.dataset.dotFlag] = input.checked; renderMatrix(); if (state.selected) renderAttack(); });
    view.querySelectorAll("[data-stat-field]").forEach((input) => input.onchange = () => { state[input.dataset.statField] = Math.max(0, Number(input.value) || 0); renderMatrix(); });
    view.querySelectorAll("[data-build-field]").forEach((input) => input.onchange = () => {
      const field = input.dataset.buildField;
      state.build[field] = input.type === "number" ? Math.max(0, Number(input.value) || 0) : input.value;
      if (field === "trait") state.build.traitTier = 0;
      if (field === "special") {
        const fullTransform = fullTransformForSpecial(state.build.special);
        if (fullTransform) state.build.transformation = fullTransform.id;
      }
      if (field === "transformation" && (!state.build.transformation || !data.transformations[state.build.transformation]?.isSpecial) && fullTransformSpecialIds().has(state.build.special)) state.build.special = "";
      renderMatrix();
    });
    view.querySelectorAll("[data-matrix-sort]").forEach((button) => button.onclick = () => { const field = button.dataset.matrixSort; if (state.matrix.sort === field) state.matrix.direction = state.matrix.direction === "asc" ? "desc" : "asc"; else { state.matrix.sort = field; state.matrix.direction = ["attack", "source"].includes(field) ? "asc" : "desc"; } renderMatrix(); });
    restoreFocus(focus);
  }

  const BUILD_SLOTS = [
    { field: "champion", group: "Champions", records: () => data.champions, label: (record) => championLabel(record.id), icon: (record) => record.icon, note: (record) => record.rarity || "" },
    { field: "trait", group: "Traits", records: () => data.traits, label: (record) => record.name || record.id, icon: () => "", note: () => "" },
    { field: "title", group: "Titles", records: () => data.titles, label: (record) => record.displayName || record.id, icon: () => "", note: () => "" },
    { field: "accessory", group: "Gears", records: () => data.accessories, label: (record) => record.displayName || record.id, icon: () => "", note: (record) => record.rarity || "" },
    { field: "transformation", group: "Transformations", records: () => data.transformations, label: (record) => record.displayName || record.id, icon: (record) => data.powers[record.id] && data.powers[record.id].icon, note: (record) => record.type || "" },
    { field: "special", group: "Specials", records: () => data.specials, label: (record) => record.displayName || record.id, icon: (record) => record.icon, note: (record) => record.kind || "" },
  ];
  const OBJECTIVES = [
    ["dmg", "Highest DMG"],
    ["burst", "Strongest short burst"],
    ["dps", "Highest DPS"],
    ["tier", "Highest severity"],
    ["survivalBurst", "Highest Burst Survivability"],
    ["survivalDps", "Highest DPS survivability"],
  ];
  const slotFor = (field) => BUILD_SLOTS.find((slot) => slot.field === field);
  const engineMode = (mode) => ({ pve: "mob", pvp: "duel", boss: "boss" })[mode] || "mob";
  const profileKey = (mode) => ({ pve: "pve", pvp: "player", boss: "boss" })[mode] || "pve";
  const transformationSpecialId = (id) => (data.powers[id] && data.powers[id].specialCategory) || "";

  function slotLabel(field, id) {
    const slot = slotFor(field);
    const record = id && slot && slot.records()[id];
    return record ? slot.label(record) : id || "";
  }

  function applyBuildSlot(build, field, id) {
    build[field] = id;
    if (field === "trait") build.traitTier = id && data.traits[id] ? Math.max(0, (data.traits[id].tiers || []).length - 1) : 0;
    if (field === "special") {
      const fullTransform = fullTransformForSpecial(id);
      if (fullTransform) build.transformation = fullTransform.id;
      else if (build.transformation && data.transformations[build.transformation] && data.transformations[build.transformation].isSpecial && transformationSpecialId(build.transformation) !== id) build.transformation = "";
    }
    if (field === "transformation") {
      const transformation = id && data.transformations[id];
      if (transformation && transformation.isSpecial) build.special = transformationSpecialId(id) || build.special;
      else if (fullTransformSpecialIds().has(build.special)) build.special = "";
    }
    if (Array.isArray(build.attacks)) {
      const kept = [];
      build.attacks.forEach((key) => {
        const entry = entries.find((item) => item.key === key);
        if (entry && entryAllowed(entry, Object.assign({}, build, { attacks: kept }))) kept.push(key);
      });
      build.attacks = kept;
    }
    return build;
  }

  function tokensMatch(tokens, attack, source, damageType, specialKind) {
    if (!tokens.length) return true;
    return tokens.some((token) => token.kind === "Damage type" ? damageType.toLowerCase() === token.label.toLowerCase()
      : token.kind === "Special type" ? (specialKind || "").toLowerCase() === token.label.toLowerCase()
      : token.kind === "Source" ? source.toLowerCase() === token.label.toLowerCase()
      : token.kind === "Move" ? attack.toLowerCase() === token.label.toLowerCase()
      : `${attack} ${source} ${damageType} ${specialKind || ""}`.toLowerCase().includes(token.label.toLowerCase()));
  }

  // Every attack is kept because the winning build depends on which attacks it has to serve,
  // but the build multiplier only varies per buff signature, so it is memoised per evaluation.
  function autoBuildAttacks(tokens, mode) {
    const key = profileKey(mode);
    const list = [];
    entries.forEach((entry) => {
      const power = data.powers[entry.powerId];
      if (!power) return;
      if (!state.matrix.includeCustoms && isCustomEntry(entry)) return;
      const move = engine.moveConfig(power, entry.standId);
      if (engine.damagingHits(move).length === 0) return;
      const attack = move.displayName || entry.powerId;
      const source = matrixSource(entry, move);
      const specialKind = entry.group === "Specials" ? specialKindLabel(entry.folder) : "";
      if (!tokensMatch(tokens, attack, source, matrixDamageType(move), specialKind)) return;
      const profile = engine.calculate(move, { statValue: state.statValue, statLimit: state.statLimit, dot: state.dot, build: {} })[key];
      const runtime = move.runtime || {};
      const startup = Math.max(Number(runtime.activationTillFirstHitbox) || 0, 0);
      const duration = Math.max(Number(runtime.durationSeconds) || 0, 0);
      list.push({
        entry, move, attack, source, specialKind, startup, duration,
        specialId: entry.specialId,
        group: entry.group,
        damageType: matrixDamageType(move),
        signature: `${move.statType}|${move.specialType}|${move.specialCategory}`,
        endlag: Math.max(Number(runtime.activationTillEndlagEnd) || 0, 0.1),
        tail: startup + duration,
        base: { dmg: profile.total, dps: profile.dps || 0, burst: profile.burst || 0, rotationalDps: profile.rotationalDps || 0 },
      });
    });
    return list;
  }

  function attackUsable(record, build) {
    const transformation = build.transformation && data.transformations[build.transformation];
    if (transformation && !transformation.isSpecial && transformForSpecial(record.specialId)) return false;
    // A Full transformation locks the kit: powers and every other special are unusable.
    if (fullTransformForSpecial(build.special)) return record.specialId === build.special;
    if (record.group === "Powers" || record.specialId === build.special) return true;
    return mixableSpecial(record.specialId);
  }

  // Many heal boosts only fire below a health threshold, so scoring survival purely at the
  // build's static Current HP% (default 100) hides them entirely. Blend across a sustained
  // fight's health range instead so low-health healing actually competes with raw tankiness.
  const SURVIVAL_HEALTH_SAMPLES = [100, 80, 60, 40, 20];
  function blendedSurvivalDefense(build, mode) {
    const profiles = SURVIVAL_HEALTH_SAMPLES.map((healthPercent) => engine.defenseProfile({ build: Object.assign({}, build, { healthPercent }), mode, defense: state.defense }));
    const avg = (pick) => profiles.reduce((sum, profile) => sum + pick(profile), 0) / profiles.length;
    return Object.assign({}, profiles[0], {
      burstTaken: avg((profile) => profile.burstTaken),
      sustainedTaken: avg((profile) => profile.sustainedTaken),
      burstReduction: avg((profile) => profile.burstReduction),
      sustainedReduction: avg((profile) => profile.sustainedReduction),
      healPerSecond: avg((profile) => profile.healPerSecond),
      effectiveHealth: avg((profile) => profile.effectiveHealth),
      sustainedHealth: avg((profile) => profile.sustainedHealth),
      sustainableDps: avg((profile) => profile.sustainableDps),
      healBreakeven: avg((profile) => profile.healBreakeven),
      // The lowest-health sample is where every conditional heal/reduction is active, so it makes the best contribution list.
      sources: profiles[profiles.length - 1].sources,
    });
  }

  function scoreLoadout(build, attacks, settings) {
    const mode = engineMode(settings.mode);
    const isSurvivalObjective = settings.objective === "survivalBurst" || settings.objective === "survivalDps";
    const defense = isSurvivalObjective ? blendedSurvivalDefense(build, mode) : engine.defenseProfile({ build, mode, defense: state.defense });
    const multipliers = new Map();
    const scored = [];
    attacks.forEach((record) => {
      if (!attackUsable(record, build)) return;
      let multiplier = multipliers.get(record.signature);
      if (multiplier === undefined) {
        multiplier = engine.buildMultiplier(record.move, mode, { build });
        multipliers.set(record.signature, multiplier);
      }
      const burst = record.base.burst * multiplier;
      scored.push({ record, multiplier, dmg: record.base.dmg * multiplier, dps: record.base.dps * multiplier, burst, rotationalDps: record.base.rotationalDps * multiplier, tier: engine.severityFor(record.move, { burst }).tier });
    });
    scored.sort(settings.metric === "severity" ? (a, b) => (b.tier - a.tier) || (b.dmg - a.dmg) : (a, b) => b[settings.metric] - a[settings.metric]);
    const picked = [];
    const kindOwner = new Map();
    if (build.special) kindOwner.set(specialKindOf(build.special), build.special);
    scored.some((item) => {
      const specialId = item.record.specialId;
      if (specialId) {
        const kind = specialKindOf(specialId);
        const owner = kindOwner.get(kind);
        if (owner && owner !== specialId) return false;
        kindOwner.set(kind, specialId);
      }
      picked.push(item);
      return picked.length >= settings.count;
    });
    const chainDamage = picked.reduce((sum, item) => sum + item.dmg, 0);
    // You can act again after endlag, but an attack's damage is not banked until its
    // hitboxes stop, so the chain ends at the last landing rather than the last endlag.
    const rotation = picked.slice().sort((a, b) => b.record.tail - a.record.tail);
    let cursor = 0;
    let lastLanding = 0;
    rotation.forEach((item) => {
      item.startsAt = cursor;
      item.landsAt = cursor + item.record.tail;
      lastLanding = Math.max(lastLanding, item.landsAt);
      cursor += item.record.endlag;
    });
    const chainEndlag = cursor;
    const chainTime = Math.max(lastLanding, chainEndlag);
    const chainDps = chainTime > 0 ? chainDamage / chainTime : 0;
    const chainCycle = Math.max(chainEndlag, ...picked.map((item) => Math.max(0, Number(item.record.move.baseCooldown) || 0) + Math.max(0, Number(item.record.move.runtime?.activationTillCooldownStart) || 0)), 0);
    const chainRotationalDps = chainCycle > 0 ? chainDamage / chainCycle : 0;
    const score = settings.objective === "dmg" ? chainDamage
      : settings.objective === "dps" ? picked.reduce((sum, item) => sum + item.dps, 0)
      : settings.objective === "burst" ? chainDps
      : settings.objective === "tier" ? picked.reduce((sum, item) => sum + item.tier, 0) * 1e9 + chainDamage
      : settings.objective === "survivalBurst" ? defense.effectiveHealth
      : defense.sustainableDps;
    return { score, picked, chainDamage, chainTime, chainEndlag, chainDps, chainCycle, chainRotationalDps, rotation, defense, usable: scored.length };
  }

  function pinnedSpecialId(tokens) {
    const sources = tokens.filter((token) => token.kind === "Source").map((token) => token.label.toLowerCase());
    if (sources.length !== 1) return null;
    const match = Object.values(data.specials || {}).find((special) => (special.displayName || special.id).toLowerCase() === sources[0]);
    return match ? match.id : null;
  }

  function autoSlotOptions(pinned) {
    return BUILD_SLOTS.filter((slot) => !(slot.field === "special" && pinned)).map((slot) => [slot.field, ["", ...Object.keys(slot.records() || {})]]);
  }

  function jaccard(left, right) {
    const union = new Set([...left, ...right]);
    if (!union.size) return 1;
    return [...union].filter((id) => left.has(id) && right.has(id)).length / union.size;
  }

  function buildSimilarity(left, right) {
    const leftSpecials = new Set([left.build.special, ...left.best.picked.map((item) => item.record.specialId)].filter(Boolean));
    const rightSpecials = new Set([right.build.special, ...right.best.picked.map((item) => item.record.specialId)].filter(Boolean));
    const leftPowers = new Set(left.best.picked.map((item) => item.record.entry.powerId));
    const rightPowers = new Set(right.best.picked.map((item) => item.record.entry.powerId));
    const same = (field) => left.build[field] === right.build[field] ? 1 : 0;
    return (same("champion") + same("trait") + same("title") + same("accessory") + jaccard(leftSpecials, rightSpecials) + jaccard(leftPowers, rightPowers)) / 6;
  }

  function diverseBuilds(candidates, limit) {
    const unique = [...candidates.values()].sort((left, right) => right.best.score - left.best.score);
    const selected = [];
    unique.forEach((candidate) => {
      if (selected.length < limit && selected.every((existing) => buildSimilarity(candidate, existing) < 0.7)) selected.push(candidate);
    });
    return selected;
  }

  function runAutoBuild() {
    const settings = {
      mode: state.matrix.mode,
      objective: state.sim.objective,
      metric: state.sim.metric,
      count: 1 + Math.max(0, Number(state.sim.extraAttacks) || 0),
    };
    const tokens = state.sim.auto.filterTokens;
    const attacks = autoBuildAttacks(tokens, settings.mode);
    const pinned = pinnedSpecialId(tokens);
    let build = { healthPercent: state.build.healthPercent, maxHealth: state.build.maxHealth, scalingMode: state.build.scalingMode, champion: "", trait: "", traitTier: 0, title: "", accessory: "", transformation: "", special: "" };
    if (pinned) applyBuildSlot(build, "special", pinned);
    const slots = autoSlotOptions(pinned);
    const candidates = new Map();
    const evaluate = (candidate) => {
      const best = scoreLoadout(candidate, attacks, settings);
      const key = [candidate.champion, candidate.trait, candidate.traitTier, candidate.title, candidate.accessory, candidate.transformation, candidate.special].join("|");
      candidates.set(key, { build: Object.assign({}, candidate), best });
      return best;
    };
    let best = evaluate(build);
    for (let pass = 0; pass < 4; pass += 1) {
      let improved = false;
      slots.forEach(([field, options]) => {
        options.forEach((id) => {
          const trial = applyBuildSlot(Object.assign({}, build), field, id);
          if (pinned && trial.special !== pinned) return;
          const result = evaluate(trial);
          if (result.score > best.score * (1 + 1e-9) + 1e-9) { best = result; build = trial; improved = true; }
        });
      });
      if (!improved) break;
    }
    const builds = diverseBuilds(candidates, 10);
    state.sim.openBuilds = new Set([0]);
    state.sim.selected = 0;
    state.sim.result = { build: builds[0]?.build || build, best: builds[0]?.best || best, builds, settings, attackCount: attacks.length, pinned };
  }

  function passiveNotesMarkup(build) {
    const notes = engine.passiveNotes(build);
    return notes.length ? `<div class="passive-notes"><small>${notes.map((line) => escapeHtml(line)).join("<br>")}</small></div>` : "";
  }

  function buildSlotBreakdown(field, id, mode) {
    const isolated = applyBuildSlot({ healthPercent: state.build.healthPercent, maxHealth: state.build.maxHealth, scalingMode: state.build.scalingMode, special: field === "special" ? "" : state.build.special }, field, id);
    const defense = engine.defenseProfile({ build: isolated, mode: engineMode(mode), defense: state.defense });
    const damage = buffSamples().map((sample) => `<div><span>${sample.label}</span><strong>${format(engine.buildMultiplier(sample.move, engineMode(mode), { build: isolated }))}\u00d7</strong></div>`).join("");
    const rows = [
      ["Max health", `${format(defense.maxHealth)} (\u00d7${format(defense.healthMultiplier)})`],
      ["Damage reduction", `${format(defense.burstReduction * 100)}%`],
      ["Healing", `${format(defense.healPerSecond)} hp/s`],
      ["Heal beats tankiness below", `${format(defense.healBreakeven)} incoming dps`],
    ].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("");
    const contributions = [...defense.sources.health.map((item) => `Health +${format(item.fraction * 100)}% \u2014 ${item.label}`), ...defense.sources.reduction.map((item) => `Reduction ${format(item.fraction * 100)}% \u2014 ${item.label}${item.sustainedOnly ? " (uptime averaged)" : ""}`), ...defense.sources.healing.map((item) => `Heal ${format(item.rate * 100)}%/s \u2014 ${item.label}`), ...defense.sources.notes, ...engine.passiveNotes(isolated)];
    return { damage, rows, contributions };
  }

  function rawEffectRows(field, record) {
    if (field === "trait") return (record.tiers || []).map((tier, index) => [`${tier.rarity || `Tier ${index + 1}`}${Number(state.build.traitTier) === index && state.build.trait === record.id ? " (selected)" : ""}`, (tier.effects || []).map((effect) => `${effect.category} ${effect.modifier}`).join(", ")]);
    const source = field === "title" ? record.effects : field === "transformation" ? record.Perks : record.Boosts;
    return Object.entries(source || {}).map(([key, value]) => [key, typeof value === "object" ? JSON.stringify(value) : String(value)]);
  }

  function renderBuildDetail(mode) {
    const selected = state.builds.selected;
    if (!selected) return '<section class="build-detail empty-detail"><h3>Pick an item</h3><p>Select a champion, trait, title, gear, transformation, or special on the left to see what it does. Use the checkbox to equip it.</p></section>';
    const slot = slotFor(selected.field);
    const record = slot.records()[selected.id];
    if (!record) return '<section class="build-detail empty-detail"><h3>Item unavailable</h3></section>';
    const equipped = state.build[selected.field] === selected.id;
    const breakdown = buildSlotBreakdown(selected.field, selected.id, mode);
    const description = record.specialPerkDescription || record.description || "No description supplied.";
    const tierPicker = selected.field === "trait" ? `<label class="build-tier">Tier<select data-build-tier>${(record.tiers || []).map((tier, index) => `<option value="${index}"${Number(state.build.traitTier) === index ? " selected" : ""}>${tier.rarity || `Tier ${index + 1}`}</option>`).join("")}</select></label>` : "";
    const raw = rawEffectRows(selected.field, record).map(([key, value]) => `<tr><th>${key}</th><td>${value}</td></tr>`).join("");
    return `<section class="build-detail"><header><div class="build-detail-title">${iconNode(slot.icon(record), slot.label(record))}<div><span class="eyebrow">${slot.group.replace(/s$/, "").toUpperCase()}</span><h3>${slot.label(record)}</h3><small>${slot.note(record) || ""}</small></div></div><div class="build-detail-actions">${tierPicker}<button type="button" class="${equipped ? "danger-icon" : ""}" data-toggle-slot="${selected.field}" data-toggle-id="${selected.id}">${equipped ? "Remove from build" : "Add to build"}</button></div></header><p class="move-description">${description}</p><div class="build-detail-grid"><div class="build-metric-block"><b>Damage multipliers (alone)</b>${breakdown.damage}</div><div class="build-metric-block"><b>Survivability (alone)</b>${breakdown.rows}</div></div>${breakdown.contributions.length ? `<ul class="build-contributions">${breakdown.contributions.map((line) => `<li>${line}</li>`).join("")}</ul>` : ""}<div class="section-title"><h3>Raw data</h3></div><table class="build-raw"><tbody>${raw || '<tr><td>No machine-readable effects.</td></tr>'}</tbody></table></section>`;
  }

  function buildCatalogMarkup() {
    const query = state.builds.search.trim().toLowerCase();
    const rarityOrder = ["Sovereign", "Exclusive", "Mythic", "Secret", "Legendary", "Epic", "Rare", "Uncommon", "Common"];
    const rarityKey = (rarity) => {
      const normalized = String(rarity || "").trim().toLowerCase();
      return rarityOrder.find((name) => name.toLowerCase() === normalized) || "Other";
    };
    const itemMarkup = (slot, record, rarity) => {
      const checked = state.build[slot.field] === record.id;
      const active = state.builds.selected && state.builds.selected.field === slot.field && state.builds.selected.id === record.id;
      const rarityClass = rarity ? ` rarity-${rarity.toLowerCase()}` : "";
      const note = slot.field === "champion" ? "" : `<small>${slot.note(record) || ""}</small>`;
      return `<div class="build-item${rarityClass}${active ? " active" : ""}"><label class="build-check"><input type="checkbox" data-toggle-slot="${slot.field}" data-toggle-id="${record.id}"${checked ? " checked" : ""}></label><button type="button" data-open-item="${slot.field}" data-open-id="${record.id}">${iconNode(slot.icon(record), slot.label(record))}<span>${slot.label(record)}</span>${note}</button></div>`;
    };
    return BUILD_SLOTS.map((slot) => {
      const records = Object.values(slot.records() || {}).filter((record) => !query || `${slot.label(record)} ${record.id} ${slot.note(record) || ""}`.toLowerCase().includes(query)).sort((a, b) => slot.label(a).localeCompare(slot.label(b)));
      const open = state.builds.openGroups.has(slot.group) || query.length > 0;
      const items = slot.field === "champion" ? rarityOrder.concat("Other").map((rarity) => {
        const rarityRecords = records.filter((record) => rarityKey(record.rarity) === rarity);
        if (!rarityRecords.length) return "";
        const groupId = `${slot.group}/${rarity}`;
        const groupOpen = state.builds.openGroups.has(groupId) || query.length > 0;
        return `<details class="champion-rarity rarity-${rarity.toLowerCase()}" data-build-group="${groupId}"${groupOpen ? " open" : ""}><summary>${rarity} (${rarityRecords.length})</summary>${rarityRecords.map((record) => itemMarkup(slot, record, rarity)).join("")}</details>`;
      }).join("") : records.map((record) => itemMarkup(slot, record)).join("");
      return `<details data-build-group="${slot.group}"${open ? " open" : ""}><summary>${slot.group} (${records.length})</summary>${items || '<span class="build-search-empty">No matches</span>'}</details>`;
    }).join("");
  }

  function buildBarMarkup() {
    const chips = BUILD_SLOTS.filter((slot) => state.build[slot.field]).map((slot) => `<span class="build-chip"><b>${slot.group.replace(/s$/, "")}</b>${slotLabel(slot.field, state.build[slot.field])}${slot.field === "trait" ? ` \u00b7 ${(data.traits[state.build.trait].tiers || [])[Number(state.build.traitTier)]?.rarity || ""}` : ""}<button type="button" data-clear-slot="${slot.field}" aria-label="Remove">\u00d7</button></span>`).join("");
    return chips || '<span class="build-search-empty">Nothing equipped yet. One item per type can be active.</span>';
  }

  function saveBuildAs(name, build) {
    const trimmed = (name || "").trim();
    if (!trimmed) return false;
    savedBuilds[trimmed] = JSON.parse(JSON.stringify(build));
    persistSavedBuilds();
    return true;
  }

  // Mirrors state.build's shape so a saved simulation candidate loads cleanly in the Builds tab.
  function simSelectedBuild() {
    const result = state.sim.result;
    if (!result || !result.builds.length) return null;
    const index = result.builds[state.sim.selected] ? state.sim.selected : 0;
    const candidate = result.builds[index];
    if (!candidate) return null;
    return Object.assign({}, candidate.build, { championQuery: "", attacks: candidate.best.picked.map((item) => item.record.entry.key) });
  }

  function buildLibraryMarkup() {
    const names = Object.keys(savedBuilds).sort((a, b) => a.localeCompare(b));
    const options = names.map((name) => `<option value="${escapeHtml(name)}"${state.buildLibrary.selected === name ? " selected" : ""}>${escapeHtml(name)}</option>`).join("");
    const hasSelection = names.includes(state.buildLibrary.selected);
    const saveLabel = state.buildLibrary.confirmOverwrite ? "Confirm overwrite?" : "Save selected";
    const deleteLabel = state.buildLibrary.confirmDelete ? "Confirm delete?" : "Delete";
    return `<section class="build-library"><span class="eyebrow">SAVED BUILDS</span><div class="build-library-row"><input data-build-library-name type="text" maxlength="60" value="${escapeHtml(state.buildLibrary.name)}" placeholder="Name this build"><button type="button" class="${state.buildLibrary.confirmOverwrite ? "danger-icon" : ""}" data-save-build-library>${saveLabel}</button></div><div class="build-library-row"><select data-build-library-select><option value="">${names.length ? "Load a saved build\u2026" : "No saved builds yet"}</option>${options}</select><button type="button" data-load-build-library${hasSelection ? "" : " disabled"}>Load</button><button type="button" class="danger-icon" data-delete-build-library${hasSelection ? "" : " disabled"}>${deleteLabel}</button></div></section>`;
  }

  // Native window.confirm() is unreliable here (auto-dismissed by embedded/automated browsers),
  // so overwrite/delete use a same-page two-step confirm: first click arms it, second executes.
  function bindBuildLibrary(view, afterChange, getSelectedBuild) {
    const selectedBuild = getSelectedBuild || (() => state.build);
    const nameInput = view.querySelector("[data-build-library-name]");
    if (nameInput) nameInput.oninput = (event) => {
      state.buildLibrary.name = event.target.value;
      if (state.buildLibrary.confirmOverwrite) { state.buildLibrary.confirmOverwrite = false; afterChange(); }
    };
    const select = view.querySelector("[data-build-library-select]");
    if (select) select.onchange = (event) => { state.buildLibrary.selected = event.target.value; state.buildLibrary.confirmDelete = false; afterChange(); };
    const saveButton = view.querySelector("[data-save-build-library]");
    if (saveButton) {
      const build = selectedBuild();
      saveButton.disabled = !build;
      saveButton.onclick = () => {
        const name = state.buildLibrary.name.trim();
        if (!name || !build) return;
        if (savedBuilds[name] && !state.buildLibrary.confirmOverwrite) { state.buildLibrary.confirmOverwrite = true; afterChange(); return; }
        saveBuildAs(name, build);
        state.buildLibrary.selected = name;
        state.buildLibrary.name = "";
        state.buildLibrary.confirmOverwrite = false;
        afterChange();
      };
    }
    const loadButton = view.querySelector("[data-load-build-library]");
    if (loadButton) loadButton.onclick = () => {
      const record = savedBuilds[state.buildLibrary.selected];
      if (!record) return;
      Object.assign(state.build, JSON.parse(JSON.stringify(record)));
      state.buildSearch = {};
      state.build.championQuery = "";
      state.sim.result = null;
      state.buildLibrary.confirmOverwrite = false;
      state.buildLibrary.confirmDelete = false;
      renderBuilds(); renderMatrix(); renderSimulation();
    };
    const deleteButton = view.querySelector("[data-delete-build-library]");
    if (deleteButton) deleteButton.onclick = () => {
      const name = state.buildLibrary.selected;
      if (!savedBuilds[name]) return;
      if (!state.buildLibrary.confirmDelete) { state.buildLibrary.confirmDelete = true; afterChange(); return; }
      delete savedBuilds[name];
      persistSavedBuilds();
      state.buildLibrary.selected = "";
      state.buildLibrary.confirmDelete = false;
      afterChange();
    };
  }

  function rotationRecords() {
    const key = profileKey(state.matrix.mode);
    return state.build.attacks.map((entryKey) => {
      const entry = entries.find((item) => item.key === entryKey);
      if (!entry) return null;
      const power = data.powers[entry.powerId];
      if (!power || !entryAllowed(entry, state.build)) return null;
      const move = engine.moveConfig(power, entry.standId);
      const profile = engine.calculate(move, state)[key];
      const runtime = move.runtime || {};
      const startup = Math.max(Number(runtime.activationTillFirstHitbox) || 0, 0);
      const duration = Math.max(Number(runtime.durationSeconds) || 0, 0);
      return { entry, move, profile, startup, duration, tail: startup + duration, endlag: Math.max(Number(runtime.activationTillEndlagEnd) || 0, 0.1), cycle: profile.cycle || 0, attack: move.displayName || entry.powerId, source: matrixSource(entry, move) };
    }).filter(Boolean);
  }

  function rotationSummary(records) {
    const ordered = records.slice().sort((a, b) => b.tail - a.tail);
    let cursor = 0;
    let lastLanding = 0;
    ordered.forEach((item) => {
      item.startsAt = cursor;
      item.landsAt = cursor + item.tail;
      lastLanding = Math.max(lastLanding, item.landsAt);
      cursor += item.endlag;
    });
    const damage = records.reduce((sum, item) => sum + item.profile.total, 0);
    const window = Math.max(lastLanding, cursor);
    // Looping the rotation needs every attack off cooldown again, so the slowest one sets the cycle.
    const cycle = Math.max(cursor, ...records.map((item) => item.cycle), 0);
    return { ordered, damage, window, endlag: cursor, cycle, burst: window > 0 ? damage / window : 0, dps: cycle > 0 ? damage / cycle : 0 };
  }

  function rotationMarkup() {
    const records = rotationRecords();
    if (!records.length) return '<div class="build-chips"><span class="build-search-empty">No attacks picked. Tick attacks in the matrix on the right to build a rotation.</span></div>';
    const summary = rotationSummary(records);
    const rows = summary.ordered.map((item, index) => `<tr><td>${index + 1}</td><td><strong>${item.attack}</strong></td><td>${item.source}</td><td class="num">${format(item.profile.total)}</td><td class="num">${format(item.profile.dps)}</td><td class="num">${format(item.profile.burst)}</td><td class="num">${seconds(item.startsAt)}</td><td class="num">${seconds(item.landsAt)}</td><td class="num">${seconds(item.endlag)}</td><td class="num">${seconds(item.cycle)}</td><td><button type="button" class="rotation-remove" data-toggle-attack="${item.entry.key}" aria-label="Remove">\u00d7</button></td></tr>`).join("");
    return `<div class="build-summary"><div><span>Rotation damage</span><strong>${format(summary.damage)}</strong></div><div><span>Lands in</span><strong>${seconds(summary.window)}</strong></div><div><span>Chain burst</span><strong>${format(summary.burst)}</strong></div><div><span>Loop cycle</span><strong>${seconds(summary.cycle)}</strong></div><div><span>Rotation DPS</span><strong>${format(summary.dps)}</strong></div></div><div class="rotation-table-wrap"><table class="matrix-table auto-rotation"><thead><tr><th>#</th><th>Attack</th><th>Source</th><th class="num">DMG</th><th class="num">DPS</th><th class="num">Burst</th><th class="num">Start</th><th class="num">Lands</th><th class="num">Endlag</th><th class="num">Cycle</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function drawerMatrixMarkup() {
    if (!state.builds.matrixOpen) return "";
    const rows = matrixRows();
    const picked = new Set(state.build.attacks);
    const columns = [["attack", "Attack"], ["dmg", "DMG"], ["dps", "DPS"], ["burst", "Burst"], ["endlag", "Endlag"], ["severity", "Tier"]];
    const body = rows.map((row) => `<tr class="matrix-row${picked.has(row.entry.key) ? " picked" : ""}" style="${matrixColorStyle(row)}"><td><label class="build-check"><input type="checkbox" data-toggle-attack="${row.entry.key}"${picked.has(row.entry.key) ? " checked" : ""}></label></td><td><strong>${row.attack}</strong><small>${row.source}</small></td><td class="num">${format(row.dmg)}</td><td class="num">${format(row.dps)}</td><td class="num">${format(row.burst)}</td><td class="num">${seconds(row.endlag)}</td><td class="num"><span class="tier tier-${row.severity}">${row.severity}</span></td></tr>`).join("") || '<tr><td colspan="7" class="matrix-empty">No attacks available to this build.</td></tr>';
    return `<div class="drawer-body"><div class="drawer-head"><b>Buffed matrix</b><span>${rows.length} rows</span></div><label class="drawer-filter"><span class="matrix-filter-search"><span class="matrix-filter-chips">${matrixFilterChips(state.matrix)}<input data-matrix-filter type="search" value="${state.matrix.filter}" placeholder="Search moves, sources, special types"></span><button type="button" data-clear-matrix-filter aria-label="Clear matrix filter">\u00d7</button><span class="matrix-filter-options" hidden></span></span></label><div class="drawer-sort">${columns.slice(1).map(([field, label]) => `<button type="button" data-drawer-sort="${field}"${state.matrix.sort === field ? ' class="active"' : ""}>${label}</button>`).join("")}</div><div class="drawer-table-wrap"><table class="matrix-table drawer-table"><thead><tr><th></th>${columns.map(([, label]) => `<th>${label}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div></div>`;
  }

  function autoResultMarkup() {
    const result = state.sim.result;
    if (!result) return '<p class="severity-explain">Pick an objective and a source filter, then run the search. The optimizer walks one slot at a time, keeps the best set of attacks the build has to serve, and honours the transformation and special exclusion rules.</p>';
    const settings = result.settings;
    const objectiveLabel = (OBJECTIVES.find(([id]) => id === settings.objective) || [])[1];
    const buildList = result.builds.map((candidate, index) => {
      const { build, best } = candidate;
      const defense = best.defense;
      const scoreLine = settings.objective === "survivalBurst" ? `${format(defense.effectiveHealth)} effective HP` : settings.objective === "survivalDps" ? `${format(defense.sustainableDps)} incoming DPS survivable for ${format(defense.window)}s` : settings.objective === "dmg" ? `${format(best.chainDamage)} damage across ${best.picked.length} attacks` : settings.objective === "dps" ? `${format(best.score)} combined DPS across ${best.picked.length} attacks` : settings.objective === "burst" ? `${format(best.chainDps)} chain burst \u00b7 ${format(best.chainDamage)} landed in ${seconds(best.chainTime)}` : `Tier total ${best.picked.reduce((sum, item) => sum + item.tier, 0)} \u00b7 ${format(best.chainDamage)} damage`;
      const slots = BUILD_SLOTS.map((slot) => `<div><span>${slot.group.replace(/s$/, "")}</span><strong>${build[slot.field] ? slotLabel(slot.field, build[slot.field]) : "\u2014"}</strong></div>`).join("");
      const defenseLine = `<div><span>Max health</span><strong>${format(defense.maxHealth)}</strong></div><div><span>Damage taken</span><strong>${format(defense.burstTaken * 100)}%</strong></div><div><span>Effective HP</span><strong>${format(defense.effectiveHealth)}</strong></div><div><span>Healing</span><strong>${format(defense.healPerSecond)} hp/s</strong></div><div><span>Survivable DPS</span><strong>${format(defense.sustainableDps)}</strong></div><div><span>Heal beats tankiness below</span><strong>${format(defense.healBreakeven)} dps</strong></div>`;
      const damageLine = `<div><span>Total damage</span><strong>${format(best.chainDamage)}</strong></div><div><span>Execution time</span><strong>${seconds(best.chainTime)}</strong></div><div><span>Rotational DPS</span><strong>${format(best.chainRotationalDps)}</strong></div>`;
      const rotation = best.rotation.length ? `<table class="matrix-table auto-rotation"><thead><tr><th>#</th><th>Attack</th><th>Source</th><th class="num">DMG</th><th class="num">DPS</th><th class="num">Burst</th><th class="num">Start</th><th class="num">Lands</th><th class="num">Endlag</th><th class="num">Buff</th><th class="num">Tier</th></tr></thead><tbody>${best.rotation.map((item, rotationIndex) => `<tr><td>${rotationIndex + 1}</td><td><strong>${item.record.attack}</strong></td><td>${item.record.source}</td><td class="num">${format(item.dmg)}</td><td class="num">${format(item.dps)}</td><td class="num">${format(item.burst)}</td><td class="num">${seconds(item.startsAt)}</td><td class="num">${seconds(item.landsAt)}</td><td class="num">${seconds(item.record.endlag)}</td><td class="num">${format(item.multiplier)}\u00d7</td><td class="num"><span class="tier tier-${item.tier}">${item.tier}</span></td></tr>`).join("")}</tbody></table>` : '<p class="severity-explain">No attack is usable with this filter and special limit.</p>';
      return `<details data-auto-build="${index}"${state.sim.openBuilds.has(index) ? " open" : ""}><summary><span>Build ${index + 1}</span><strong>${format(best.score)}</strong></summary><div class="auto-build-content"><div class="auto-result-head"><b>${objectiveLabel}</b><span>${scoreLine}</span></div><div class="auto-result-grid">${slots}</div><div class="auto-result-grid">${defenseLine}</div><div class="auto-result-grid">${damageLine}</div><div class="section-title"><h3>Rotation</h3><span>${best.picked.length} of ${best.usable} usable attacks \u00b7 ranked by ${settings.metric} \u00b7 slowest to land first</span></div>${rotation}<small class="severity-explain">${result.attackCount} attacks scanned${result.pinned ? ` \u00b7 special pinned to ${slotLabel("special", result.pinned)}` : ""}. Reduction stacking: ${state.defense.stacking}.</small></div></details>`;
    }).join("");
    return `<div class="auto-result"><div class="section-title"><h3>${objectiveLabel}</h3><span>${result.builds.length} diverse builds</span></div><div class="auto-build-list">${buildList}</div></div>`;
  }

  function bindBuildCatalog(view) {
    view.querySelectorAll("[data-open-item]").forEach((button) => button.onclick = () => { state.builds.selected = { field: button.dataset.openItem, id: button.dataset.openId }; renderBuilds(); });
    view.querySelectorAll("[data-toggle-slot]").forEach((control) => control.onclick = () => {
      const field = control.dataset.toggleSlot;
      const id = control.dataset.toggleId;
      applyBuildSlot(state.build, field, state.build[field] === id ? "" : id);
      state.buildSearch = {};
      state.build.championQuery = "";
      renderBuilds();
    });
    view.querySelectorAll("[data-clear-slot]").forEach((button) => button.onclick = () => { applyBuildSlot(state.build, button.dataset.clearSlot, ""); state.buildSearch = {}; state.build.championQuery = ""; renderBuilds(); });
    view.querySelectorAll("[data-build-group]").forEach((group) => group.addEventListener("toggle", () => group.open ? state.builds.openGroups.add(group.dataset.buildGroup) : state.builds.openGroups.delete(group.dataset.buildGroup)));
  }

  function renderBuilds() {
    const focus = captureFocus();
    const view = $("#view-builds");
    const mode = state.matrix.mode;
    const defense = engine.defenseProfile({ build: state.build, mode: engineMode(mode), defense: state.defense });
    view.innerHTML = `<div class="builds-layout${state.builds.matrixOpen ? " drawer-open" : ""}${state.builds.catalogOpen ? "" : " catalog-collapsed"}"><aside class="builds-catalog">${state.builds.catalogOpen ? `<div class="catalog-content"><div class="catalog-heading"><div><span class="eyebrow">BUFF INDEX</span><h1>Builds</h1></div></div><label class="search-wrap"><span aria-hidden="true">\u2315</span><input data-builds-search type="search" value="${state.builds.search}" placeholder="Search champions, gears, titles"></label><div class="builds-tree">${buildCatalogMarkup()}</div></div>` : ""}<button type="button" class="drawer-toggle catalog-toggle" data-toggle-catalog aria-expanded="${state.builds.catalogOpen}" title="Buff index"><span>${state.builds.catalogOpen ? "\u2039" : "\u203a"}</span><small>INDEX</small></button></aside><div class="builds-main">${buildLibraryMarkup()}<section class="build-bar"><div class="build-bar-head"><span class="eyebrow">CURRENT BUILD</span><label class="matrix-check">Mode<select data-builds-mode><option value="pve">PvE</option><option value="pvp">PvP</option><option value="boss">Boss</option></select></label><label class="matrix-check">Reduction stacking<select data-defense-stacking><option value="multiplicative">Multiplicative</option><option value="additive">Additive</option></select></label><label class="matrix-check">Sustain window<input data-defense-window type="number" min="1" step="1" value="${state.defense.window}"></label><label class="matrix-check"><input data-defense-toggle="inCombat" type="checkbox"${state.defense.inCombat ? " checked" : ""}> In combat</label><label class="matrix-check"><input data-defense-toggle="outOfCombat" type="checkbox"${state.defense.outOfCombat ? " checked" : ""}> Out of combat</label><label class="matrix-check"><input data-defense-toggle="daytime" type="checkbox"${state.defense.daytime ? " checked" : ""}> Daytime</label><label class="matrix-check"><input data-defense-toggle="dungeon" type="checkbox"${state.defense.dungeon ? " checked" : ""}> In dungeon</label></div><div class="build-chips">${buildBarMarkup()}</div><div class="build-summary"><div><span>Max health</span><strong>${format(defense.maxHealth)}</strong></div><div><span>Damage taken</span><strong>${format(defense.burstTaken * 100)}%</strong></div><div><span>Effective HP</span><strong>${format(defense.effectiveHealth)}</strong></div><div><span>Healing</span><strong>${format(defense.healPerSecond)} hp/s</strong></div><div><span>Survivable DPS</span><strong>${format(defense.sustainableDps)}</strong></div><div><span>Heal beats tankiness below</span><strong>${format(defense.healBreakeven)} dps</strong></div></div>${passiveNotesMarkup(state.build)}</section><section class="build-rotation"><div class="build-bar-head"><span class="eyebrow">ROTATION</span><small>Tick attacks in the matrix. Specials can be mixed freely, but only one per type and none that has a transformation.</small><button type="button" data-clear-rotation>Clear</button></div>${rotationMarkup()}</section>${renderBuildDetail(mode)}</div><aside class="matrix-drawer"><button type="button" class="drawer-toggle" data-toggle-drawer aria-expanded="${state.builds.matrixOpen}" title="Damage matrix with applied buffs"><span>${state.builds.matrixOpen ? "\u203a" : "\u2039"}</span><small>MATRIX</small></button>${drawerMatrixMarkup()}</aside></div>`;
    view.querySelector("[data-builds-mode]").value = mode;
    view.querySelector("[data-defense-stacking]").value = state.defense.stacking;
    const buildsSearchInput = view.querySelector("[data-builds-search]");
    if (buildsSearchInput) buildsSearchInput.oninput = (event) => {
      state.builds.search = event.target.value;
      view.querySelector(".builds-tree").innerHTML = buildCatalogMarkup();
      bindBuildCatalog(view);
    };
    view.querySelector("[data-builds-mode]").onchange = (event) => { state.matrix.mode = event.target.value; renderBuilds(); };
    view.querySelector("[data-defense-stacking]").onchange = (event) => { state.defense.stacking = event.target.value; renderBuilds(); };
    view.querySelector("[data-defense-window]").onchange = (event) => { state.defense.window = Math.max(1, Number(event.target.value) || 10); renderBuilds(); };
    view.querySelectorAll("[data-defense-toggle]").forEach((box) => box.onchange = (event) => { state.defense[box.dataset.defenseToggle] = event.target.checked; renderBuilds(); });
    view.querySelector("[data-toggle-drawer]").onclick = () => { state.builds.matrixOpen = !state.builds.matrixOpen; renderBuilds(); };
    view.querySelector("[data-toggle-catalog]").onclick = () => { state.builds.catalogOpen = !state.builds.catalogOpen; renderBuilds(); };
    bindBuildLibrary(view, renderBuilds, () => state.build);
    view.querySelectorAll("[data-drawer-sort]").forEach((button) => button.onclick = () => { const field = button.dataset.drawerSort; if (state.matrix.sort === field) state.matrix.direction = state.matrix.direction === "asc" ? "desc" : "asc"; else { state.matrix.sort = field; state.matrix.direction = "desc"; } renderBuilds(); });
    view.querySelectorAll("[data-toggle-attack]").forEach((control) => control.onclick = () => {
      const key = control.dataset.toggleAttack;
      const index = state.build.attacks.indexOf(key);
      if (index >= 0) state.build.attacks.splice(index, 1);
      else state.build.attacks.push(key);
      renderBuilds();
    });
    view.querySelector("[data-clear-rotation]").onclick = () => { state.build.attacks = []; renderBuilds(); };
    mountMatrixFilter(view, state.matrix, renderBuilds);
    bindBuildCatalog(view);
    const tierSelect = view.querySelector("[data-build-tier]");
    if (tierSelect) tierSelect.onchange = () => { state.build.traitTier = Number(tierSelect.value); renderBuilds(); };
    view.querySelectorAll("[data-build-group]").forEach((group) => group.addEventListener("toggle", () => group.open ? state.builds.openGroups.add(group.dataset.buildGroup) : state.builds.openGroups.delete(group.dataset.buildGroup)));
    restoreFocus(focus);
  }

  function renderSimulation() {
    const focus = captureFocus();
    const view = $("#view-simulation");
    const result = state.sim.result;
    view.innerHTML = `<header class="matrix-header"><div><span class="eyebrow">AUTO BUILD</span><h2>Simulation</h2></div><span class="matrix-count">${state.matrix.mode.toUpperCase()}</span></header>${buildLibraryMarkup()}<section class="autobuild"><div class="build-bar-head"><label class="matrix-check">Objective<select data-sim-field="objective">${OBJECTIVES.map(([id, label]) => `<option value="${id}"${state.sim.objective === id ? " selected" : ""}>${label}</option>`).join("")}</select></label><label class="matrix-check">Extra attacks<input data-sim-field="extraAttacks" type="number" min="0" max="9" step="1" value="${state.sim.extraAttacks}"></label><label class="matrix-check">Rank attacks by<select data-sim-field="metric">${[["dps", "DPS"], ["burst", "Burst"], ["severity", "Severity (best damage)"]].map(([id, label]) => `<option value="${id}"${state.sim.metric === id ? " selected" : ""}>${label}</option>`).join("")}</select></label><label class="matrix-check">Mode<select data-sim-mode><option value="pve">PvE</option><option value="pvp">PvP</option><option value="boss">Boss</option></select></label><button type="button" data-run-auto>Find best build</button></div><label class="autobuild-filter">Source<span class="matrix-filter-search"><span class="matrix-filter-chips">${matrixFilterChips(state.sim.auto)}<input data-matrix-filter type="search" value="${state.sim.auto.filter}" placeholder="Special, special type, stat or move"></span><button type="button" data-clear-matrix-filter aria-label="Clear source filter">×</button><span class="matrix-filter-options" hidden></span></span></label>${autoResultMarkup()}</section>`;
    view.querySelector("[data-sim-mode]").value = state.matrix.mode;
    view.querySelector("[data-sim-mode]").onchange = (event) => { state.matrix.mode = event.target.value; renderSimulation(); };
    view.querySelectorAll("[data-sim-field]").forEach((control) => control.onchange = () => { state.sim[control.dataset.simField] = control.type === "number" ? Math.max(0, Number(control.value) || 0) : control.value; renderSimulation(); });
    view.querySelector("[data-run-auto]").onclick = () => { runAutoBuild(); renderSimulation(); };
    bindBuildLibrary(view, renderSimulation, simSelectedBuild);
    view.querySelectorAll("[data-auto-build]").forEach((option) => option.addEventListener("toggle", () => { const index = Number(option.dataset.autoBuild); if (option.open) { state.sim.openBuilds.add(index); state.sim.selected = index; } else state.sim.openBuilds.delete(index); }));
    mountMatrixFilter(view, state.sim.auto, renderSimulation);
    restoreFocus(focus);
  }

  const REBALANCE_TARGETS = [["dps", "DPS"], ["burst", "Burst"], ["damage", "Damage"], ["activeDps", "Active DPS"]];

  function rebalanceMetric(profile, target) {
    if (target === "damage") return profile.total;
    if (target === "burst") return profile.burst;
    if (target === "activeDps") return profile.activeDps;
    if (target === "rotational") return profile.rotationalDps;
    return profile.dps;
  }

  const rebalanceProfile = (draft) => engine.calculate(draft, state).boss;

  // Each lever is a different knob autobalance is allowed to touch to hit the target metric;
  // damage is tried first because it scales every metric identically, the rest only fine-tune what's left.
  function applyRebalanceLever(draft, lever, targetValue, target) {
    const profile = rebalanceProfile(draft);
    const hit = draft.runtime?.hits?.[0];
    if (lever === "damage" || lever === "tickCount") {
      const current = rebalanceMetric(profile, target);
      if (!Number.isFinite(current) || current <= 0) return;
      const ratio = targetValue / current;
      if (!Number.isFinite(ratio) || ratio <= 0) return;
      if (lever === "damage") {
        // Suggested damage only needs to be readable, not exact - round to 1 decimal.
        const round1 = (num) => Math.round(Math.max(0, num) * 10) / 10;
        draft.bossDamage = round1((draft.bossDamage || 0) * ratio);
        draft.playerDamage = round1((draft.playerDamage || 0) * ratio);
        draft.damageMultiplier = round1((draft.damageMultiplier ?? 1) * ratio);
      } else if (hit) {
        hit.count = Math.max(0, Math.round((hit.count || 0) * ratio));
      }
      return;
    }
    if (!targetValue) return;
    if (lever === "duration") {
      if (target === "burst") {
        const numerator = profile.burst * profile.burstWindow;
        if (Number.isFinite(numerator)) draft.runtime.durationSeconds = Math.max(0, numerator / targetValue - (draft.runtime.activationTillFirstHitbox || 0));
      } else {
        const numerator = profile.activeDps * profile.duration;
        if (Number.isFinite(numerator)) draft.runtime.durationSeconds = Math.max(0, numerator / targetValue);
      }
      return;
    }
    if (lever === "cooldown" || lever === "endlag") {
      const numerator = profile.rotationalDps * profile.cycle;
      if (!Number.isFinite(numerator)) return;
      const newCycle = numerator / targetValue;
      if (lever === "cooldown") draft.baseCooldown = Math.max(0, newCycle - (draft.runtime.activationTillCooldownStart || draft.runtime.activationTillEndlagEnd || 0));
      else { const start = Math.max(0, newCycle - (draft.baseCooldown || 0)); draft.runtime.activationTillCooldownStart = start; draft.runtime.activationTillEndlagEnd = start; }
    }
  }

  function autobalanceDraft(draft, targetValue, target, exclude) {
    const levers = target === "damage" ? ["damage", "tickCount"] : target === "dps" || target === "rotational" ? ["damage", "tickCount", "cooldown", "endlag"] : ["damage", "tickCount", "duration"];
    for (const lever of levers) {
      if (exclude[lever]) continue;
      applyRebalanceLever(draft, lever, targetValue, target);
      const current = rebalanceMetric(rebalanceProfile(draft), target);
      // Rounding to 1 decimal above means an exact match is unrealistic - accept a 2% margin of error.
      if (Number.isFinite(current) && Math.abs(current - targetValue) <= Math.max(1e-6, Math.abs(targetValue) * 0.02)) break;
    }
  }

  function addRebalanceAttack(key) {
    const rb = state.rebalance;
    if (rb.selected.includes(key) || rb.selected.length >= 5) return;
    const entry = entries.find((item) => item.key === key);
    if (!entry) return;
    const snapshot = JSON.parse(JSON.stringify(engine.moveConfig(data.powers[entry.powerId], entry.standId)));
    rb.selected.push(key);
    rb.drafts[key] = JSON.parse(JSON.stringify(snapshot));
    rb.originals[key] = snapshot;
    rb.dirty[key] = false;
    rb.search = "";
  }

  function removeRebalanceAttack(key) {
    const rb = state.rebalance;
    rb.selected = rb.selected.filter((item) => item !== key);
    delete rb.drafts[key]; delete rb.originals[key]; delete rb.dirty[key];
  }

  function commitRebalanceCard(key) {
    const rb = state.rebalance;
    const entry = entries.find((item) => item.key === key);
    const draft = rb.drafts[key];
    if (!entry || !draft) return;
    const wasCustom = !!engine.customData.powers[entry.powerId];
    const record = JSON.parse(JSON.stringify(draft));
    record.id = entry.powerId;
    if (!wasCustom) record.displayName = `${record.displayName || entry.powerId} (Rebalanced)`;
    engine.customData.powers[entry.powerId] = record;
    localStorage.setItem("damage-matrix-customs", JSON.stringify(engine.customData));
    data.powers = engine.allPowers();
    refreshEntries();
    rb.drafts[key] = JSON.parse(JSON.stringify(record));
    rb.originals[key] = JSON.parse(JSON.stringify(record));
    rb.dirty[key] = false;
    renderCatalog();
  }

  function discardRebalanceCard(key) {
    const rb = state.rebalance;
    if (!rb.originals[key]) return;
    rb.drafts[key] = JSON.parse(JSON.stringify(rb.originals[key]));
    rb.dirty[key] = false;
  }

  function updateRebalanceField(key, field, rawValue) {
    const draft = state.rebalance.drafts[key];
    if (!draft) return;
    const hit = draft.runtime?.hits?.[0];
    const value = Math.max(0, Number(rawValue) || 0);
    if (field === "bossDamage") draft.bossDamage = value;
    else if (field === "playerDamage") draft.playerDamage = value;
    else if (field === "damageMultiplier") draft.damageMultiplier = value;
    else if (field === "tickCount" && hit) hit.count = Math.trunc(value);
    else if (field === "durationSeconds") draft.runtime.durationSeconds = value;
    else if (field === "activationTillEndlagEnd") { draft.runtime.activationTillEndlagEnd = value; draft.runtime.activationTillCooldownStart = value; }
    else if (field === "baseCooldown") draft.baseCooldown = value;
    state.rebalance.dirty[key] = true;
  }

  // Scoped update after a keystroke: only touches this card's own nodes so the focused input never gets replaced.
  function rebalanceCardChrome(view, key) {
    const cardNode = view.querySelector(`[data-rebalance-card="${key}"]`);
    const draft = state.rebalance.drafts[key];
    if (!cardNode || !draft) return;
    const rb = state.rebalance;
    const profiles = engine.calculate(draft, state);
    const profile = profiles.boss;
    const dirty = !!rb.dirty[key];
    cardNode.querySelectorAll("[data-rebalance-save], [data-rebalance-discard]").forEach((button) => { button.hidden = !dirty; });
    const metricNode = cardNode.querySelector("[data-rebalance-metric]");
    if (metricNode) metricNode.textContent = `${format(rebalanceMetric(profile, rb.target))} ${REBALANCE_TARGETS.find(([id]) => id === rb.target)[1]}`;
    const statsNode = cardNode.querySelector("[data-rebalance-stats]");
    if (statsNode) statsNode.textContent = `Damage ${format(profile.total)} · DPS ${format(profile.dps)} · Burst ${format(profile.burst)} · Active DPS ${format(profile.activeDps)}`;
    const bossDpsNode = cardNode.querySelector('[data-rebalance-dps="boss"]');
    if (bossDpsNode) bossDpsNode.textContent = `Boss DPS ${format(profiles.boss.dps)}`;
    const playerDpsNode = cardNode.querySelector('[data-rebalance-dps="player"]');
    if (playerDpsNode) playerDpsNode.textContent = `Player DPS ${format(profiles.player.dps)}`;
    const pveDpsNode = cardNode.querySelector('[data-rebalance-dps="pve"]');
    if (pveDpsNode) pveDpsNode.textContent = `PvE DPS ${format(profiles.pve.dps)}`;
  }

  function rebalanceField(label, value, originalValue, field, key, type, dpsKey, dpsText) {
    const safe = Number.isFinite(value) ? Math.round(value * 10000) / 10000 : 0;
    const origText = Number.isFinite(originalValue) ? format(originalValue) : "-";
    const dpsRow = dpsKey ? `<span class="rebalance-field-dps" data-rebalance-dps="${dpsKey}">${dpsText}</span>` : "";
    return `<label>${dpsRow}<span class="rebalance-field-name">${label} <small>orig ${origText}</small></span><input data-rebalance-field="${field}" data-rebalance-key="${key}" type="number" min="0" step="${type === "integer" ? "1" : "any"}" value="${safe}"></label>`;
  }

  function rebalanceCardMarkup(key, index) {
    const rb = state.rebalance;
    const entry = entries.find((item) => item.key === key);
    const draft = rb.drafts[key];
    const original = rb.originals[key];
    if (!entry || !draft) return "";
    const profiles = engine.calculate(draft, state);
    const profile = profiles.boss;
    const hit = draft.runtime?.hits?.[0] || {};
    const originalHit = original?.runtime?.hits?.[0] || {};
    const dirty = !!rb.dirty[key];
    const metricLabel = REBALANCE_TARGETS.find(([id]) => id === rb.target)[1];
    return `<article class="rebalance-card" data-rebalance-card="${key}"><header class="rebalance-card-head"><div class="rebalance-card-title">${iconNode(draft.icon, draft.displayName || entry.powerId)}<div><strong>${draft.displayName || entry.powerId}</strong>${index === 0 ? '<span class="badge">Baseline</span>' : ""}</div></div><div class="rebalance-card-actions"><span class="rebalance-metric" data-rebalance-metric>${format(rebalanceMetric(profile, rb.target))} ${metricLabel}</span><button type="button" class="icon-button" data-rebalance-save${dirty ? "" : " hidden"} title="Save as override">✓</button><button type="button" class="icon-button danger-icon" data-rebalance-discard${dirty ? "" : " hidden"} title="Discard edits">×</button><button type="button" class="icon-button" data-rebalance-remove title="Remove from list">–</button></div></header><div class="custom-form rebalance-card-fields">${rebalanceField("BossDMG", draft.bossDamage, original?.bossDamage, "bossDamage", key, "number", "boss", `Boss DPS ${format(profiles.boss.dps)}`)}${rebalanceField("PlayerDMG", draft.playerDamage, original?.playerDamage, "playerDamage", key, "number", "player", `Player DPS ${format(profiles.player.dps)}`)}${rebalanceField("PvE multiplier", draft.damageMultiplier, original?.damageMultiplier, "damageMultiplier", key, "number", "pve", `PvE DPS ${format(profiles.pve.dps)}`)}${rebalanceField("Tick count", hit.count, originalHit.count, "tickCount", key, "integer")}${rebalanceField("Duration (s)", draft.runtime?.durationSeconds, original?.runtime?.durationSeconds, "durationSeconds", key)}${rebalanceField("Endlag (s)", draft.runtime?.activationTillEndlagEnd, original?.runtime?.activationTillEndlagEnd, "activationTillEndlagEnd", key)}${rebalanceField("Cooldown (s)", draft.baseCooldown, original?.baseCooldown, "baseCooldown", key)}</div><p class="rebalance-card-stats" data-rebalance-stats>Damage ${format(profile.total)} · DPS ${format(profile.dps)} · Burst ${format(profile.burst)} · Active DPS ${format(profile.activeDps)}</p></article>`;
  }

  function renderRebalance() {
    const focus = captureFocus();
    const view = $("#view-rebalance");
    const rb = state.rebalance;
    const query = rb.search.trim().toLowerCase();
    const results = query ? entries.filter((entry) => !rb.selected.includes(entry.key) && `${data.powers[entry.powerId]?.displayName || entry.powerId} ${entry.folder}`.toLowerCase().includes(query)).slice(0, 8) : [];
    const pickerResults = results.length ? `<div class="build-search-options">${results.map((entry) => `<button type="button" data-rebalance-add="${entry.key}">${iconNode(attackIcon(entry, data.powers[entry.powerId]), data.powers[entry.powerId]?.displayName || entry.powerId)}<span>${data.powers[entry.powerId]?.displayName || entry.powerId}<small>${entry.folder}</small></span></button>`).join("")}</div>` : query ? '<div class="build-search-options"><span class="build-search-empty">No matches</span></div>' : "";
    const picker = `<div class="rebalance-picker"><label class="search-wrap"><span aria-hidden="true">⌕</span><input data-rebalance-search type="search" value="${escapeHtml(rb.search)}" placeholder="${rb.selected.length >= 5 ? "Maximum of 5 attacks selected" : "Add an attack to rebalance (up to 5)"}"${rb.selected.length >= 5 ? " disabled" : ""}></label>${pickerResults}</div>`;
    const excludeCheckbox = (id, label) => `<label class="matrix-check"><input type="checkbox" data-rebalance-exclude="${id}"${rb.exclude[id] ? " checked" : ""}> ${label}</label>`;
    const controls = rb.selected.length ? `<section class="autobuild rebalance-controls"><div class="build-bar-head"><label class="matrix-check">Autobalance target<select data-rebalance-target>${REBALANCE_TARGETS.map(([id, label]) => `<option value="${id}"${rb.target === id ? " selected" : ""}>${label}</option>`).join("")}</select></label><button type="button" data-rebalance-suggest${rb.selected.length < 2 ? " disabled" : ""}>Suggest autobalance</button></div><div class="rebalance-exclude"><span>Lock during autobalance</span>${excludeCheckbox("damage", "Damage")}${excludeCheckbox("tickCount", "Tick count")}${excludeCheckbox("duration", "Duration")}${excludeCheckbox("endlag", "Endlag")}${excludeCheckbox("cooldown", "Cooldown")}</div></section>` : "";
    const cards = rb.selected.length ? `<div class="rebalance-cards">${rb.selected.map((key, index) => rebalanceCardMarkup(key, index)).join("")}</div>` : '<div class="empty-view"><h2>Add up to 5 attacks.</h2><p>Pick attacks above to line up their stats and rebalance them against each other.</p></div>';
    const explain = `<p class="severity-explain rebalance-explain">How it works: pick a target metric (Damage, DPS, Burst, or Active DPS). "Suggest autobalance" takes the leftmost attack as the baseline and rescales every other selected attack to match its value for that metric. By default it scales raw damage (BossDMG / PlayerDMG / PvE multiplier); lock damage in the checkboxes above and it falls back to tick count, then duration/endlag/cooldown, whichever knobs you haven't locked. Nothing is written to your customs until you press Save on a card; Discard reverts that card back to its last saved values.</p>`;
    view.innerHTML = `<header class="matrix-header"><div><span class="eyebrow">REBALANCE</span><h2>Rebalance attacks</h2></div><span class="matrix-count">${rb.selected.length}/5 selected</span></header>${controls}${picker}${cards}${explain}`;
    view.querySelector("[data-rebalance-search]").oninput = (event) => { rb.search = event.target.value; renderRebalance(); };
    view.querySelectorAll("[data-rebalance-add]").forEach((button) => button.onclick = () => { addRebalanceAttack(button.dataset.rebalanceAdd); renderRebalance(); });
    const targetSelect = view.querySelector("[data-rebalance-target]");
    if (targetSelect) targetSelect.onchange = (event) => { rb.target = event.target.value; renderRebalance(); };
    view.querySelectorAll("[data-rebalance-exclude]").forEach((box) => box.onchange = () => { rb.exclude[box.dataset.rebalanceExclude] = box.checked; });
    const suggestButton = view.querySelector("[data-rebalance-suggest]");
    if (suggestButton) suggestButton.onclick = () => {
      const baseDraft = rb.drafts[rb.selected[0]];
      if (!baseDraft) return;
      const targetValue = rebalanceMetric(rebalanceProfile(baseDraft), rb.target);
      if (!Number.isFinite(targetValue) || targetValue <= 0) return;
      rb.selected.slice(1).forEach((key) => { autobalanceDraft(rb.drafts[key], targetValue, rb.target, rb.exclude); rb.dirty[key] = true; });
      renderRebalance();
    };
    view.querySelectorAll("[data-rebalance-field]").forEach((input) => input.addEventListener("input", () => { updateRebalanceField(input.dataset.rebalanceKey, input.dataset.rebalanceField, input.value); rebalanceCardChrome(view, input.dataset.rebalanceKey); }));
    view.querySelectorAll("[data-rebalance-save]").forEach((button) => button.onclick = () => { commitRebalanceCard(button.closest("[data-rebalance-card]").dataset.rebalanceCard); renderRebalance(); });
    view.querySelectorAll("[data-rebalance-discard]").forEach((button) => button.onclick = () => { discardRebalanceCard(button.closest("[data-rebalance-card]").dataset.rebalanceCard); renderRebalance(); });
    view.querySelectorAll("[data-rebalance-remove]").forEach((button) => button.onclick = () => { removeRebalanceAttack(button.closest("[data-rebalance-card]").dataset.rebalanceCard); renderRebalance(); });
    restoreFocus(focus);
  }

  function renderDetails() {
    const view = $("#view-details");
    view.innerHTML = `<header class="matrix-header"><div><span class="eyebrow">REFERENCE</span><h2>How calculations work</h2></div></header><div class="details-guide"><section><h3>Starting damage</h3><p>Each move has one or more hits. The calculator finds the base damage for the chosen target mode, multiplies it by each hit's damage multiplier, then multiplies by that hit's count. Adding those hit totals gives direct damage.</p><p>Boss mode starts from the move's BossDMG value. PvP starts from PlayerDMG. PvE starts from your stat value, your stat limit, and the move's PvE multiplier.</p></section><section><h3>Build buffs</h3><p>Your champion, trait, title, gear, and transformation can add damage for a matching stat, special, or target mode. In Multiplicative mode, each matching buff multiplies the running value. In Additive mode, the bonus portions are added together before they are applied.</p><p>For example, two +20% matching buffs become 1.2 x 1.2 = 1.44 in Multiplicative mode, or 1 + 0.2 + 0.2 = 1.4 in Additive mode.</p></section><section><h3>Damage over time</h3><p>A status effect with DoT is calculated separately after direct damage. Its tick damage uses its listed basis, applies the same build multiplier, then multiplies by its number of ticks. It only applies when the status can affect the selected target mode.</p><p>The three DoT checkboxes on an attack decide where that value is included: Total Damage, DPS, Active DPS, and Burst. By default it counts in total damage and DPS, but not burst.</p></section><section><h3>Timing and rate metrics</h3><p>DPS divides damage by the full cycle, which is cooldown start plus base cooldown. Active DPS divides damage by the move duration. Burst divides damage by startup plus duration, representing how quickly its damage first resolves.</p><p>For a chosen rotation, attacks are scheduled one after another using their endlag. Chain burst uses the time until the final hit lands. The repeating rotation uses the longer of the chained endlag and its slowest cooldown cycle.</p></section><section><h3>Defense and survivability</h3><p>Health bonuses raise maximum health. Damage reduction lowers incoming damage using either multiplicative or additive stacking, selected in Builds. Effective HP is maximum health divided by the damage taken fraction.</p><p>Survivable DPS uses the chosen sustain window, your effective health, and any continuous healing. It estimates the incoming DPS that would empty the health pool exactly at the end of that window.</p></section><section><h3>Severity and rebalance</h3><p>Severity is a 0 to 9 estimate based on burst damage, largest hitbox size, duration, and endlag. A move can override that result with a manual tier.</p><p>Rebalance takes the first selected move as the baseline. It adjusts the other moves toward the same chosen metric by changing damage first, then tick count or timing controls that are not locked.</p></section></div>`;
  }

  function renderAttack() {
    const view = $("#view-attacks");
    if (!state.selected) { view.innerHTML = '<div class="empty-view"><h2>Choose a move.</h2></div>'; return; }
    const move = engine.moveConfig(data.powers[state.selected.powerId], state.selected.standId);
    const profiles = engine.calculate(move, state); const boss = profiles.boss; const runtime = move.runtime || {}; const statuses = boss.statuses;
    const dotToggles = `<div class="dot-toggles"><label><input data-dot-flag="total" type="checkbox"${state.dot.total ? " checked" : ""}> Count DoT in total damage</label><label><input data-dot-flag="dps" type="checkbox"${state.dot.dps ? " checked" : ""}> Count DoT in DPS</label><label><input data-dot-flag="burst" type="checkbox"${state.dot.burst ? " checked" : ""}> Count DoT in burst</label></div>`;
    const statusSection = statuses.length ? `${dotToggles}<div class="status-list">${statuses.map((item) => `<article class="status-card${item.applies ? "" : " status-inactive"}"><strong>${item.status.label || item.status.effect}</strong><p>${item.applies ? `${format(item.ticks)} ticks × ${format(item.tickDamage)} = <b>${format(item.total)}</b> over ${seconds(item.duration)}` : "Not applied to this target mode."}</p><small>${item.applies ? `${format(item.perSecond)} dmg/s · tick every ${seconds(item.interval)} · targets ${item.status.target || "both"}` : `targets ${item.status.target || "both"}`}</small></article>`).join("")}</div>` : `${dotToggles}<div class="status-note">No native applied status effect.</div>`;
    const hitRows = boss.hits.map((item) => `<tr><td>${item.hit.label || "Hit"}</td><td class="num">${format(item.hit.count)}</td><td class="num">${format(item.perHit)}</td><td class="num">${format(item.perHit * item.hit.count)}</td><td>${item.hit.hitbox ? `${item.hit.hitbox.shape || "Unknown"} ${item.hit.hitbox.size ? item.hit.hitbox.size.join(" × ") : ""}` : "-"}</td><td>${seconds(item.hit.duration)}</td></tr>`).join("");
    const severityOptions = (profile) => `<option value="auto">Auto</option>${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((tier) => `<option value="${tier}"${Number(profile.severity.tier) === tier ? " selected" : ""}>Tier ${tier}</option>`).join("")}`;
    const severityRows = [["BossDMG", profiles.boss], ["PVEDMG", profiles.pve], ["PlayerDMG", profiles.player]].map(([label, profile]) => `<div class="severity-row"><strong>${label}</strong><select class="tier-select tier-${profile.severity.tier}" data-severity-tier title="Select manual severity">${severityOptions(profile)}</select><span>${format(profile.burst)} burst · ${profile.severity.manual ? "manual override" : `score ${profile.severity.score}`}</span></div>`).join("");
    const source = state.selected.specialId && data.specials[state.selected.specialId] ? data.specials[state.selected.specialId].displayName : move.specialCategory || move.statFolder || "Power";
    const range = move.range ?? (move.runtime && move.runtime.range);
    const firstHitbox = boss.hits.find((item) => item.hit.hitbox && Array.isArray(item.hit.hitbox.size));
    const hitboxSize = firstHitbox ? firstHitbox.hit.hitbox.size : [];
    const isCustom = !!engine.customData.powers[state.selected.powerId];
    const customRecord = isCustom ? engine.customData.powers[state.selected.powerId] : null;
    const topProfile = `<div class="stat-grid">${isCustom ? inlineField("BossDMG", customRecord.bossDamage, "bossDamage", "number") : card("BossDMG", format(move.bossDamage), "flat per hit")}${isCustom ? inlineField("PVEDMG", customRecord.damageMultiplier, "damageMultiplier", "number") : card("PVEDMG", `× ${format(move.damageMultiplier)}`, `${format(profiles.pve.total)} total`)}${isCustom ? inlineField("PlayerDMG", customRecord.playerDamage, "playerDamage", "number") : card("PlayerDMG", format(move.playerDamage), `${format(profiles.player.total)} total`)}${isCustom ? inlineField("Status effect", customRecord.runtime?.statuses?.[0]?.effect || "None", "statusEffect", "select", ["None", "Burn", "Frozen", "Stunned", "Slowed", "Heavy", "Pull", "Knockback", "Grab", "DamageDebuff", "Other"]) : card("Status effect", statuses.length ? format(boss.statusDamage) : "None", "native status")}</div>`;
    const dataGrid = isCustom ? `<div class="detail-grid">${inlineField("Type", customRecord.statType || "None", "statType", "select", ["None", "Strength", "Chakra", "Sword"])}${inlineField("Ticks", customRecord.runtime?.hits?.[0]?.count || 0, "tickCount", "integer")}${inlineField("Cooldown", customRecord.baseCooldown, "baseCooldown", "number")}${inlineField("Range", customRecord.range || 0, "range", "number")}${inlineField("Activation till cooldown", customRecord.runtime?.activationTillCooldownStart || 0, "activationTillCooldownStart", "number")}${inlineField("Activation till endlag", customRecord.runtime?.activationTillEndlagEnd || 0, "activationTillEndlagEnd", "number")}${inlineField("Activation till first hitbox", customRecord.runtime?.activationTillFirstHitbox || 0, "activationTillFirstHitbox", "number")}${inlineField("Duration", customRecord.runtime?.durationSeconds || 0, "durationSeconds", "number")}${inlineField("Hitbox type", customRecord.runtime?.hits?.[0]?.hitbox?.shape || "Ball", "hitboxType", "select", ["Ball", "Block", "Box", "Cylinder", "Projectile"])}${inlineField("X size", customRecord.runtime?.hits?.[0]?.hitbox?.size?.[0] || 0, "hitboxX", "number")}${inlineField("Z size", customRecord.runtime?.hits?.[0]?.hitbox?.size?.[2] || 0, "hitboxZ", "number")}${inlineField("Y size", customRecord.runtime?.hits?.[0]?.hitbox?.size?.[1] || 0, "hitboxY", "number")}</div>` : `<div class="detail-grid">${detail("Type", move.statType || "-")}${detail("Ticks", format(boss.totalHits))}${detail("Cooldown", seconds(move.baseCooldown))}${detail("Range", range === undefined ? "-" : format(range))}${detail("Activation till cooldown", seconds(runtime.activationTillCooldownStart))}${detail("Activation till endlag", seconds(runtime.activationTillEndlagEnd))}${detail("Activation till first hitbox", seconds(runtime.activationTillFirstHitbox))}${detail("Duration", seconds(runtime.durationSeconds))}${detail("Hitbox type", firstHitbox?.hit.hitbox?.shape || "-")}${detail("X size", hitboxSize[0] === undefined ? "-" : format(hitboxSize[0]))}${detail("Z size", hitboxSize[2] === undefined ? "-" : format(hitboxSize[2]))}${detail("Y size", hitboxSize[1] === undefined ? "-" : format(hitboxSize[1]))}</div>`;
    const action = isCustom ? '<button type="button" class="icon-button" data-save-attack title="Save custom attack">✓</button><button type="button" class="icon-button danger-icon" data-delete-attack title="Delete custom attack">×</button>' : '<button type="button" class="override-button" data-override>Override</button>';
    const headerSeverity = `<span class="severity-icon tier-${profiles.boss.severity.tier}">${profiles.boss.severity.tier}</span>`;
    view.innerHTML = `<header class="move-header"><div class="move-title"><div class="badges"><span class="badge">${move.isSpecial ? `Special · ${move.specialType || ""}` : `Power · ${move.statType || ""}`}</span></div><div class="title-line">${iconNode(move.icon, move.displayName || move.id)}<div><div class="move-name-row"><h2>${move.displayName || move.id}</h2>${headerSeverity}</div><div class="move-source">${source}</div><p class="move-description">${move.description || "No description supplied."}</p></div></div></div><div class="header-actions">${action}</div></header><div class="section-title"><h3>Damage profile</h3><span>default stat: ${format(state.statValue)}</span></div>${topProfile}${profileCards("Boss damage", profiles.boss, false, move)}${profileCards("PvE damage", profiles.pve, true, move)}${profileCards("Player damage", profiles.player, false, move)}<div class="section-title"><h3>Status effects</h3><span>damage over time</span></div>${statusSection}<div class="section-title"><h3>Move data</h3></div>${dataGrid}<div class="section-title"><h3>Hitboxes</h3></div><div style="overflow:auto"><table class="hit-table"><thead><tr><th>Hitbox</th><th class="num">Ticks</th><th class="num">Tick damage</th><th class="num">Total</th><th>Shape / size</th><th>Duration</th></tr></thead><tbody>${hitRows}</tbody></table></div><div class="section-title"><h3>Severity</h3></div><div class="severity-list">${severityRows}</div>`;
    view.querySelectorAll("[data-dot-flag]").forEach((input) => input.onchange = () => { state.dot[input.dataset.dotFlag] = input.checked; renderAttack(); renderMatrix(); });
    view.querySelectorAll("[data-severity-tier]").forEach((control) => control.onchange = () => {
      if (!isCustom) return;
      if (control.value === "auto") delete customRecord.severityOverride;
      else customRecord.severityOverride = Number(control.value);
      localStorage.setItem("damage-matrix-customs", JSON.stringify(engine.customData));
      renderAttack();
    });
    view.querySelectorAll("[data-inline-field]").forEach((control) => control.addEventListener(control.tagName === "SELECT" ? "change" : "blur", () => {
      const field = control.dataset.inlineField;
      const value = control.type === "number" ? Math.max(0, Number(control.value) || 0) : control.value;
      const record = engine.customData.powers[state.selected.powerId];
      const hit = record.runtime?.hits?.[0];
      if (!record) return;
      if (field === "statType") record.statType = value === "None" ? "Durability" : value;
      else if (["bossDamage", "playerDamage", "damageMultiplier", "baseCooldown", "range"].includes(field)) record[field] = value;
      else if (field === "severityOverride") record.severityOverride = Math.min(10, Math.trunc(value));
      else if (["activationTillCooldownStart", "activationTillEndlagEnd", "activationTillFirstHitbox", "durationSeconds"].includes(field)) record.runtime[field] = value;
      else if (field === "tickCount" && hit) hit.count = Math.trunc(value);
      else if (field === "hitboxType" && hit) hit.hitbox.shape = value;
      else if (field === "hitboxX" && hit) hit.hitbox.size[0] = value;
      else if (field === "hitboxZ" && hit) hit.hitbox.size[2] = value;
      else if (field === "hitboxY" && hit) hit.hitbox.size[1] = value;
      else if (field === "statusEffect") record.runtime.statuses = value === "None" ? [] : [{ effect: value, target: "both" }];
      localStorage.setItem("damage-matrix-customs", JSON.stringify(engine.customData));
      renderAttack();
    }));
    view.querySelectorAll("[data-inline-field]").forEach((control) => control.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); control.blur(); } }));
    const overrideButton = view.querySelector("[data-override]");
    if (overrideButton) overrideButton.onclick = () => { const id = state.selected.powerId; engine.customData.powers[id] = JSON.parse(JSON.stringify(move)); engine.customData.powers[id].id = id; engine.customData.powers[id].displayName = `${move.displayName || move.id} (Override)`; data.powers = engine.allPowers(); refreshEntries(); openCustomEditor("power", id); renderCatalog(); };
    const deleteButton = view.querySelector("[data-delete-attack]");
    const saveAttack = view.querySelector("[data-save-attack]");
    if (saveAttack) saveAttack.onclick = saveCustoms;
    view.querySelectorAll("[data-detail-edit], [data-profile-edit]").forEach((button) => button.onclick = () => openCustomEditor("power", state.selected.powerId));
    if (deleteButton) deleteButton.onclick = () => { delete engine.customData.powers[state.selected.powerId]; Object.values(engine.customData.specials).forEach((special) => { special.abilities = (special.abilities || []).filter((ability) => ability.powerId !== state.selected.powerId); }); data.powers = engine.allPowers(); data.specials = engine.allSpecials(); refreshEntries(); state.selected = null; localStorage.setItem("damage-matrix-customs", JSON.stringify(engine.customData)); renderCatalog(); renderAttack(); };
  }

  document.querySelectorAll(".nav-item").forEach((item) => item.onclick = () => { state.activeView = item.dataset.view; document.querySelectorAll(".nav-item").forEach((nav) => nav.classList.toggle("active", nav === item)); document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === `view-${item.dataset.view}`)); $("#app").classList.toggle("matrix-mode", state.activeView !== "attacks"); if (state.activeView === "matrix") renderMatrix(); if (state.activeView === "builds") renderBuilds(); if (state.activeView === "simulation") renderSimulation(); if (state.activeView === "rebalance") renderRebalance(); if (state.activeView === "details") renderDetails(); });
  $("#search").oninput = (event) => { state.search = event.target.value; renderCatalog(); };
  $("#hide-utility").onchange = renderCatalog;
  $("#theme-toggle").onclick = () => { state.theme = state.theme === "dark" ? "light" : "dark"; document.documentElement.dataset.theme = state.theme; localStorage.setItem("damage-matrix-theme", state.theme); };
  $("#damage-scaling").value = state.build.scalingMode;
  $("#damage-scaling").onchange = (event) => { state.build.scalingMode = event.target.value; state.sim.result = null; renderMatrix(); renderBuilds(); renderSimulation(); if (state.selected) renderAttack(); };
  $("#allow-custom-moves").checked = state.matrix.includeCustoms;
  $("#allow-custom-moves").onchange = (event) => { state.matrix.includeCustoms = event.target.checked; state.sim.result = null; renderMatrix(); renderBuilds(); renderSimulation(); };
  document.documentElement.dataset.theme = state.theme;
  $("#data-status").textContent = data.generatedAt ? `Synced ${new Date(data.generatedAt).toLocaleDateString()}` : "Data unavailable";
  state.selected = entries.find((entry) => entry.powerId === "JudgementCut") || entries[0] || null;
  renderCatalog(); renderAttack(); renderMatrix(); renderBuilds(); renderSimulation(); renderDetails();
})();
