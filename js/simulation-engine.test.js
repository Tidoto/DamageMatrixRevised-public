"use strict";

const assert = require("node:assert/strict");
const optimizer = require("./simulation-engine.js");

const shared = optimizer.applyFitnessSharing([
  { fitness: 100, genome: "a" },
  { fitness: 100, genome: "a" },
  { fitness: 90, genome: "b" },
], (left, right) => left.genome === right.genome ? 0 : 1, 0.35, 1);

assert.equal(shared[0].nicheCount, 2);
assert.equal(shared[0].sharedFitness, 50);
assert.equal(shared[2].nicheCount, 1);
assert.equal(shared[2].sharedFitness, 90);

let randomState = 123456789;
const random = () => {
  randomState = (1664525 * randomState + 1013904223) >>> 0;
  return randomState / 0x100000000;
};

const results = optimizer.optimize({
  random,
  populationSize: 12,
  generations: 8,
  resultLimit: 2,
  nicheRadius: 0.35,
  seeds: [{ niche: "a", value: 10 }, { niche: "b", value: 9 }],
  create: (rng) => ({ niche: rng() < 0.5 ? "a" : "b", value: Math.floor(rng() * 11) }),
  repair: (genome) => ({ niche: genome.niche, value: Math.max(0, Math.min(10, genome.value)) }),
  valid: (genome) => ["a", "b"].includes(genome.niche),
  crossover: (left, right, rng) => ({ niche: rng() < 0.5 ? left.niche : right.niche, value: Math.max(left.value, right.value) }),
  mutate: (genome, rng) => ({ niche: rng() < 0.1 ? (genome.niche === "a" ? "b" : "a") : genome.niche, value: genome.value + (rng() < 0.5 ? -1 : 1) }),
  keyOf: (genome) => `${genome.niche}|${genome.value}`,
  evaluate: (genome) => ({ fitness: genome.value + (genome.niche === "a" ? 100 : 90), niche: genome.niche }),
  distance: (left, right) => left.niche === right.niche ? 0 : 1,
});

assert.deepEqual(new Set(results.map((result) => result.niche)), new Set(["a", "b"]));
console.log("simulation-engine tests passed");