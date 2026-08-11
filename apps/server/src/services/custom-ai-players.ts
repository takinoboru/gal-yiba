import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  BangumiClient,
  normalizeTitle,
  type BangumiCollectionType,
  type BangumiUserGameCollection,
} from "@gal-yiba/data";
import {
  compareGuess,
  filterAnswerPool,
  type AiDifficulty,
  type AiStrategy,
  type ComparisonKey,
  type GuessRecord,
  type PublicGameSession,
  type VisualNovel,
} from "@gal-yiba/shared";

export type CustomAiKnowledgeLevel = "high" | "limited" | "basic";

export interface CustomAiPlayer {
  id: string;
  bangumiUsername: string;
  handle: string;
  nickname: string;
  avatarUrl: string;
  profileUrl: string;
  difficulty: AiDifficulty;
  strategy: AiStrategy;
  targetDatabaseSize: 100 | 250 | 500 | 750 | 1024;
  databaseSize: number;
  collectionCounts: {
    high: number;
    limited: number;
    total: number;
  };
  knowledgeCounts: {
    high: number;
    limited: number;
    basic: number;
    random: number;
  };
  collectionSubjectIds: Record<string, BangumiCollectionType>;
  knowledgeByVisualNovelId: Record<string, CustomAiKnowledgeLevel>;
  createdAt: string;
  updatedAt: string;
}

export type PublicCustomAiPlayer = Omit<
  CustomAiPlayer,
  "collectionSubjectIds" | "knowledgeByVisualNovelId"
>;

function targetSize(collectionCount: number): 100 | 250 | 500 | 750 | 1024 {
  if (collectionCount <= 100) return 100;
  if (collectionCount <= 250) return 250;
  if (collectionCount <= 500) return 500;
  if (collectionCount <= 750) return 750;
  return 1024;
}

function seededNumber(seed: string): number {
  const value = createHash("sha256").update(seed).digest().readUInt32BE(0);
  return value / 0xffffffff;
}

function deterministicShuffle<T>(items: T[], seed: string): T[] {
  return items
    .map((item, index) => ({
      item,
      score: seededNumber(`${seed}:${index}`),
    }))
    .sort((left, right) => left.score - right.score)
    .map(({ item }) => item);
}

function bangumiSourceId(visualNovel: VisualNovel): string | null {
  for (const records of Object.values(visualNovel.provenance)) {
    const record = records?.find((entry) => entry.source === "bangumi");
    if (record) return record.sourceId;
  }
  return null;
}

function collectionTitleKeys(collection: BangumiUserGameCollection): string[] {
  return [collection.subject?.name, collection.subject?.name_cn]
    .filter((value): value is string => Boolean(value))
    .map(normalizeTitle)
    .filter(Boolean);
}

function matchCollectionToCatalog(
  collection: BangumiUserGameCollection,
  catalog: VisualNovel[],
  catalogByBangumiId: ReadonlyMap<string, VisualNovel>,
  catalogByTitle: ReadonlyMap<string, VisualNovel>,
): VisualNovel | null {
  const byId = catalogByBangumiId.get(String(collection.subject_id));
  if (byId) return byId;
  for (const key of collectionTitleKeys(collection)) {
    const byTitle = catalogByTitle.get(key);
    if (byTitle) return byTitle;
  }
  return null;
}

function publicProfile(profile: CustomAiPlayer): PublicCustomAiPlayer {
  const {
    collectionSubjectIds: _subjectIds,
    knowledgeByVisualNovelId: _knowledge,
    ...result
  } = profile;
  return structuredClone(result);
}

export class CustomAiPlayerStore {
  private loaded = false;
  private readonly profiles = new Map<string, CustomAiPlayer>();

