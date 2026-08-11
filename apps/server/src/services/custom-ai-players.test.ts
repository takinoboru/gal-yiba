import { describe, expect, it, vi } from "vitest";
import { BangumiClient } from "@gal-yiba/data";
import type { PublicGameSession, VisualNovel } from "@gal-yiba/shared";
import { defaultRules } from "../rooms.js";
import {
  CustomAiPlayerStore,
  chooseCustomAiGuess,
  customAiThinkTime,
  maskCustomAiKnowledge,
} from "./custom-ai-players.js";

function visualNovel(index: number): VisualNovel {
  return {
    id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    title: `作品 ${index}`,
    aliases: [`别名 ${index}`],
    developer: [`会社 ${index % 4}`],
    publisher: ["发行商"],
    scenarioWriter: ["脚本家"],
    heroineHairColor: ["brown"],
    releaseYear: 2000 + (index % 20),
    playtime: "medium",
    vndbRating: 7 + (index % 10) / 10,
    bangumiRating: 7,
    vndbVoteCount: index * 10,
    bangumiVoteCount: index * 20,
    animeAdaptation: "none",
    ageRating: index % 2 === 0 ? "all_ages" : "restricted",
    isOtome: false,
    platforms: ["windows"],
    languages: ["ja"],
    tags: ["恋爱"],
    provenance: {},
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function publicGame(): PublicGameSession {
  return {
    id: "game",
    status: "active",
    rules: {
      ...structuredClone(defaultRules),
      mode: "duel",
      maxGuesses: 12,
      comparisonKeys: ["developer", "releaseYear", "ageRating"],
    },
    guesses: [],
    startedAt: "2026-08-11T00:00:00.000Z",
    deadlineAt: "2026-08-11T00:10:00.000Z",
    finishedAt: null,
    attemptsLeft: 12,
  };
}

describe("custom Bangumi AI players", () => {
  it("builds the next 100-title memory tier from public collections", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          id: 9,
          username: "tester",
          nickname: "测试厨",
          avatar: {
            large: "https://lain.bgm.tv/tester.jpg",
            medium: "",
            small: "",
          },
          sign: "",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          total: 3,
          limit: 50,
          offset: 0,
          data: [
            {
              subject_id: 1,
              subject_type: 4,
              type: 2,
              rate: 9,
              tags: [],
              updated_at: "2026-01-01T00:00:00Z",
              private: false,
              subject: { id: 1, name: "作品 1", name_cn: "" },
            },
            {
              subject_id: 2,
              subject_type: 4,
              type: 3,
              rate: 8,
              tags: [],
              updated_at: "2026-01-01T00:00:00Z",
              private: false,
              subject: { id: 2, name: "作品 2", name_cn: "" },
            },
            {
              subject_id: 3,
              subject_type: 4,
              type: 5,
              rate: 0,
              tags: [],
              updated_at: "2026-01-01T00:00:00Z",
              private: false,
              subject: { id: 3, name: "作品 3", name_cn: "" },
            },
          ],
        }),
      );
    const catalog = Array.from({ length: 120 }, (_, index) =>
      visualNovel(index + 1),
    );
    const store = new CustomAiPlayerStore(null);
    const profile = await store.importBangumiUser(
      "@tester",
      "medium",
      "entropy",
      catalog,
      new BangumiClient({ userAgent: "GalYiBa/test", fetcher }),
      new Date("2026-08-11T00:00:00Z"),
    );

    expect(profile).toMatchObject({
      id: "bangumi:tester",
      nickname: "测试厨",
      targetDatabaseSize: 100,
      databaseSize: 100,
      collectionCounts: { high: 2, limited: 1, total: 3 },
    });
    expect(profile.knowledgeCounts).toEqual({
      high: 2,
      limited: 1,
      basic: 97,
      random: 20,
    });
    const stored = await store.get(profile.id);
    expect(stored?.knowledgeByVisualNovelId[catalog[0]!.id]).toBe("high");
    expect(stored?.knowledgeByVisualNovelId[catalog[2]!.id]).toBe("limited");
  });

  it("keeps full memory for completed works and masks expanded works", async () => {
    const store = new CustomAiPlayerStore(null);
    const catalog = [visualNovel(1), visualNovel(2)];
    const profile = {
      id: "bangumi:test",
      bangumiUsername: "test",
      handle: "@test",
      nickname: "Test",
      avatarUrl: "https://example.test/avatar.jpg",
      profileUrl: "https://bgm.tv/user/test",
      difficulty: "hard" as const,
      strategy: "hybrid" as const,
      targetDatabaseSize: 100 as const,
      databaseSize: 2,
      collectionCounts: { high: 1, limited: 0, total: 1 },
      knowledgeCounts: { high: 1, limited: 0, basic: 1, random: 0 },
      collectionSubjectIds: { "1": 2 as const },
      knowledgeByVisualNovelId: {
        [catalog[0]!.id]: "high" as const,
        [catalog[1]!.id]: "basic" as const,
      },
      createdAt: "2026-08-11T00:00:00Z",
      updatedAt: "2026-08-11T00:00:00Z",
    };
    expect(maskCustomAiKnowledge(catalog[0]!, profile).scenarioWriter).toEqual([
      "脚本家",
    ]);
    expect(
      maskCustomAiKnowledge(catalog[1]!, profile).scenarioWriter,
    ).toBeNull();
    expect(
      chooseCustomAiGuess(catalog, publicGame(), profile, () => 0),
    ).toMatchObject({
      reason: "minimum-entropy",
    });
    expect(await store.list()).toEqual([]);
  });

  it("uses five seconds first, then difficulty-specific human pacing", () => {
    expect(customAiThinkTime("easy", 0, () => 0.5)).toBe(5_000);
    expect(customAiThinkTime("easy", 1, () => 0.5)).toBe(30_000);
    expect(customAiThinkTime("medium", 1, () => 0.5)).toBe(25_000);
    expect(customAiThinkTime("hard", 1, () => 0)).toBe(15_000);
  });
});
