import { describe, expect, it } from "vitest";
import type {
  AiOpponentKind,
  PublicGameSession,
  VisualNovel,
} from "@gal-yiba/shared";
import {
  aiThinkTime,
  chooseAiGuess,
  getAiOpponentDefinition,
  isAiSpecialtyVisualNovel,
  maskAiKnowledge,
} from "./ai-opponents.js";
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
    tags: ["恋爱"],
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

describe("AI opponent registry", () => {
  it.each([
    ["key-fan", "VisualArts / Key", "键种"],
    ["yuzu-fan", "ゆずソフト", "柚子厨"],
  ] as const)("recognizes %s specialty works", (kind, developer, nickname) => {
    expect(getAiOpponentDefinition(kind).nickname).toBe(nickname);
    expect(isAiSpecialtyVisualNovel(visualNovel(kind, [developer]), kind)).toBe(
      true,
    );
  });

  it("masks non-specialty metadata for every AI", () => {
    for (const kind of ["key-fan", "yuzu-fan"] as AiOpponentKind[]) {
      const masked = maskAiKnowledge(
        visualNovel("other", ["OTHER BRAND"]),
        kind,
      );
      expect(masked.developer).toEqual(["OTHER BRAND"]);
      expect(masked.releaseYear).toBe(2020);
      expect(masked.ageRating).toBe("all_ages");
      expect(masked.publisher).toBeNull();
      expect(masked.scenarioWriter).toBeNull();
      expect(masked.vndbRating).toBeNull();
      expect(masked.tags).toBeNull();
    }
  });

  it.each([
    ["key-fan", "Key"],
    ["yuzu-fan", "YUZUSOFT"],
  ] as const)("prefers the remembered work for %s", (kind, developer) => {
    const catalog = [
      visualNovel("other", ["OTHER BRAND"]),
      visualNovel("specialty", [developer]),
    ];
    const values = [0.1, 0.9];
    expect(
      chooseAiGuess(catalog, game(), kind, () => values.shift() ?? 0),
    ).toEqual({
      visualNovelId: "specialty",
      title: "作品 specialty",
      reason: "specialty-memory",
    });
  });

  it("uses human-readable turn delays", () => {
    expect(aiThinkTime(0, () => 0.999)).toBe(5_000);
    expect(aiThinkTime(1, () => 0)).toBe(20_000);
    expect(aiThinkTime(7, () => 0.999)).toBe(29_990);
  });
});
