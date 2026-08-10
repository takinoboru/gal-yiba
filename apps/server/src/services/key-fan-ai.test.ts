import { describe, expect, it } from "vitest";
import type { PublicGameSession, VisualNovel } from "@gal-yiba/shared";
import {
  chooseKeyFanGuess,
  isKeyVisualNovel,
  keyFanThinkTime,
  maskKeyFanKnowledge,
} from "./key-fan-ai.js";
import { defaultRules } from "../rooms.js";

function visualNovel(
  id: string,
  developer: string[],
  overrides: Partial<VisualNovel> = {},
): VisualNovel {
  return {
    id,
    title: `作品 ${id}`,
    aliases: [`别名 ${id}`],
    developer,
    publisher: ["发行商"],
    scenarioWriter: ["脚本家"],
    heroineHairColor: ["brown"],
    releaseYear: 2020,
    playtime: "medium",
    vndbRating: 8,
    bangumiRating: 7.8,
    vndbVoteCount: 500,
    bangumiVoteCount: 1200,
    animeAdaptation: "none",
    ageRating: "all_ages",
    isOtome: false,
    platforms: ["windows"],
    languages: ["ja"],
    tags: ["泣きゲー"],
    tagDetails: null,
    seriesIds: ["series-1"],
    developerFamilyIds: ["developer-1"],
    provenance: {},
    ...overrides,
  };
}

function game(): PublicGameSession {
  return {
    id: "game-1",
    status: "active",
    guesses: [],
    rules: {
      ...structuredClone(defaultRules),
      mode: "duel",
      comparisonKeys: ["developer", "releaseYear", "ageRating"],
    },
    startedAt: "2026-08-11T00:00:00.000Z",
    deadlineAt: "2026-08-11T00:05:00.000Z",
    finishedAt: null,
    attemptsLeft: 10,
  };
}

describe("Key fan AI", () => {
  it("keeps complete Key knowledge and masks most non-Key metadata", () => {
    const keyWork = visualNovel("key", ["VisualArts / Key"]);
    const otherWork = visualNovel("other", ["OTHER BRAND"]);

    expect(isKeyVisualNovel(keyWork)).toBe(true);
    expect(maskKeyFanKnowledge(keyWork)).toEqual(keyWork);

    const masked = maskKeyFanKnowledge(otherWork);
    expect(masked.developer).toEqual(["OTHER BRAND"]);
    expect(masked.releaseYear).toBe(2020);
    expect(masked.ageRating).toBe("all_ages");
    expect(masked.publisher).toBeNull();
    expect(masked.scenarioWriter).toBeNull();
    expect(masked.vndbRating).toBeNull();
    expect(masked.tags).toBeNull();
  });

  it("prefers remembered Key works but still selects through injected randomness", () => {
    const catalog = [
      visualNovel("other", ["OTHER BRAND"]),
      visualNovel("key", ["Key"]),
    ];
    const values = [0.1, 0.9];
    const decision = chooseKeyFanGuess(
      catalog,
      game(),
      () => values.shift() ?? 0,
    );

    expect(decision).toEqual({
      visualNovelId: "key",
      title: "作品 key",
      reason: "key-memory",
    });
  });

  it("uses a bounded randomized think time", () => {
    expect(keyFanThinkTime(() => 0)).toBe(900);
    expect(keyFanThinkTime(() => 0.999)).toBe(2598);
  });
});