  constructor(private readonly filePath: string | null) {}

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.filePath) return;
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as {
        profiles?: CustomAiPlayer[];
      };
      for (const profile of parsed.profiles ?? []) {
        this.profiles.set(profile.id, profile);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private async persist(): Promise<void> {
    if (!this.filePath) return;
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(
      temporaryPath,
      `${JSON.stringify({ version: 1, profiles: [...this.profiles.values()] }, null, 2)}\n`,
      "utf8",
    );
    await rename(temporaryPath, this.filePath);
  }

  async list(): Promise<PublicCustomAiPlayer[]> {
    await this.ensureLoaded();
    return [...this.profiles.values()]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(publicProfile);
  }

  async get(id: string): Promise<CustomAiPlayer | null> {
    await this.ensureLoaded();
    const profile = this.profiles.get(id);
    return profile ? structuredClone(profile) : null;
  }

  async importBangumiUser(
    handleInput: string,
    difficulty: AiDifficulty,
    strategy: AiStrategy,
    catalog: VisualNovel[],
    client: BangumiClient,
    now = new Date(),
  ): Promise<PublicCustomAiPlayer> {
    await this.ensureLoaded();
    const username = handleInput.trim().replace(/^@/, "");
    if (!username) throw new Error("BANGUMI_USERNAME_REQUIRED");
    const [user, collections] = await Promise.all([
      client.getUser(username),
      client.getUserGameCollections(username),
    ]);
    const id = `bangumi:${user.username.toLocaleLowerCase()}`;
    const existing = this.profiles.get(id);
    const catalogByBangumiId = new Map<string, VisualNovel>();
    const catalogByTitle = new Map<string, VisualNovel>();
    for (const visualNovel of catalog) {
      const sourceId = bangumiSourceId(visualNovel);
      if (sourceId) catalogByBangumiId.set(sourceId, visualNovel);
      for (const title of [visualNovel.title, ...visualNovel.aliases]) {
        const key = normalizeTitle(title);
        if (key && !catalogByTitle.has(key))
          catalogByTitle.set(key, visualNovel);
      }
    }

    const knowledgeByVisualNovelId: Record<string, CustomAiKnowledgeLevel> = {};
    const collectionSubjectIds: Record<string, BangumiCollectionType> = {};
    let highCount = 0;
    let limitedCount = 0;
    for (const collection of collections) {
      collectionSubjectIds[String(collection.subject_id)] = collection.type;
      const matched = matchCollectionToCatalog(
        collection,
        catalog,
        catalogByBangumiId,
        catalogByTitle,
      );
      if (!matched) continue;
      if (collection.type === 2 || collection.type === 3) {
        knowledgeByVisualNovelId[matched.id] = "high";
        highCount += 1;
      } else {
        knowledgeByVisualNovelId[matched.id] = "limited";
        limitedCount += 1;
      }
    }

    const databaseTarget = targetSize(collections.length);
    const rememberedIds = new Set(Object.keys(knowledgeByVisualNovelId));
    const databaseSize = Math.min(
      catalog.length,
      Math.max(databaseTarget, rememberedIds.size),
    );
    const expansion = deterministicShuffle(
      catalog.filter((entry) => !rememberedIds.has(entry.id)),
      id,
    ).slice(0, Math.max(0, databaseSize - rememberedIds.size));
    for (const visualNovel of expansion) {
      knowledgeByVisualNovelId[visualNovel.id] = "basic";
    }
    const basicCount = Object.values(knowledgeByVisualNovelId).filter(
      (level) => level === "basic",
    ).length;
    const timestamp = now.toISOString();
    const profile: CustomAiPlayer = {
      id,
      bangumiUsername: user.username,
      handle: `@${user.username}`,
      nickname: user.nickname || user.username,
      avatarUrl: user.avatar.large || user.avatar.medium || user.avatar.small,
      profileUrl: `https://bgm.tv/user/${encodeURIComponent(user.username)}`,
      difficulty,
      strategy,
      targetDatabaseSize: databaseTarget,
      databaseSize,
      collectionCounts: {
        high: collections.filter((item) => item.type === 2 || item.type === 3)
          .length,
        limited: collections.filter(
          (item) => item.type === 1 || item.type === 4 || item.type === 5,
        ).length,
        total: collections.length,
      },
      knowledgeCounts: {
        high: highCount,
        limited: limitedCount,
        basic: basicCount,
        random: Math.max(
          0,
          catalog.length - Object.keys(knowledgeByVisualNovelId).length,
        ),
      },
      collectionSubjectIds,
      knowledgeByVisualNovelId,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    this.profiles.set(id, profile);
    await this.persist();
    return publicProfile(profile);
  }
}

function limitedKnowledge(visualNovel: VisualNovel): VisualNovel {
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

/** 未进入记忆库的作品按用户与作品生成稳定的随机残缺记忆。 */
export function maskCustomAiKnowledge(
  visualNovel: VisualNovel,
  profile: CustomAiPlayer,
): VisualNovel {
  const level = profile.knowledgeByVisualNovelId[visualNovel.id];
  if (level === "high") return structuredClone(visualNovel);
  if (level === "limited" || level === "basic")
    return limitedKnowledge(visualNovel);
  const known = limitedKnowledge(visualNovel);
  const keep = (field: string) =>
    seededNumber(`${profile.id}:${visualNovel.id}:${field}`) < 0.22;
  return {
    ...known,
    aliases: keep("aliases") ? structuredClone(visualNovel.aliases) : [],
    publisher: keep("publisher")
      ? structuredClone(visualNovel.publisher)
      : null,
    scenarioWriter: keep("scenarioWriter")
      ? structuredClone(visualNovel.scenarioWriter)
      : null,
    heroineHairColor: keep("heroineHairColor")
      ? structuredClone(visualNovel.heroineHairColor)
      : null,
    playtime: keep("playtime") ? visualNovel.playtime : null,
    vndbRating: keep("vndbRating") ? visualNovel.vndbRating : null,
    bangumiRating: keep("bangumiRating") ? visualNovel.bangumiRating : null,
    animeAdaptation: keep("animeAdaptation")
      ? visualNovel.animeAdaptation
      : null,
    tags: keep("tags") ? structuredClone(visualNovel.tags) : null,
  };
}

function normalized(value: string): string {
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
      const overlap = new Set((result.overlap ?? []).map(normalized));
      return actual.overlap.every((item) => overlap.has(normalized(item)));
    }
    return true;
  });
}

