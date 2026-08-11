import { describe, expect, it } from "vitest";
import type { CustomAiPlayer } from "./custom-ai-players.js";
import type { VisualNovel } from "@gal-yiba/shared";
import { CyberArenaRegistry } from "./cyber-arena.js";

function visualNovel(id: string): VisualNovel {
  return {
    id,
    title: id,
    aliases: [],
    developer: ["会社"],
    publisher: null,
    scenarioWriter: null,
    heroineHairColor: null,
    releaseYear: 2020,
    playtime: "medium",
    vndbRating: 8,
    bangumiRating: 8,
    vndbVoteCount: 100,
    bangumiVoteCount: 100,
    animeAdaptation: "none",
    ageRating: "all_ages",
    isOtome: false,
    platforms: ["windows"],
    languages: ["ja"],
    tags: ["恋爱"],
    provenance: {},
  };
}

function profile(id: string): CustomAiPlayer {
  return {
    id,
    bangumiUsername: id,
    handle: `@${id}`,
    nickname: id,
    avatarUrl: `https://example.test/${id}.jpg`,
    profileUrl: `https://bgm.tv/user/${id}`,
    difficulty: "hard",
    strategy: "entropy",
    targetDatabaseSize: 100,
    databaseSize: 2,
    collectionCounts: { high: 2, limited: 0, total: 2 },
    knowledgeCounts: { high: 2, limited: 0, basic: 0, random: 0 },
    collectionSubjectIds: {},
    knowledgeByVisualNovelId: {},
    createdAt: "2026-08-11T00:00:00Z",
    updatedAt: "2026-08-11T00:00:00Z",
  };
}

describe("CyberArenaRegistry", () => {
  it("runs two custom AIs on one hidden answer and exposes every guess", () => {
    const catalog = [
      visualNovel("10000000-0000-4000-8000-000000000001"),
      visualNovel("10000000-0000-4000-8000-000000000002"),
    ];
    const arena = new CyberArenaRegistry();
    const created = arena.create(
      profile("left"),
      profile("right"),
      catalog,
      "novice",
      { now: new Date("2026-08-11T00:00:00Z"), random: () => 0 },
    );
    expect(created.answer).toBeNull();
    expect(created.players).toHaveLength(2);

    const updated = arena.submitGuess(
      created.id,
      created.players[0]!.playerId,
      catalog[1]!.id,
      catalog,
      new Date("2026-08-11T00:00:05Z"),
    );
    expect(updated.status).toBe("active");
    expect(updated.players[0]!.game.guesses[0]?.title).toBe(catalog[1]!.title);

    const finished = arena.submitGuess(
      created.id,
      created.players[1]!.playerId,
      catalog[0]!.id,
      catalog,
      new Date("2026-08-11T00:00:06Z"),
    );
    expect(finished.status).toBe("finished");
    expect(finished.winnerPlayerId).toBe(finished.players[1]!.playerId);
    expect(finished.answer?.title).toBe(catalog[0]!.title);
  });

  it("rejects a player fighting their own clone", () => {
    expect(() =>
      new CyberArenaRegistry().create(
        profile("same"),
        profile("same"),
        [visualNovel("10000000-0000-4000-8000-000000000001")],
        "novice",
      ),
    ).toThrow("CYBER_PLAYERS_MUST_DIFFER");
  });
});
