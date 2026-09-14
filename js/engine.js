(function () {
  "use strict";

  const data = window.GAME_DATA || { powers: {}, specials: {}, constants: {} };
  const constants = data.constants || {};
  const customData = window.CUSTOM_DATA || { powers: {}, specials: {} };

  function number(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  }

  // Live data gives no interval for flat-rate heal passives, so one is assumed here.
  const ASSUMED_HEAL_INTERVAL = 10;
  const SUSTAIN_WINDOW = 10;

  function dotFlags(options) {
    const flags = options && options.dot || {};
    if (flags.enabled === false) return { total: false, dps: false, burst: false };
    return { total: flags.total !== false, dps: flags.dps !== false, burst: flags.burst !== false };
  }

  function moveConfig(power, standId) {
    if (!power) return null;
    const move = Object.assign({}, power);
    const stand = standId && data.specials ? data.specials[standId] : null;
    const override = stand && stand.universalOverrides && stand.universalOverrides[power.id];
    if (override) {
      Object.entries(override).forEach(([key, value]) => {
        if (key === "Properties" && value && typeof value === "object") Object.assign(move, value);
        else if (typeof value === "number") move[key] = value;
      });
    }
    move.standId = standId || null;
    return move;
  }

  function allPowers() {
    return Object.assign({}, data.powers || {}, customData.powers || {});
  }

  function allSpecials() {
    return Object.assign({}, data.specials || {}, customData.specials || {});
  }

  function canonicalSpecialKind(kind) {
    return {
      Bloodlines: "Bloodline",
      BreathingStyles: "BreathingTechnique",
      CursedTechniques: "CursedTechnique",
      Fruits: "Fruit",
      Kagunes: "Kagune",
      Stands: "Stand",
    }[kind] || kind || "Other";
  }

  function abilitiesForSpecial(special) {
    const abilities = (special.abilities || []).map((ability) => Object.assign({}, ability));
    if (special.kind === "Stand" && allPowers().StandBarrage && !abilities.some((ability) => ability.powerId === "StandBarrage")) {
      abilities.unshift({ key: "Z", powerId: "StandBarrage" });
    }
    if (special.kind === "Stand") {
      abilities.forEach((ability) => { if (ability.powerId === "StandBarrage") ability.key = "Z"; });
      if ((special.id === "StarPlatinum" || special.id === "TheWorld") && allPowers().Timestop) {
        const timestop = abilities.find((ability) => ability.powerId === "Timestop");
        if (timestop) timestop.key = "V";
        else abilities.push({ key: "V", powerId: "Timestop" });
      }
    }
    return abilities;
  }

  function hitsFor(move) {
    return move && move.runtime && Array.isArray(move.runtime.hits) ? move.runtime.hits : [];
  }

  function damagingHits(move) {
    return hitsFor(move).filter((hit) => hit.damage && (hit.damage.basis === "power" || !hit.damage.basis) && hit.damage.basis !== "flat" && number(hit.count, 0) > 0);
  }

  function baseDamage(move, mode, statValue, statLimit) {
    if (mode === "duel") return number(move.playerDamage, 0);
    if (mode === "mob") return number(statValue, 0) * number(statLimit, 100) / 100 * number(move.damageMultiplier, 1);
    return number(move.bossDamage, 0);
  }

  function boostMatches(key, move) {
    const normalized = canonicalSpecialKind(key);
    return key === "Any" || key === "Universal" || key === move.statType || normalized === canonicalSpecialKind(move.specialType) || key === move.specialCategory;
  }

  // `move.specialCategory` is inconsistent in the live data: sometimes it's the special's own id
  // ("FlameBreathing"), sometimes the champion id for a champion-exclusive kit ("Akaza" for Compass),
  // sometimes a transformation's specialCategory ("GreatApe" for GreatApeTransform). SpecialModifiers
  // keys can be authored against any of these, so try every candidate instead of just one.
  function resolveSpecialModifier(boosts, move, build) {
    const mods = boosts && boosts.SpecialModifiers;
    if (!mods) return null;
    const transformation = build.transformation && data.transformations && data.transformations[build.transformation];
    const candidates = [move.specialCategory, build.special, build.transformation, transformation && transformation.specialCategory];
    for (const key of candidates) {
      if (key && mods[key]) return mods[key];
    }
    return null;
  }

  // TransformationBoosts entries are authored inconsistently too: some use a `transformationIds`
  // map, some a singular `transformationId` string (e.g. GreatApeTransform's entry).
  function transformationBoostMatches(entry, transformation, build) {
    if (!transformation) return false;
    if (entry.transformationIds && entry.transformationIds[build.transformation]) return true;
    if (entry.transformationId && entry.transformationId === build.transformation) return true;
    if (entry.allFullTransformations && transformation.type === "Full") return true;
    return false;
  }

  function applyFactor(multiplier, factor) {
    const value = number(factor, 1);
    if ((multiplier.mode || "multiplicative") === "additive") multiplier.additive += value - 1;
    else multiplier.value *= value;
  }

  function multiplierValue(multiplier) {
    return (multiplier.mode || "multiplicative") === "additive" ? Math.max(0, 1 + multiplier.additive) : multiplier.value;
  }

  function addDamageBoost(multiplier, boosts, move) {
    Object.entries(boosts || {}).forEach(([key, value]) => {
      if (boostMatches(key, move)) applyFactor(multiplier, 1 + number(value, 0));
    });
  }

  function applyTitleBoost(multiplier, title, move, mode, toggles) {
    const effects = title && title.effects || {};
    Object.entries(effects).forEach(([key, value]) => {
      if (bareDamageKeyMatches(key, move, mode, toggles)) applyFactor(multiplier, value);
    });
  }

  // Shared by title effects and the champion/accessory bare-key reader: `BossDamage` (boss mode
  // only), `Dimension${toggles.dimension}Damage` (the user-selected Dimension 1-6, since Dimension2
  // is a physical in-game location this calculator has no other way to detect — the default
  // "Always on" selection assumes any Dimension-specific bonus is active regardless of number),
  // `${statType}Damage`, and `${specialKind}Damage`.
  function bareDamageKeyMatches(key, move, mode, toggles) {
    if (key === "BossDamage") return mode === "boss";
    if (/^Dimension\dDamage$/.test(key)) return !toggles || !toggles.dimension || key === `Dimension${toggles.dimension}Damage`;
    if (key === `${move.statType}Damage`) return true;
    if (move.specialType && key === `${canonicalSpecialKind(move.specialType)}Damage`) return true;
    return false;
  }

  function applyTransformationBoost(multiplier, transformation, move) {
    (transformation && transformation.Perks && transformation.Perks.damageBoost || []).forEach((boost) => {
      if (boostMatches(boost.stat, move)) applyFactor(multiplier, boost.value);
    });
  }

  // Boosts families that follow the same {stat/specialType: fraction} or id-keyed shape as the
  // hand-written cases above, so one generic reader can apply all of them instead of one branch per champion.
  function applyGenericDamageBoosts(multiplier, boosts, move, mode, build, toggles) {
    if (!boosts) return;
    // Bare `${statType}Damage`/`${specialKind}Damage` keys at the Boosts root (e.g. Kanro's
    // `StandDamage`) follow the same shape titles use via applyTitleBoost; BossDamage/PvpDamage are
    // excluded since they're already applied explicitly by their own callers.
    Object.entries(boosts).forEach(([key, value]) => {
      if (typeof value !== "number" || key === "BossDamage" || key === "PvpDamage") return;
      if (bareDamageKeyMatches(key, move, mode, toggles)) applyFactor(multiplier, 1 + value);
    });
    const synergy = boosts.AccessorySynergy;
    if (synergy && typeof synergy.damageBoost === "number") {
      const equippedAccessories = Array.isArray(build.accessories) ? build.accessories : [build.accessory];
      if (equippedAccessories.includes(synergy.accessoryId) && (!synergy.damageType || boostMatches(synergy.damageType, move))) applyFactor(multiplier, 1 + synergy.damageBoost);
    }
    if (boosts.MobDamage && mode !== "duel") addDamageBoost(multiplier, boosts.MobDamage, move);
    if (boosts.DamageProc) {
      const proc = boosts.DamageProc;
      const matchesType = !proc.damageType || boostMatches(proc.damageType, move);
      const matchesSpecial = !proc.requiredSpecialId || proc.requiredSpecialId === build.special;
      // Expected-value approximation: chance x bonus, same convention already used for defensive procs.
      if (matchesType && matchesSpecial) applyFactor(multiplier, 1 + number(proc.chance, 0) * number(proc.damageBoost, 0));
    }
    const moveMod = boosts.MoveModifiers && boosts.MoveModifiers[move.id];
    if (moveMod && typeof moveMod.damageBoost === "number") applyFactor(multiplier, 1 + moveMod.damageBoost);
    const specialMod = resolveSpecialModifier(boosts, move, build);
    if (specialMod && typeof specialMod.damageBoost === "number") applyFactor(multiplier, 1 + specialMod.damageBoost);
    if (boosts.TransformationBoost && boosts.TransformationBoost.transformationId === build.transformation && boosts.TransformationBoost.damage) addDamageBoost(multiplier, boosts.TransformationBoost.damage, move);
    (Array.isArray(boosts.TransformationBoosts) ? boosts.TransformationBoosts : []).forEach((entry) => {
      const transformation = build.transformation && data.transformations && data.transformations[build.transformation];
      if (!transformationBoostMatches(entry, transformation, build)) return;
      // `existingDamageMultiplier` is an alias some entries use instead of `universalDamageMultiplier`
      // (e.g. SSJ4Goku's Saiyan-line entry) — same effect, just authored under a different name.
      const universal = toggles.daytime && typeof entry.nightUniversalDamageMultiplier === "number" ? entry.nightUniversalDamageMultiplier
        : typeof entry.universalDamageMultiplier === "number" ? entry.universalDamageMultiplier
        : entry.existingDamageMultiplier;
      if (typeof universal === "number") applyFactor(multiplier, universal);
      // Best case: assume max stacks already built up, consistent with every other stacking family.
      const stacking = entry.stacking || {};
      if (typeof stacking.damageBoostPerStack === "number") applyFactor(multiplier, 1 + number(stacking.maxStacks, 0) * stacking.damageBoostPerStack);
    });
    if (boosts.DaytimeBoost && toggles.daytime && boosts.DaytimeBoost.damageTypes && typeof boosts.DaytimeBoost.damageBoost === "number") {
      Object.keys(boosts.DaytimeBoost.damageTypes).forEach((key) => { if (boostMatches(key, move)) applyFactor(multiplier, 1 + boosts.DaytimeBoost.damageBoost); });
    }
    if (boosts.InCombatStacking && toggles.inCombat && typeof boosts.InCombatStacking.damageBoostPerStack === "number") applyFactor(multiplier, 1 + number(boosts.InCombatStacking.maxStacks, 0) * boosts.InCombatStacking.damageBoostPerStack);
    if (boosts.OutOfCombatStacking && toggles.outOfCombat && typeof boosts.OutOfCombatStacking.damageBoostPerStack === "number") applyFactor(multiplier, 1 + number(boosts.OutOfCombatStacking.maxStacks, 0) * boosts.OutOfCombatStacking.damageBoostPerStack);
    applyBestCaseCombatBoosts(multiplier, boosts, move, mode, build, toggles);
  }

  // Timed/in-combat buff families whose real uptime depends on attack sequencing or elapsed combat
  // time this calculator doesn't simulate (attack counters, combat-entry timers, stack ramps).
  // Per user direction: assume best case (buff always up / cycle condition always met / stacks
  // maxed) rather than leave them out entirely. Flagged via BEST_CASE_ASSUMPTION_FAMILIES so the
  // assumption is visible in passiveNotes(), not silent.
  function applyBestCaseCombatBoosts(multiplier, boosts, move, mode, build, toggles) {
    if (boosts.CombatDamageBoost && typeof boosts.CombatDamageBoost.boost === "number") applyFactor(multiplier, 1 + boosts.CombatDamageBoost.boost);
    if (boosts.CombatEntryBuff && boosts.CombatEntryBuff.damage) addDamageBoost(multiplier, boosts.CombatEntryBuff.damage, move);
    // Best case: assume the periodic Control-of-the-Beast-style window is active for its per-move bonuses.
    if (boosts.CombatBuff && boosts.CombatBuff.damageBoostByPower && (!boosts.CombatBuff.transformationId || boosts.CombatBuff.transformationId === build.transformation)) {
      const boost = boosts.CombatBuff.damageBoostByPower[move.id];
      if (typeof boost === "number") applyFactor(multiplier, 1 + boost);
    }
    // Do not apply first-attack damage boosts as a permanent always-on effect; they are conditional by combat timing and should only be counted when
    // the simulator explicitly models that state. Keeping them on globally produces fake permanent stacks like Shadow's 100% strength bonus.
    if (boosts.FirstAttackDamageBoost && false) {
      const first = boosts.FirstAttackDamageBoost;
      const dark = toggles.dungeon || !toggles.daytime;
      const boost = dark && typeof first.darkBoost === "number" ? first.darkBoost : number(first.boost, 0);
      applyFactor(multiplier, 1 + boost);
    }
    if (boosts.AttackCycleDamage && boostMatches(boosts.AttackCycleDamage.damageType || "Any", move) && typeof boosts.AttackCycleDamage.damageBoost === "number") applyFactor(multiplier, 1 + boosts.AttackCycleDamage.damageBoost);
    // Only the mob/boss damage sub-effect of AttackCycleStun is modeled — the stun + ignore-defense-reduction
    // half needs a target defense/stun-state model this calculator doesn't have (still in UNMODELED_DAMAGE_FAMILIES).
    if (boosts.AttackCycleStun && boosts.AttackCycleStun.penetration && mode !== "duel" && typeof boosts.AttackCycleStun.penetration.mobDamageBoost === "number") applyFactor(multiplier, 1 + boosts.AttackCycleStun.penetration.mobDamageBoost);
    if (boosts.StrengthToChakraDamageBuff && move.statType === "Chakra" && typeof boosts.StrengthToChakraDamageBuff.boost === "number") applyFactor(multiplier, 1 + boosts.StrengthToChakraDamageBuff.boost);
    if (boosts.BossDamageStackOnHit && mode === "boss") applyFactor(multiplier, 1 + number(boosts.BossDamageStackOnHit.maxStacks, 0) * number(boosts.BossDamageStackOnHit.boostPerStack, 0));
    if (boosts.CombatStatGainMultiplier) {
      Object.entries(boosts.CombatStatGainMultiplier).forEach(([key, config]) => {
        if (config && boostMatches(key, move)) applyFactor(multiplier, 1 + number(config.maxStacks, 0) * number(config.boostPerStack, 0));
      });
    }
    if (boosts.CriticalHit) {
      const crit = boosts.CriticalHit;
      const matchesType = !crit.damageTypes || Object.keys(crit.damageTypes).some((key) => boostMatches(key, move));
      const specialIds = crit.specialIds;
      const hasSpecialRestriction = specialIds && !Array.isArray(specialIds) && Object.keys(specialIds).length > 0;
      const matchesSpecial = !hasSpecialRestriction || (build.special && specialIds[build.special]);
      if (matchesType && matchesSpecial) {
        // Best case: assume the after-combatReadDuration chance ramp and any low-health crit-damage ramp are already maxed.
        const chance = Math.min(1, number(crit.chance, 0) + number(crit.combatChanceBonus, 0));
        const critMultiplier = number(crit.multiplier, 1) + number(crit.lowHealthMaxBonus, 0);
        // Expected-value approximation: chance x bonus, same convention already used for DamageProc.
        applyFactor(multiplier, 1 + chance * Math.max(0, critMultiplier - 1));
      }
    }
  }

  // Cooldown-side counterpart to applyGenericDamageBoosts: flat/keyed CDR, health-gated CDR (with
  // optional replacesBase override), and per-move/per-special cooldown multipliers.
  function cooldownScale(move, build, healthPercent) {
    const champion = build.champion && data.champions && data.champions[build.champion];
    const accessories = (Array.isArray(build.accessories) ? build.accessories : [build.accessory]).map((id) => id && data.accessories && data.accessories[id]).filter(Boolean);
    const fractions = [];
    let directMultiplier = 1;
    const addSource = (boosts) => {
      if (!boosts) return;
      const low = boosts.LowHealthCooldownReduction;
      const lowActive = low && healthPercent <= number(low.threshold, 0) && boostMatches(low.damageType || "Any", move);
      const base = boosts.CooldownReduction;
      const baseMap = typeof base === "number" ? { Any: base } : base;
      Object.entries(baseMap || {}).forEach(([key, value]) => {
        if (!boostMatches(key, move)) return;
        if (lowActive && low.replacesBase) return; // superseded by the health-gated rate below
        fractions.push(number(value, 0));
      });
      if (lowActive) fractions.push(number(low.reduction, 0));
      const berserker = boosts.LowHealthBerserker;
      if (berserker && berserker.cooldownReduction && healthPercent <= number(berserker.threshold, 0)) {
        Object.entries(berserker.cooldownReduction).forEach(([key, value]) => { if (boostMatches(key, move)) fractions.push(number(value, 0)); });
      }
      const missing = boosts.MissingHealthCooldownReduction;
      if (missing) {
        // Small epsilon guards against float division (e.g. 0.6/0.1 === 5.999...999) undercounting a step.
        const steps = Math.floor((1 - healthPercent) / Math.max(number(missing.stepFraction, 0.1), 0.001) + 1e-9);
        fractions.push(Math.min(number(missing.maxReduction, 0), Math.max(0, steps) * number(missing.reductionPerStep, 0)));
      }
      const specialMod = resolveSpecialModifier(boosts, move, build);
      if (specialMod && typeof specialMod.cooldownReduction === "number") fractions.push(specialMod.cooldownReduction);
      const moveMod = boosts.MoveModifiers && boosts.MoveModifiers[move.id];
      if (moveMod && typeof moveMod.cooldownMultiplier === "number") directMultiplier *= moveMod.cooldownMultiplier;
    };
    addSource(champion && champion.Boosts);
    accessories.forEach((accessory) => addSource(accessory.Boosts));
    const combined = Math.max(0.05, fractions.reduce((product, fraction) => product * (1 - fraction), 1));
    return combined * directMultiplier;
  }

  // Boosts families that show up in the live data but need state this calculator doesn't model
  // (party composition, attack-sequence counters, combat-entry timers, target-side debuffs, ...).
  // Flagged instead of silently ignored so a champion's numbers aren't mistaken for "fully applied".
  const UNMODELED_DAMAGE_FAMILIES = {
    AttackCycleStun: "the stun + ignore-defense-reduction half needs target defense/stun tracking, which isn't modeled (its mob/boss bonus-damage half is modeled, see best-case notes)",
    PartyDamageAura: "requires party composition, which isn't modeled",
    PartyBuffAura: "requires party composition, which isn't modeled",
    PartyLivingAura: "requires party composition, which isn't modeled",
    Hypnosis: "applies a debuff to the target rather than a buff to the attacker",
    BurnDamageMultiplier: "scales Burn/DoT ticks, which aren't tracked per boost source",
    BurnOnHit: "applies a DoT with target-side conditions",
    OnHitVulnerability: "applies a stacking debuff to the target",
  };

  // Families applied by applyBestCaseCombatBoosts() at an optimistic "always up / max stacks" value
  // rather than left out, because their real uptime depends on attack sequencing or elapsed combat
  // time this calculator doesn't simulate. Surfaced here so that optimism is visible, not silent.
  const BEST_CASE_ASSUMPTION_FAMILIES = {
    CombatDamageBoost: "assumes its timed on-combat-entry damage buff is always up",
    CombatEntryBuff: "assumes its timed on-combat-entry damage buff is always up",
    AttackCycleDamage: "assumes the every-Nth-attack condition is always met",
    AttackCycleStun: "assumes its mob/boss bonus-damage condition is always met",
    StrengthToChakraDamageBuff: "assumes the Strength-triggered Chakra buff is always active",
    BossDamageStackOnHit: "assumes max consecutive-hit stacks are already built up",
    CombatStatGainMultiplier: "assumes max in-combat stacks are already built up",
    CriticalHit: "assumes the in-combat crit-chance ramp and any low-health crit-damage ramp are already maxed",
    CombatBuff: "assumes its periodic transformed-state damage window is always active",
  };

  function collectUnmodeledNotes(name, boosts) {
    return Object.keys(boosts || {}).filter((key) => UNMODELED_DAMAGE_FAMILIES[key]).map((key) => `${name} has ${key} (${UNMODELED_DAMAGE_FAMILIES[key]}) \u2014 not reflected in the damage numbers.`);
  }

  function collectBestCaseNotes(name, boosts) {
    return Object.keys(boosts || {}).filter((key) => BEST_CASE_ASSUMPTION_FAMILIES[key]).map((key) => `${name} has ${key} (${BEST_CASE_ASSUMPTION_FAMILIES[key]}) \u2014 modeled at best case, actual numbers may be lower.`);
  }

  function passiveNotes(build) {
    const notes = [];
    const champion = build.champion && data.champions && data.champions[build.champion];
    if (champion) {
      notes.push(...collectUnmodeledNotes(champion.displayName || champion.id, champion.Boosts));
      notes.push(...collectBestCaseNotes(champion.displayName || champion.id, champion.Boosts));
    }
    const accessories = (Array.isArray(build.accessories) ? build.accessories : [build.accessory]).map((id) => id && data.accessories && data.accessories[id]).filter(Boolean);
    accessories.forEach((accessory) => {
      notes.push(...collectUnmodeledNotes(accessory.displayName || accessory.id, accessory.Boosts));
      notes.push(...collectBestCaseNotes(accessory.displayName || accessory.id, accessory.Boosts));
    });
    return notes;
  }

  function buildMultiplier(move, mode, options) {
    const build = options && options.build || {};
    const toggles = Object.assign({ inCombat: true, outOfCombat: false, daytime: false, dungeon: false, dimension: "" }, options && options.defense);
    const multiplier = { value: 1, additive: 0, mode: build.scalingMode || "multiplicative" };
    const champion = build.champion && data.champions && data.champions[build.champion];
    const trait = build.trait && data.traits && data.traits[build.trait];
    const title = build.title && data.titles && data.titles[build.title];
    const transformation = build.transformation && data.transformations && data.transformations[build.transformation];
    const healthPercent = Math.max(0, Math.min(100, number(build.healthPercent, 100))) / 100;
    addDamageBoost(multiplier, champion && champion.Boosts && champion.Boosts.Damage, move);
    if (champion && champion.Boosts && champion.Boosts.SpecialDamage && move.specialCategory) applyFactor(multiplier, 1 + number(champion.Boosts.SpecialDamage[move.specialCategory], 0));
    const lowHealth = champion && champion.Boosts && champion.Boosts.LowHealthDamageBoost;
    if (lowHealth && healthPercent <= number(lowHealth.threshold, 0) && (!lowHealth.damageTypes || lowHealth.damageTypes[move.statType] || lowHealth.damageTypes[canonicalSpecialKind(move.specialType)])) applyFactor(multiplier, 1 + number(lowHealth.boost, 0));
    const berserker = champion && champion.Boosts && champion.Boosts.LowHealthBerserker;
    if (berserker && healthPercent <= number(berserker.threshold, 0) && (!berserker.damageTypes || berserker.damageTypes[move.statType] || berserker.damageTypes[canonicalSpecialKind(move.specialType)])) applyFactor(multiplier, 1 + number(berserker.damageBoost, 0));
    applyGenericDamageBoosts(multiplier, champion && champion.Boosts, move, mode, build, toggles);
    (trait && trait.tiers && trait.tiers[Number(build.traitTier || 0)] && trait.tiers[Number(build.traitTier || 0)].effects || []).forEach((effect) => {
      if (effect.category === "DamageBoost") applyFactor(multiplier, 1 + number(effect.modifier, 0));
    });
    applyTitleBoost(multiplier, title, move, mode, toggles);
    const accessories = Array.isArray(build.accessories) ? build.accessories : [build.accessory];
    accessories.forEach((id) => {
      const accessory = id && data.accessories && data.accessories[id];
      const boosts = accessory && accessory.Boosts || {};
      addDamageBoost(multiplier, boosts.Damage, move);
      if (boosts.SpecialDamage && move.specialCategory) applyFactor(multiplier, 1 + number(boosts.SpecialDamage[move.specialCategory], 0));
      if (mode === "boss") applyFactor(multiplier, 1 + number(boosts.BossDamage, 0));
      if (mode === "duel") applyFactor(multiplier, 1 + number(boosts.PvpDamage, 0));
      applyGenericDamageBoosts(multiplier, boosts, move, mode, build, toggles);
    });
    applyTransformationBoost(multiplier, transformation, move);
    return multiplierValue(multiplier);
  }

  function statusResults(move, mode, statValue, statLimit, options) {
    const statuses = move.runtime && Array.isArray(move.runtime.statuses) ? move.runtime.statuses : [];
    return statuses.filter((status) => status.dot).map((status) => {
      const dot = status.dot;
      const target = status.target || "both";
      const playerTarget = mode === "duel";
      const applies = target === "both" || (playerTarget ? target === "players" : target === "mobs");
      let totalDamage = 0;
      const basis = dot.basis || "boss";
      const targetMaxHealth = Math.max(1, number(options && options.build && options.build.maxHealth, 1000));
      if (basis === "power") totalDamage = number(statValue, 0) * number(statLimit, 100) / 100 * number(move.damageMultiplier, 1) * number(dot.totalMultiplier, 0);
      else if (basis === "flat") totalDamage = number(dot.totalMultiplier, 0) * (targetMaxHealth / 1000);
      else if (basis === "percentMaxHealth") totalDamage = number(dot.totalMultiplier, 0) * targetMaxHealth;
      else if (basis === "fixed") totalDamage = number(dot.totalMultiplier, 0);
      else totalDamage = number(move.bossDamage, 0) * number(dot.totalMultiplier, 0);
      const ticks = number(dot.ticks, 1);
      const burstDamage = number(status.burstDamage, number(status.data && status.data.burstDamage, number(status.burst && status.burst.damage, 0)));
      totalDamage *= buildMultiplier(move, mode, options);
      const duration = number(status.duration, 0);
      const tickDamage = ticks > 0 ? totalDamage / ticks : totalDamage;
      const total = totalDamage;
      return { status, effect: status.effect, applies, ticks, tickDamage, duration, interval: ticks > 0 && duration > 0 ? duration / ticks : null, perSecond: duration > 0 ? total / duration : null, total, burstDamage };
    });
  }

  function severityFor(move, profile) {
    if (typeof move.severityOverride === "number" && Number.isFinite(move.severityOverride)) {
      return { tier: Math.max(0, Math.min(10, Math.trunc(move.severityOverride))), score: null, manual: true };
    }
    const maxDimension = Math.max(0, ...damagingHits(move).flatMap((hit) => hit.hitbox && Array.isArray(hit.hitbox.size) ? hit.hitbox.size.map((value) => number(value, 0)) : [0]));
    const burst = number(profile.burst, 0);
    const burstPoints = burst >= 75 ? 5 : burst >= 45 ? 4 : burst >= 30 ? 3 : burst >= 20 ? 2 : burst >= 10 ? 1 : 0;
    const hitboxPoints = maxDimension >= 200 ? 2 : maxDimension >= 100 ? 1 : 0;
    const duration = number(move.runtime && move.runtime.durationSeconds, 0);
    const durationPoints = duration <= 1 ? 2 : duration <= 2 ? 1 : 0;
    const endlag = number(move.runtime && move.runtime.activationTillEndlagEnd, 0);
    const endlagPoints = endlag <= 0 ? 2 : endlag <= 0.5 ? 1 : endlag <= 1 ? 0 : -1;
    const score = Math.max(0, burstPoints + hitboxPoints + durationPoints + endlagPoints);
    return { tier: Math.max(0, Math.min(9, Math.floor(score * 0.85))), score };
  }

  function calculateProfile(move, mode, options) {
    const statValue = number(options.statValue, 1000000);
    const statLimit = number(options.statLimit, 100);
    const hits = damagingHits(move);
    const multiplier = buildMultiplier(move, mode, options);
    const perHitValues = hits.map((hit) => ({ hit, perHit: baseDamage(move, mode, statValue, statLimit) * number(hit.damage.multiplier, 1) * multiplier }));
    const direct = perHitValues.reduce((sum, item) => sum + item.perHit * number(item.hit.count, 0), 0);
    const totalHits = hits.reduce((sum, hit) => sum + number(hit.count, 0), 0);
    const statuses = statusResults(move, mode, statValue, statLimit, options);
    const appliedStatuses = statuses.filter((item) => item.applies);
    const statusDamage = appliedStatuses.reduce((sum, item) => sum + item.total + item.burstDamage, 0);
    const runtime = move.runtime || {};
    const startup = number(runtime.activationTillFirstHitbox, 0);
    const duration = number(runtime.durationSeconds, 0);
    const cooldownStart = number(runtime.activationTillCooldownStart, number(runtime.activationTillEndlagEnd, 0));
    const build = options && options.build || {};
    const healthPercent = Math.max(0, Math.min(100, number(build.healthPercent, 100))) / 100;
    const cooldown = number(move.baseCooldown, 0) * cooldownScale(move, build, healthPercent);
    const cycle = cooldownStart + cooldown;
    const flags = dotFlags(options);
    const dotDamage = statusDamage;
    const total = direct + (flags.total ? dotDamage : 0);
    const burstWindow = startup + duration;
    const activeDps = duration > 0 ? (direct + (flags.dps ? dotDamage : 0)) / duration : null;
    const burst = burstWindow > 0 ? (direct + (flags.burst ? dotDamage : 0)) / burstWindow : null;
    const rotationalDps = cycle > 0 ? (direct + (flags.dps ? dotDamage : 0)) / cycle : null;
    const dps = rotationalDps;
    const dotSeconds = appliedStatuses.reduce((max, item) => Math.max(max, item.duration), 0);
    const profile = { mode, hits: perHitValues, totalHits, direct, statuses, appliedStatuses, statusDamage, dotDamage, dotSeconds, dotPerSecond: dotSeconds > 0 ? dotDamage / dotSeconds : null, dotFlags: flags, total, activeDps, dps, burst, rotationalDps, startup, duration, burstWindow, cooldownStart, cooldown, cycle };
    profile.severity = severityFor(move, profile);
    return profile;
  }

  function calculate(move, options) {
    return {
      boss: calculateProfile(move, "boss", options),
      pve: calculateProfile(move, "mob", options),
      player: calculateProfile(move, "duel", options),
    };
  }

  // Champions and gear store boosts as fractions (0.6 = +60%); titles and transformations
  // store them as multipliers (1.2 = +20%). Anything >= 1 is read as the multiplier form.
  function boostFraction(value) {
    const raw = number(value, 0);
    return raw >= 1 ? raw - 1 : raw;
  }

  function reductionFraction(value) {
    const raw = number(value, 0);
    return raw >= 1 ? 1 - 1 / raw : raw;
  }

  function defenseSources(build, mode, toggles) {
    const health = [];
    const reduction = [];
    const healing = [];
    const notes = [];
    const hp = Math.max(0, Math.min(100, number(build.healthPercent, 100))) / 100;
    const missing = 1 - hp;
    const duel = mode === "duel";
    const champion = build.champion && data.champions && data.champions[build.champion];
    const trait = build.trait && data.traits && data.traits[build.trait];
    const title = build.title && data.titles && data.titles[build.title];
    const transformation = build.transformation && data.transformations && data.transformations[build.transformation];
    const accessories = (Array.isArray(build.accessories) ? build.accessories : [build.accessory]).map((id) => id && data.accessories && data.accessories[id]).filter(Boolean);
    const addHealth = (label, value) => { const fraction = boostFraction(value); if (fraction > 0) health.push({ label, fraction }); };
    const addReduction = (label, value, sustainedOnly) => { const fraction = reductionFraction(value); if (fraction > 0) reduction.push({ label, fraction, sustainedOnly: !!sustainedOnly }); };
    const addHeal = (label, rate) => { if (Number.isFinite(rate) && rate > 0) healing.push({ label, rate }); };
    const uptime = (duration, cooldown) => cooldown > 0 ? Math.min(1, number(duration, 0) / cooldown) : 1;

    if (champion) {
      const name = champion.displayName || champion.id;
      const boosts = champion.Boosts || {};
      addHealth(`${name} · Health`, boosts.HealthBoost);
      if (boosts.Defense) addReduction(`${name} · Defense`, Math.max(...Object.values(boosts.Defense).map((value) => number(value, 0)), 0));
      if (boosts.SpecialBoost && boosts.SpecialBoost.specialId === build.special) {
        addHealth(`${name} · ${boosts.SpecialBoost.specialId} health`, boosts.SpecialBoost.HealthBoost);
        addReduction(`${name} · ${boosts.SpecialBoost.specialId} defense`, boosts.SpecialBoost.Defense);
      }
      if (boosts.LowHealthDefense && hp <= number(boosts.LowHealthDefense.threshold, 0)) addReduction(`${name} · Low-health defense`, boosts.LowHealthDefense.reduction);
      if (boosts.AttackerMissingHealthDefense) {
        const config = boosts.AttackerMissingHealthDefense;
        const steps = Math.floor(missing / Math.max(number(config.stepFraction, 0.1), 0.001) + 1e-9);
        addReduction(`${name} · Missing-health defense`, Math.min(number(config.maxReduction, 0), steps * number(config.reductionPerStep, 0)));
      }
      if (boosts.DungeonDefense && toggles.dungeon) addReduction(`${name} · Dungeon defense`, boosts.DungeonDefense);
      if (boosts.DamageReductionProc) addReduction(`${name} · Reduction proc (expected)`, number(boosts.DamageReductionProc.chance, 0) * number(boosts.DamageReductionProc.reduction, 0), true);
      if (boosts.ChakraMeltdown) addReduction(`${name} · Chakra meltdown`, number(boosts.ChakraMeltdown.damageReduction, 0) * uptime(boosts.ChakraMeltdown.duration, boosts.ChakraMeltdown.cooldown), true);
      if (boosts.PartyLivingAura) addReduction(`${name} · Living aura`, boosts.PartyLivingAura.baseDamageReduction);
      if (boosts.LowHealthInvulnerability && hp <= number(boosts.LowHealthInvulnerability.threshold, 0)) addReduction(`${name} · Invulnerability uptime`, uptime(boosts.LowHealthInvulnerability.duration, boosts.LowHealthInvulnerability.cooldown), true);
      if (boosts.OutOfCombatStacking && toggles.outOfCombat) {
        const stacks = number(boosts.OutOfCombatStacking.maxStacks, 0);
        addReduction(`${name} · Out-of-combat stacks`, stacks * number(boosts.OutOfCombatStacking.damageReductionPerStack, 0));
        addHealth(`${name} · Out-of-combat stacks`, stacks * number(boosts.OutOfCombatStacking.healthBoostPerStack, 0));
      }
      if (boosts.InCombatStacking && toggles.inCombat) addHealth(`${name} · In-combat stacks`, number(boosts.InCombatStacking.maxStacks, 0) * number(boosts.InCombatStacking.healthBoostPerStack, 0));
      if (boosts.DaytimeBoost && toggles.daytime) addHealth(`${name} · Daytime`, boosts.DaytimeBoost.healthBoost);
      if (boosts.TransformationHealthBoosts && build.transformation) addHealth(`${name} · Transformation health`, boosts.TransformationHealthBoosts[build.transformation]);
      if (boosts.TransformationBoost && boosts.TransformationBoost.transformationId === build.transformation) {
        addHealth(`${name} · ${build.transformation} health`, boosts.TransformationBoost.healthBoost);
        addReduction(`${name} · ${build.transformation} defense`, boosts.TransformationBoost.damageReduction);
      }
      (Array.isArray(boosts.TransformationBoosts) ? boosts.TransformationBoosts : []).forEach((entry) => {
        if (!transformationBoostMatches(entry, transformation, build)) return;
        addReduction(`${name} · Transformation defense`, entry.damageReduction);
        const healthMultiplierValue = toggles.daytime && typeof entry.nightHealthMultiplier === "number" ? entry.nightHealthMultiplier : entry.healthMultiplier;
        if (typeof healthMultiplierValue === "number") addHealth(`${name} · Transformation health`, healthMultiplierValue);
        const stacking = entry.stacking || {};
        addReduction(`${name} · Transformation stacks`, number(stacking.maxStacks, 0) * number(stacking.damageReductionPerStack, 0), true);
        addHealth(`${name} · Transformation stacks`, number(stacking.maxStacks, 0) * number(stacking.healthBoostPerStack, 0));
      });
      if (typeof boosts.PassiveHeal === "number") addHeal(`${name} · Passive heal`, number(boosts.PassiveHeal, 0) / ASSUMED_HEAL_INTERVAL);
      if (boosts.TimedHeal && (!boosts.TimedHeal.requiredSpecialId || boosts.TimedHeal.requiredSpecialId === build.special)) addHeal(`${name} · Timed heal`, number(boosts.TimedHeal.healFraction, 0) / Math.max(number(boosts.TimedHeal.interval, 1), 0.001));
      if (boosts.LowHealthHealOverTime && hp <= number(boosts.LowHealthHealOverTime.threshold, 0)) addHeal(`${name} · Low-health regen`, number(boosts.LowHealthHealOverTime.healFraction, 0) / Math.max(number(boosts.LowHealthHealOverTime.interval, 1), 0.001));
      if (boosts.PartyLowHealthRegeneration && hp <= number(boosts.PartyLowHealthRegeneration.threshold, 0)) addHeal(`${name} · Party regen`, number(boosts.PartyLowHealthRegeneration.healFraction, 0) / Math.max(number(boosts.PartyLowHealthRegeneration.interval, 1), 0.001) * uptime(boosts.PartyLowHealthRegeneration.duration, boosts.PartyLowHealthRegeneration.cooldown));
      if (boosts.PartyLowHealthHeal && hp <= number(boosts.PartyLowHealthHeal.threshold, 0)) addHeal(`${name} · Party heal`, number(boosts.PartyLowHealthHeal.healFraction, 0) / Math.max(number(boosts.PartyLowHealthHeal.cooldown, 1), 0.001));
      if (boosts.PartyLowHealthBurst && hp <= number(boosts.PartyLowHealthBurst.threshold, 0)) {
        addHeal(`${name} · Low-health burst heal`, number(boosts.PartyLowHealthBurst.healFraction, 0) / Math.max(number(boosts.PartyLowHealthBurst.cooldown, 1), 0.001));
        addReduction(`${name} · Low-health burst defense`, number(boosts.PartyLowHealthBurst.damageReduction, 0) * uptime(boosts.PartyLowHealthBurst.duration, boosts.PartyLowHealthBurst.cooldown), true);
      }
      if (boosts.LowHealthRecovery && hp <= number(boosts.LowHealthRecovery.threshold, 0)) {
        addHeal(`${name} · Low-health recovery`, Math.max(0, number(boosts.LowHealthRecovery.healToRatio, 0) - hp) / Math.max(number(boosts.LowHealthRecovery.cooldown, 1), 0.001));
        addReduction(`${name} · Low-health recovery defense`, number(boosts.LowHealthRecovery.damageReduction, 0) * uptime(boosts.LowHealthRecovery.duration, boosts.LowHealthRecovery.cooldown), true);
      }
      if (boosts.LowHealthRampage && hp <= number(boosts.LowHealthRampage.threshold, 0)) addHeal(`${name} · Rampage heal`, number(boosts.LowHealthRampage.healFraction, 0) / Math.max(number(boosts.LowHealthRampage.cooldown, 1), 0.001));
      if (boosts.LowHealthFullHealChance && hp <= number(boosts.LowHealthFullHealChance.threshold, 0)) addHeal(`${name} · Full-heal chance`, number(boosts.LowHealthFullHealChance.chance, 0) * missing / Math.max(number(boosts.LowHealthFullHealChance.cooldown, 1), 0.001));
      if (boosts.CombatBuff && boosts.CombatBuff.healFraction) addHeal(`${name} · Combat heal`, number(boosts.CombatBuff.healFraction, 0) / Math.max(number(boosts.CombatBuff.healInterval, 1), 0.001) * uptime(boosts.CombatBuff.duration, boosts.CombatBuff.cooldown));
      if (typeof boosts.OnKillHeal === "number") notes.push(`${name} heals ${Math.round(number(boosts.OnKillHeal, 0) * 100)}% of max health on kill (not scored).`);
      if (boosts.BurnDamageReduction) notes.push(`${name} reduces burn damage taken by ${Math.round(number(boosts.BurnDamageReduction, 0) * 100)}% (not scored).`);
      if (boosts.LowHealthEvasion || boosts.LowHealthInstinctDodgeBonus) notes.push(`${name} gains dodge/evasion at low health (not scored).`);
    }

    (trait && trait.tiers && trait.tiers[Number(build.traitTier || 0)] && trait.tiers[Number(build.traitTier || 0)].effects || []).forEach((effect) => {
      const label = `${trait.name || trait.id} tier`;
      if (effect.category === "DamageReduction") addReduction(label, effect.modifier);
      if (effect.category === "HealthBoost") addHealth(label, effect.modifier);
    });

    if (title) {
      const effects = title.effects || {};
      addHealth(`${title.displayName || title.id} · Health`, effects.HealthBoost);
      addReduction(`${title.displayName || title.id} · Damage reduction`, effects.DamageReduction);
    }

    accessories.forEach((accessory) => {
      const name = accessory.displayName || accessory.id;
      const boosts = accessory.Boosts || {};
      addHealth(`${name} · Health`, boosts.HealthBoost);
      if (duel) addHealth(`${name} · PvP health`, boosts.PvpHealthBoost);
      if (boosts.Defense) addReduction(`${name} · Defense`, Math.max(...Object.values(boosts.Defense).map((value) => number(value, 0)), 0));
      if (boosts.SpecialBoost && boosts.SpecialBoost.specialId === build.special) {
        addHealth(`${name} · ${boosts.SpecialBoost.specialId} health`, boosts.SpecialBoost.HealthBoost);
        addReduction(`${name} · ${boosts.SpecialBoost.specialId} defense`, boosts.SpecialBoost.Defense);
      }
      if (duel && boosts.PvpLowHealthDefense && hp <= number(boosts.PvpLowHealthDefense.threshold, 0)) addReduction(`${name} · PvP low-health defense`, boosts.PvpLowHealthDefense.reduction);
      if (boosts.TransformationBoost && boosts.TransformationBoost.transformationId === build.transformation) {
        addHealth(`${name} · ${build.transformation} health`, boosts.TransformationBoost.healthBoost);
        addReduction(`${name} · ${build.transformation} defense`, boosts.TransformationBoost.damageReduction);
      }
    });

    if (transformation) {
      const perks = transformation.Perks || {};
      addHealth(`${transformation.displayName || transformation.id} · Health`, perks.healthBoost);
      addReduction(`${transformation.displayName || transformation.id} · Damage reduction`, perks.damageReduction);
    }

    return { health, reduction, healing, notes };
  }

  function defenseProfile(options) {
    const build = options && options.build || {};
    const mode = options && options.mode || "boss";
    const toggles = Object.assign({ inCombat: true, outOfCombat: false, daytime: false, dungeon: false, stacking: "multiplicative", window: SUSTAIN_WINDOW }, options && options.defense || {});
    const sources = defenseSources(build, mode, toggles);
    const additive = (build.scalingMode || "multiplicative") === "additive";
    const healthMultiplier = additive
      ? Math.max(0, 1 + sources.health.reduce((sum, item) => sum + item.fraction, 0))
      : sources.health.reduce((product, item) => product * (1 + item.fraction), 1);
    const baseHealth = number(build.maxHealth, number(constants.baselineMaxHealth, 1000));
    const maxHealth = baseHealth * healthMultiplier;
    // The live data never states how reductions combine, so this is a selectable assumption.
    const combine = (list) => toggles.stacking === "additive"
      ? Math.max(0.01, 1 - list.reduce((sum, item) => sum + item.fraction, 0))
      : Math.max(0.01, list.reduce((product, item) => product * (1 - item.fraction), 1));
    const burstTaken = combine(sources.reduction.filter((item) => !item.sustainedOnly));
    const sustainedTaken = combine(sources.reduction);
    const healPerSecond = sources.healing.reduce((sum, item) => sum + item.rate, 0) * maxHealth;
    const window = Math.max(number(toggles.window, SUSTAIN_WINDOW), 0.1);
    return {
      sources,
      toggles,
      baseHealth,
      healthMultiplier,
      maxHealth,
      burstTaken,
      sustainedTaken,
      burstReduction: 1 - burstTaken,
      sustainedReduction: 1 - sustainedTaken,
      healPerSecond,
      window,
      effectiveHealth: maxHealth / burstTaken,
      sustainedHealth: maxHealth / sustainedTaken,
      sustainableDps: (maxHealth / window + healPerSecond) / sustainedTaken,
      // Incoming DPS below this is out-healed indefinitely; above it, survival is a countdown on raw health.
      healBreakeven: healPerSecond / sustainedTaken,
    };
  }

  function catalog() {
    const entries = [];
    const seen = new Set();
    Object.values(allSpecials()).forEach((special) => {
      abilitiesForSpecial(special).forEach((ability) => {
        if (!allPowers()[ability.powerId]) return;
        const key = special.kind === "Stand" ? `${ability.powerId}@${special.id}` : ability.powerId;
        if (seen.has(key)) return;
        seen.add(key);
        seen.add(ability.powerId);
        entries.push({ key, powerId: ability.powerId, standId: special.kind === "Stand" ? special.id : null, specialId: special.id, group: "Specials", folder: special.kind || "Other", source: special.displayName || special.id, keybind: ability.key || "" });
      });
    });
    Object.values(allPowers()).forEach((power) => {
      if (seen.has(power.id) || power.isDisabled || power.category === "Enemy" || /^Debug/.test(power.id) || power.specialType === "Stands") return;
      seen.add(power.id);
      const source = power.specialCategory && allSpecials()[power.specialCategory] ? (allSpecials()[power.specialCategory].displayName || power.specialCategory) : power.specialCategory || "Other";
      entries.push({ key: power.id, powerId: power.id, standId: null, specialId: null, group: power.isSpecial ? "Specials" : "Powers", folder: power.isSpecial ? canonicalSpecialKind(power.specialType) : power.statType || "Other", source: power.isSpecial ? source : null, keybind: "" });
    });
    return entries;
  }

  window.MatrixEngine = { data, customData, constants, allPowers, allSpecials, catalog, moveConfig, calculate, damagingHits, severityFor, buildMultiplier, cooldownScale, defenseProfile, canonicalSpecialKind, passiveNotes };
})();