import {
  compareGuess,
  type ComparisonKey,
  type GuessRecord,
  type PublicGameSession,
  type VisualNovel,
} from "@gal-yiba/shared";

export const keyFanAiKind = "key-fan" as const;
export const keyFanAiNickname = "Key 孝子 AI";

export interface KeyFanDecision {
  visualNovelId: string;
  title: string;
  reason: "key-memory" | "limited-memory";
}

function normalizedDeveloperTokens(value: string): string[] {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function isKeyVisualNovel(visualNovel: VisualNovel): boolean {
  return (visualNovel.developer ?? []).some((developer) =>
    normalizedDeveloperTokens(developer).includes("key"),
  );
}

/**
 * Key 作品保留全部记忆；其他作品只记得标题、会社、年份和年龄分级。
 * 这是 AI 的知识视图，不会修改服务端真实题库。
 */
export function maskKeyFanKnowledge(visualNovel: VisualNovel): VisualNovel {
  if (isKeyVisualNovel(visualNovel)) return structuredClone(visualNovel);
  return {
    ...structuredClone(visualNovel),
    aliases: [],
    publisher: null,
    scenarioWriter: null,
    heroineHairColor: null,
    playtime: null,
    vndbRating: null,
    bangumiRating: null,
    vndbVoteCount: null,
    bangumiVoteCount: null,
    animeAdaptation: null,
    platforms: null,
    languages: null,
    tags: null,
    tagDetails: null,
    seriesIds: null,
    developerFamilyIds: null,
    provenance: {},
  };
}

function normalize(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}

function feedbackMatches(
  knownGuess: VisualNovel,
  possibleAnswer: VisualNovel,
  actualGuess: GuessRecord,
  keys: ComparisonKey[],
): boolean {
  const predicted = compareGuess(knownGuess, possibleAnswer, keys);
  return predicted.every((result, index) => {
    const actual = actualGuess.comparison[index];
    if (!actual || actual.status === "unknown" || result.status === "unknown")
      return true;
    if (result.status !== actual.status) return false;
    if (actual.direction && result.direction !== actual.direction) return false;
    if (actual.hint && result.hint !== actual.hint) return false;
    if (actual.overlap?.length) {
      const predictedOverlap = new Set(
        (result.overlap ?? []).map((value) => normalize(value)),
      );
      return actual.overlap.every((value) =>
        predictedOverlap.has(normalize(value)),
      );
    }
    return true;
  });
}

function randomItem<T>(items: T[], random: () => number): T | null {
  if (items.length === 0) return null;
  const index = Math.min(
    items.length - 1,
    Math.floor(Math.max(0, random()) * items.length),
  );
  return items[index] ?? null;
}

export function chooseKeyFanGuess(
  catalog: VisualNovel[],
  game: PublicGameSession,
  random: () => number = Math.random,
): KeyFanDecision | null {
  const catalogById = new Map(catalog.map((entry) => [entry.id, entry]));
  const knownCatalog = catalog.map(maskKeyFanKnowledge);
  const used = new Set(game.guesses.map((guess) => guess.visualNovelId));
  let remaining = knownCatalog.filter((entry) => !used.has(entry.id));

  for (const guess of game.guesses) {
    const fullGuess = catalogById.get(guess.visualNovelId);
    if (!fullGuess) continue;
    const knownGuess = maskKeyFanKnowledge(fullGuess);
    const filtered = remaining.filter((candidate) =>
      feedbackMatches(knownGuess, candidate, guess, game.rules.comparisonKeys),
    );
    if (filtered.length > 0) remaining = filtered;
  }

  if (remaining.length === 0) return null;
  const rememberedKeyWorks = remaining.filter(isKeyVisualNovel);
  const useKeyMemory = rememberedKeyWorks.length > 0 && random() < 0.78;
  const selected = randomItem(
    useKeyMemory ? rememberedKeyWorks : remaining,
    random,
  );
  if (!selected) return null;
  return {
    visualNovelId: selected.id,
    title: selected.title,
    reason: isKeyVisualNovel(selected) ? "key-memory" : "limited-memory",
  };
}

export function keyFanThinkTime(random: () => number = Math.random): number {
  return 900 + Math.floor(Math.max(0, random()) * 1_700);
}