function sampleEvenly<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) return items;
  return Array.from(
    { length: limit },
    (_, index) => items[Math.floor((index * items.length) / limit)],
  ).filter((item): item is T => item !== undefined);
}

function comparisonSignature(
  guess: VisualNovel,
  answer: VisualNovel,
  keys: ComparisonKey[],
): string {
  return compareGuess(guess, answer, keys)
    .map(
      (result) =>
        `${result.status}:${result.direction ?? ""}:${result.hint ?? ""}:${(result.overlap ?? []).map(normalized).sort().join(",")}`,
    )
    .join("|");
}

function entropyChoice(
  possibleAnswers: VisualNovel[],
  candidates: VisualNovel[],
  keys: ComparisonKey[],
): VisualNovel | null {
  const answers = sampleEvenly(possibleAnswers, 96);
  const guesses = sampleEvenly(candidates, 64);
  let best: VisualNovel | null = null;
  let bestExpectedRemaining = Number.POSITIVE_INFINITY;
  for (const guess of guesses) {
    const partitions = new Map<string, number>();
    for (const answer of answers) {
      const signature = comparisonSignature(guess, answer, keys);
      partitions.set(signature, (partitions.get(signature) ?? 0) + 1);
    }
    const expectedRemaining =
      [...partitions.values()].reduce((sum, count) => sum + count * count, 0) /
      Math.max(1, answers.length);
    if (expectedRemaining < bestExpectedRemaining) {
      bestExpectedRemaining = expectedRemaining;
      best = guess;
    }
  }
  return best;
}

export interface CustomAiDecision {
  visualNovelId: string;
  title: string;
  reason: "minimum-entropy" | "mixed-memory";
}

export function chooseCustomAiGuess(
  catalog: VisualNovel[],
  game: PublicGameSession,
  profile: CustomAiPlayer,
  random: () => number = Math.random,
): CustomAiDecision | null {
  const pool = filterAnswerPool(catalog, game.rules);
  const fullById = new Map(pool.map((entry) => [entry.id, entry]));
  const knownPool = pool.map((entry) => maskCustomAiKnowledge(entry, profile));
  const used = new Set(game.guesses.map((guess) => guess.visualNovelId));
  let remaining = knownPool.filter((entry) => !used.has(entry.id));
  for (const guess of game.guesses) {
    const fullGuess = fullById.get(guess.visualNovelId);
    if (!fullGuess) continue;
    const knownGuess = maskCustomAiKnowledge(fullGuess, profile);
    const filtered = remaining.filter((candidate) =>
      feedbackMatches(knownGuess, candidate, guess, game.rules.comparisonKeys),
    );
    if (filtered.length > 0) remaining = filtered;
  }
  if (remaining.length === 0) return null;

  const remembered = remaining.filter(
    (entry) => profile.knowledgeByVisualNovelId[entry.id] != null,
  );
  const candidatePool = remembered.length > 0 ? remembered : remaining;
  const useEntropy = profile.strategy === "entropy" || random() < 0.68;
  const selected = useEntropy
    ? entropyChoice(remaining, candidatePool, game.rules.comparisonKeys)
    : candidatePool[
        Math.min(
          candidatePool.length - 1,
          Math.floor(Math.max(0, random()) * candidatePool.length),
        )
      ];
  if (!selected) return null;
  return {
    visualNovelId: selected.id,
    title: selected.title,
    reason: useEntropy ? "minimum-entropy" : "mixed-memory",
  };
}

export function customAiThinkTime(
  difficulty: AiDifficulty,
  completedGuessCount: number,
  random: () => number = Math.random,
): number {
  if (completedGuessCount === 0) return 5_000;
  const base =
    difficulty === "easy" ? 28_000 : difficulty === "medium" ? 23_000 : 15_000;
  const jitter = difficulty === "hard" ? 2_000 : 4_000;
  return base + Math.floor(Math.max(0, random()) * jitter);
}
