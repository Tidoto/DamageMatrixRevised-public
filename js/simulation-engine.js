(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.NichingGeneticOptimizer = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";

  function randomItem(items, random) {
    return items[Math.floor(random() * items.length)];
  }

  function tournament(population, size, random) {
    let winner = randomItem(population, random);
    for (let index = 1; index < size; index += 1) {
      const challenger = randomItem(population, random);
      if (challenger.sharedFitness > winner.sharedFitness) winner = challenger;
    }
    return winner.genome;
  }

  function applyFitnessSharing(evaluated, distance, radius, alpha) {
    return evaluated.map((candidate, index) => {
      const nicheCount = evaluated.reduce((sum, other, otherIndex) => {
        if (index === otherIndex) return sum + 1;
        const separation = Math.max(0, distance(candidate, other));
        if (separation >= radius) return sum;
        return sum + 1 - Math.pow(separation / radius, alpha);
      }, 0);
      return Object.assign({}, candidate, {
        nicheCount,
        sharedFitness: candidate.fitness / Math.max(1, nicheCount),
      });
    });
  }

  function uniqueGenomes(genomes, keyOf) {
    const unique = new Map();
    genomes.forEach((genome) => unique.set(keyOf(genome), genome));
    return [...unique.values()];
  }

  function selectNiches(candidates, limit, distance, radius) {
    const ranked = candidates.slice().sort((left, right) => right.fitness - left.fitness);
    const selected = [];
    ranked.forEach((candidate) => {
      if (selected.length < limit && selected.every((other) => distance(candidate, other) >= radius)) selected.push(candidate);
    });
    ranked.forEach((candidate) => {
      if (selected.length < limit && !selected.includes(candidate)) selected.push(candidate);
    });
    return selected;
  }

  function optimize(options) {
    const random = options.random || Math.random;
    const populationSize = Math.max(4, options.populationSize || 64);
    const generations = Math.max(1, options.generations || 40);
    const eliteCount = Math.max(1, Math.min(populationSize - 1, options.eliteCount || Math.ceil(populationSize * 0.1)));
    const tournamentSize = Math.max(2, options.tournamentSize || 4);
    const nicheRadius = Math.max(Number.EPSILON, options.nicheRadius || 0.35);
    const sharingAlpha = Math.max(Number.EPSILON, options.sharingAlpha || 1);
    const resultLimit = Math.max(1, options.resultLimit || 10);
    const keyOf = options.keyOf || JSON.stringify;
    const repair = options.repair || ((genome) => genome);
    const valid = options.valid || (() => true);
    const hallOfFame = new Map();

    const evaluate = (genome) => {
      const repaired = repair(genome);
      if (!valid(repaired)) return null;
      const result = options.evaluate(repaired);
      if (!result || !Number.isFinite(result.fitness) || result.fitness < 0) return null;
      const canonicalGenome = repair(result.genome || repaired);
      if (!valid(canonicalGenome)) return null;
      return Object.assign({}, result, { genome: canonicalGenome, fitness: result.fitness });
    };

    let population = uniqueGenomes((options.seeds || []).map((seed) => repair(seed)), keyOf).filter(valid);
    let attempts = 0;
    while (population.length < populationSize && attempts < populationSize * 50) {
      const genome = repair(options.create(random));
      if (valid(genome) && !population.some((existing) => keyOf(existing) === keyOf(genome))) population.push(genome);
      attempts += 1;
    }
    while (population.length < populationSize) population.push(repair(options.create(random)));

    for (let generation = 0; generation < generations; generation += 1) {
      const evaluated = population.map(evaluate).filter(Boolean);
      if (!evaluated.length) break;
      evaluated.forEach((candidate) => {
        const key = keyOf(candidate.genome);
        if (!hallOfFame.has(key) || candidate.fitness > hallOfFame.get(key).fitness) hallOfFame.set(key, candidate);
      });

      const shared = applyFitnessSharing(evaluated, options.distance, nicheRadius, sharingAlpha)
        .sort((left, right) => right.sharedFitness - left.sharedFitness || right.fitness - left.fitness);
      const next = shared.slice(0, eliteCount).map((candidate) => candidate.genome);
      attempts = 0;
      while (next.length < populationSize && attempts < populationSize * 50) {
        const parentA = tournament(shared, tournamentSize, random);
        const parentB = tournament(shared, tournamentSize, random);
        const child = repair(options.mutate(options.crossover(parentA, parentB, random), random, generation / generations));
        if (valid(child)) next.push(child);
        attempts += 1;
      }
      while (next.length < populationSize) next.push(repair(options.create(random)));
      population = next;
    }

    population.map(evaluate).filter(Boolean).forEach((candidate) => {
      const key = keyOf(candidate.genome);
      if (!hallOfFame.has(key) || candidate.fitness > hallOfFame.get(key).fitness) hallOfFame.set(key, candidate);
    });
    return selectNiches([...hallOfFame.values()], resultLimit, options.distance, nicheRadius);
  }

  return { applyFitnessSharing, optimize, selectNiches };
});