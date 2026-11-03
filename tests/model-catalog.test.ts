import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { clampThinkingLevel, getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import {
  catalogDefaultsFor, catalogProviders, catalogRolePins, catalogSlots,
  clampChatLevel, clampModelsLevels, modelCatalog, rolePinsFor, toModelDto,
  validateChatSettings, validateModelsSettings,
} from "../src/server/model-catalog.ts";
import { piEngineForSpec, piModels } from "../src/agent/models.ts";
import { BACKGROUND_MODEL_ROLES, DEFAULT_THINKING_ORDER } from "../src/core/settings.ts";
import { resolveSettings } from "../src/core/settings-resolution.ts";
import { fixedOfficeModelSpec } from "../src/server/office-config.ts";

const spec = fixedOfficeModelSpec();
const pin = { model: spec };
const raw = piModels().getModel(spec.provider, spec.id)!;

describe("fixed office model catalog", () => {
  it("projects only the server-owned model with its actual limits and defaults", () => {
    const { models, defaults, providers, slots } = modelCatalog();
    assert.equal(models.length, 1);
    assert.deepEqual(models[0], toModelDto(raw));
    assert.deepEqual(defaults, pin);
    assert.deepEqual(providers, [{ id: "office", keyPresent: true }]);
    assert.deepEqual(slots, { strong: pin, cheap: pin, vision: pin });
  });

  it("projects the fixed model's DTO fields without a second registry", () => {
    const dto = toModelDto(raw);
    assert.equal(dto.id, raw.id);
    assert.equal(dto.provider, "office");
    assert.equal(dto.contextWindow, raw.contextWindow);
    assert.deepEqual(dto.supportedLevels, getSupportedThinkingLevels(raw));
    assert.deepEqual(dto.input, raw.input);
    assert.deepEqual(dto.cost, raw.cost);
  });

  it("keeps the pure default and role-pin projections exact", () => {
    assert.equal(catalogDefaultsFor(null), null);
    assert.deepEqual(catalogDefaultsFor(spec), pin);
    const empty = rolePinsFor(resolveSettings(null).agent.models);
    for (const role of BACKGROUND_MODEL_ROLES) assert.equal(empty[role], null);
    const live = catalogRolePins();
    for (const role of BACKGROUND_MODEL_ROLES) assert.deepEqual(live[role], pin);
  });

  it("projects the same fixed model for all slots and one available provider", () => {
    assert.deepEqual(catalogSlots(), { strong: pin, cheap: pin, vision: pin });
    assert.deepEqual(catalogProviders(), [{ id: "office", keyPresent: true }]);
  });

  it("validates model coordinates against the office-only catalog", () => {
    assert.deepEqual(validateModelsSettings({ strong: pin }), { ok: true });
    assert.equal(validateModelsSettings({ cheap: { model: { provider: "openrouter", id: spec.id } } }).ok, false);
    assert.equal(validateModelsSettings({ cheap: { model: { provider: "office", id: "other" } } }).ok, false);
    assert.deepEqual(validateChatSettings({ model: spec }), { ok: true });
    assert.equal(validateChatSettings({ model: { provider: "openrouter", id: spec.id } }).ok, false);
    assert.deepEqual(validateChatSettings({}), { ok: true });
  });

  it("clamps slot and chat thinking levels to the fixed model's supported levels", () => {
    const expected = clampThinkingLevel(raw, "xhigh");
    assert.deepEqual(validateModelsSettings({ strong: { model: spec, thinkingLevel: "xhigh" } }), { ok: true });
    assert.equal(clampModelsLevels({ strong: { model: spec, thinkingLevel: "xhigh" } }).strong?.thinkingLevel, expected);
    assert.deepEqual(validateChatSettings({ model: spec, thinkingLevel: "xhigh" }), { ok: true });
    assert.equal(clampChatLevel({ thinkingLevel: "xhigh" }, spec).thinkingLevel, expected);
    assert.deepEqual(clampChatLevel({ thinkingLevel: "minimal" }, null), { thinkingLevel: "minimal" });
  });

  it("the fixed engine uses the office endpoint and rejects unknown model IDs", () => {
    const engine = piEngineForSpec(spec);
    assert.equal(engine.model.api, "openai-completions");
    assert.equal(engine.model.provider, "office");
    assert.equal(engine.model.id, spec.id);
    assert.equal(engine.level, getSupportedThinkingLevels(raw)[0]);
    assert.throws(() => piEngineForSpec({ provider: "office", id: "other" }), /catalog has no model/);
    assert.deepEqual([...DEFAULT_THINKING_ORDER], ["medium", "low", "high", "minimal", "xhigh", "max"]);
  });
});
