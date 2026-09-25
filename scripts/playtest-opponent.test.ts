/**
 * The opponent-interaction PROMPT generator (opponent/generate.ts, presets.ts)
 * and how its results are recorded. Requirements from the guide's M5 exit test:
 * the same seed/settings/turn gives the same prompt; undo/redo/reload does not
 * re-roll; the player can ignore or resolve a prompt manually; "no interaction"
 * is a valid result; and nothing ever targets or moves a card.
 *
 * Run with: npx tsx --test scripts/playtest-opponent.test.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { generateInteraction, mixSeed } from "../src/lib/playtest/opponent/generate";
import { applyPreset, defaultSettingsFor, LEVEL_WEIGHT, PRESETS, PROMPT_TEXT } from "../src/lib/playtest/opponent/presets";
import { applyCommand } from "../src/lib/playtest/board/reduce";
import { emptyHistory, record, redo, undo } from "../src/lib/playtest/board/history";
import { fixtureSixtyCardStart } from "../src/lib/playtest/board/fixtures";
import { defaultSimulatorSettings, INTERACTION_CATEGORIES, type SimulatorSettings } from "../src/lib/playtest/board/types";
import { validateSnapshot } from "../src/lib/playtest/board/serialize";

const on = (over: Partial<SimulatorSettings> = {}): SimulatorSettings => ({ ...defaultSettingsFor("balanced"), enabled: true, firstTurn: 1, maxPerTurn: 3, ...over });

test("the same seed, settings, turn and reroll always give the same prompt", () => {
  for (let turn = 1; turn <= 30; turn++) {
    assert.deepEqual(generateInteraction(on(), 1234, turn, 0), generateInteraction(on(), 1234, turn, 0));
  }
});

test("different seeds, turns and rerolls decorrelate (not one fixed answer)", () => {
  const seen = new Set<string>();
  for (let turn = 1; turn <= 60; turn++) seen.add(JSON.stringify(generateInteraction(on(), 99, turn, 0)));
  assert.ok(seen.size > 5, "sixty turns produce a variety of outcomes");
  const rerolls = new Set<string>();
  for (let i = 0; i < 40; i++) rerolls.add(JSON.stringify(generateInteraction(on({ maxPerTurn: 1 }), 99, 5, i)));
  assert.ok(rerolls.size > 2, "rerolls differ");
  assert.notEqual(mixSeed(1, 2, 3), mixSeed(1, 3, 2));
});

test("nothing is generated before the first interaction turn or when disabled", () => {
  const settings = on({ firstTurn: 4 });
  assert.deepEqual(generateInteraction(settings, 5, 3, 0).prompts, []);
  assert.ok(generateInteraction({ ...settings, chances: { ...settings.chances }, nothing: "off" }, 5, 4, 0).prompts.length >= 1);
  assert.deepEqual(generateInteraction({ ...settings, enabled: false }, 5, 9, 0), { prompts: [], mill: 0 });
});

test("per-turn maximum is respected, a category is used at most once a turn, and 'no interaction' occurs", () => {
  let sawEmpty = false;
  for (const max of [1, 2, 3]) {
    for (let turn = 1; turn <= 200; turn++) {
      const { prompts } = generateInteraction(on({ maxPerTurn: max }), 7, turn, 0);
      assert.ok(prompts.length <= max);
      assert.equal(new Set(prompts).size, prompts.length);
      if (prompts.length === 0) sawEmpty = true;
    }
  }
  assert.ok(sawEmpty, "with a nonzero 'nothing' chance some turns are quiet");
});

test("a category set to off is never produced; 'nothing' off means something always happens", () => {
  const settings = on({ nothing: "off", maxPerTurn: 1, chances: { counterspell: "off", spotRemoval: "off", massRemoval: "off", attack: "high", stax: "off", discard: "off" } });
  for (let turn = 1; turn <= 100; turn++) assert.deepEqual(generateInteraction(settings, 3, turn, 0).prompts, ["attack"]);
  const allOff = on({ chances: { counterspell: "off", spotRemoval: "off", massRemoval: "off", attack: "off", stax: "off", discard: "off" } });
  for (let turn = 1; turn <= 50; turn++) assert.deepEqual(generateInteraction(allOff, 3, turn, 0).prompts, []);
});

test("weights follow the chance levels: a high category is chosen far more often than a low one", () => {
  const settings = on({ maxPerTurn: 1, nothing: "off", chances: { counterspell: "high", spotRemoval: "low", massRemoval: "off", attack: "off", stax: "off", discard: "off" } });
  let high = 0;
  let low = 0;
  for (let turn = 1; turn <= 700; turn++) {
    const [p] = generateInteraction(settings, 11, turn, 0).prompts;
    if (p === "counterspell") high++;
    if (p === "spotRemoval") low++;
  }
  assert.ok(high > low * 3, `high=${high} low=${low}`);
  assert.equal(LEVEL_WEIGHT.off, 0);
});

test("mill mode only produces a mill count when on, and game changers do not break generation", () => {
  assert.equal(generateInteraction(on({ millOpponent: false }), 1, 5, 0).mill, 0);
  assert.ok(Array.from({ length: 50 }, (_, t) => generateInteraction(on({ millOpponent: true }), 1, t + 1, 0).mill).some((m) => m > 0));
  assert.ok(generateInteraction(on({ gameChangers: true }), 1, 5, 0).prompts.every((p) => (INTERACTION_CATEGORIES as readonly string[]).includes(p)));
});

test("every preset is a complete valid settings object with a description", () => {
  for (const preset of PRESETS) {
    const applied = applyPreset(defaultSimulatorSettings(), preset.id);
    assert.equal(applied.preset, preset.id);
    for (const c of INTERACTION_CATEGORIES) assert.ok(applied.chances[c] in LEVEL_WEIGHT);
    assert.ok(preset.description.length > 5);
  }
  assert.equal(applyPreset(defaultSimulatorSettings(), "no-such-preset").preset, "balanced");
  for (const c of INTERACTION_CATEGORIES) assert.ok(PROMPT_TEXT[c].length > 10);
});

test("recorded prompts survive undo/redo unchanged and a reload never re-rolls", () => {
  const start = applyCommand(fixtureSixtyCardStart(), { type: "SET_SIMULATOR", settings: on() });
  const generated = generateInteraction(start.simulator.settings, start.simulator.seed, 3, 0);
  let history = record(emptyHistory(), start);
  const recorded = applyCommand(start, { type: "RECORD_INTERACTION", turn: 3, rerollIndex: 0, prompts: generated.prompts, resolution: "pending" });
  assert.deepEqual(recorded.simulator.results[0].prompts, generated.prompts);

  const back = undo(history, recorded)!;
  assert.equal(back.state.simulator.results.length, 0);
  history = back.history;
  const forward = redo(history, back.state)!;
  assert.deepEqual(forward.state.simulator.results, recorded.simulator.results, "redo restores the exact recorded prompt");

  // "Reload": the snapshot round trips, and regenerating from its own seed and
  // settings yields the very prompt that was recorded.
  const reloaded = validateSnapshot(JSON.parse(JSON.stringify(recorded)));
  assert.deepEqual(reloaded.simulator.results, recorded.simulator.results);
  assert.deepEqual(generateInteraction(reloaded.simulator.settings, reloaded.simulator.seed, 3, 0).prompts, generated.prompts);
});

test("ignore, resolve manually and reroll are recorded against the same turn, with the reason", () => {
  let state = applyCommand(fixtureSixtyCardStart(), { type: "SET_SIMULATOR", settings: on() });
  state = applyCommand(state, { type: "RECORD_INTERACTION", turn: 4, rerollIndex: 0, prompts: ["attack"], resolution: "pending" });
  state = applyCommand(state, { type: "RECORD_INTERACTION", turn: 4, rerollIndex: 0, prompts: ["attack"], resolution: "rerolled", reason: "No opposing creatures" });
  state = applyCommand(state, { type: "RECORD_INTERACTION", turn: 4, rerollIndex: 1, prompts: ["discard"], resolution: "pending" });
  state = applyCommand(state, { type: "RECORD_INTERACTION", turn: 4, rerollIndex: 1, prompts: ["discard"], resolution: "resolved" });
  assert.equal(state.simulator.results.length, 2, "an update replaces, it does not duplicate");
  assert.equal(state.simulator.results[0].resolution, "rerolled");
  assert.equal(state.simulator.results[0].reason, "No opposing creatures");
  assert.equal(state.simulator.results[1].resolution, "resolved");
  const ignored = applyCommand(state, { type: "RECORD_INTERACTION", turn: 5, rerollIndex: 0, prompts: [], resolution: "ignored" });
  assert.deepEqual(ignored.simulator.results.at(-1)?.prompts, [], "'no interaction' is a valid recorded result");
});

test("a prompt never moves or targets a card: recording one changes nothing but the simulator and the log", () => {
  const start = fixtureSixtyCardStart();
  const next = applyCommand(start, { type: "RECORD_INTERACTION", turn: 3, rerollIndex: 0, prompts: ["massRemoval", "spotRemoval"], resolution: "pending" });
  assert.deepEqual(next.zones, start.zones);
  assert.deepEqual(next.cards, start.cards);
  assert.deepEqual(next.trackers, start.trackers);
  assert.equal(next.events.at(-1)?.private, true, "prompts stay out of any shared log");
});

test("bad input to RECORD_INTERACTION and SET_SIMULATOR is sanitised or refused", () => {
  const start = fixtureSixtyCardStart();
  assert.equal(applyCommand(start, { type: "RECORD_INTERACTION", turn: 1, rerollIndex: 0, prompts: [], resolution: "bogus" as never }), start);
  const clamped = applyCommand(start, { type: "SET_SIMULATOR", settings: { ...defaultSimulatorSettings(), maxPerTurn: 99, firstTurn: -5, chances: { ...defaultSimulatorSettings().chances, attack: "extreme" as never } } });
  assert.equal(clamped.simulator.settings.maxPerTurn, 3);
  assert.equal(clamped.simulator.settings.firstTurn, 1);
  assert.equal(clamped.simulator.settings.chances.attack, "off");
  assert.equal(applyCommand(start, { type: "SET_SIMULATOR", settings: start.simulator.settings }), start, "unchanged settings are a no-op");
});
