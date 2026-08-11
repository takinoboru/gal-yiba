import {
  compareGuess,
  type AiOpponentKind,
  type ComparisonKey,
  type GuessRecord,
  type PublicGameSession,
  type VisualNovel,
} from "@gal-yiba/shared";

export interface AiOpponentDefinition {
  kind: AiOpponentKind;
  nickname: string;
  badge: string;
  specialty: string;
  tagline: string;
  description: string;
  openingMessage: string;
  developerAliases: readonly string[];
}

export const aiOpponentDefinitions = [
  {
    kind: "key-fan",
    nickname: "键种",
    badge: "KEY",
    specialty: "Key",
    tagline: "Key 的记忆，一部也不会漏。",
    description:
      "完整记得 Key 作品；面对其他会社，只了解年份、会社和年龄分级等少量信息。",
    openingMessage:
      "Key 作品我全都记得。其他作品只知道年份、会社和年龄分级，而且会随机猜。",
    developerAliases: ["key"],
  },
  {
    kind: "yuzu-fan",
    nickname: "柚子厨",
    badge: "YUZU",
    specialty: "Yuzusoft",
    tagline: "柚子社谱系，倒背如流。",
    description:
      "完整记得 Yuzusoft（ゆずソフト）作品；面对其他会社，只保留少量基础信息。",
    openingMessage:
      "柚子社作品我都熟。其他会社只记得年份、会社和年龄分级，剩下靠随机猜。",
    developerAliases: ["yuzusoft", "ゆずソフト"],
  },
] as const satisfies readonly AiOpponentDefinition[];

export const aiOpponentKinds = aiOpponentDefinitions.map(
  (definition) => definition.kind,
) as [AiOpponentKind, ...AiOpponentKind[]];

const definitionByKind = new Map(
  aiOpponentDefinitions.map((definition) => [definition.kind, definition]),
);

export function getAiOpponentDefinition(
  kind: AiOpponentKind,
): AiOpponentDefinition {
  const definition = definitionByKind.get(kind);
  if (!definition) throw new Error("AI_OPPONENT_NOT_FOUND");
  return definition;
}

function normalizedDeveloperTokens(value: string): string[] {
  return (
    value
      .normalize("NFKC")
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

export function isAiSpecialtyVisualNovel(
  visualNovel: VisualNovel,
  kind: AiOpponentKind,
): boolean {
  const aliases = getAiOpponentDefinition(kind).developerAliases.map((alias) =>
    normalizedDeveloperTokens(alias).join(""),
  );
  return (visualNovel.developer ?? []).some((developer) => {
    const tokens = normalizedDeveloperTokens(developer);
    const combined = tokens.join("");
    return aliases.some(
      (alias) => tokens.includes(alias) || combined === alias,
    );
  });
}

/** 擅长会社保留完整资料，其他作品只保留标题、会社、年份和年龄分级。 */
export function maskAiKnowledge(
  visualNovel: VisualNovel,
  kind: AiOpponentKind,
): VisualNovel {
  if (isAiSpecialtyVisualNovel(visualNovel, kind))
    return structuredClone(visualNovel);
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

export interface AiDecision {
  visualNovelId: string;
  title: string;
  reason: "specialty-memory" | "limited-memory";
}

export function chooseAiGuess(
  catalog: VisualNovel[],
  game: PublicGameSession,
  kind: AiOpponentKind,
  random: () => number = Math.random,
): AiDecision | null {
  const catalogById = new Map(catalog.map((entry) => [entry.id, entry]));
  const knownCatalog = catalog.map((entry) => maskAiKnowledge(entry, kind));
  const used = new Set(game.guesses.map((guess) => guess.visualNovelId));
  let remaining = knownCatalog.filter((entry) => !used.has(entry.id));

  for (const guess of game.guesses) {
    const fullGuess = catalogById.get(guess.visualNovelId);
    if (!fullGuess) continue;
    const knownGuess = maskAiKnowledge(fullGuess, kind);
    const filtered = remaining.filter((candidate) =>
      feedbackMatches(knownGuess, candidate, guess, game.rules.comparisonKeys),
    );
    if (filtered.length > 0) remaining = filtered;
  }

  if (remaining.length === 0) return null;
  const specialtyWorks = remaining.filter((entry) =>
    isAiSpecialtyVisualNovel(entry, kind),
  );
  const useSpecialtyMemory = specialtyWorks.length > 0 && random() < 0.78;
  const selected = randomItem(
    useSpecialtyMemory ? specialtyWorks : remaining,
    random,
  );
  if (!selected) return null;
  return {
    visualNovelId: selected.id,
    title: selected.title,
    reason: isAiSpecialtyVisualNovel(selected, kind)
      ? "specialty-memory"
      : "limited-memory",
  };
}

export function aiThinkTime(
  completedGuessCount: number,
  random: () => number = Math.random,
): number {
  if (completedGuessCount === 0) return 5_000;
  return 20_000 + Math.floor(Math.max(0, random()) * 10_000);
}
