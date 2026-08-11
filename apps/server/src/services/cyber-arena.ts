import { randomUUID } from "node:crypto";
import {
  createGameSession,
  createGameSessionForAnswer,
  publicGameSession,
  submitGuess,
  type FameTier,
  type GameRules,
  type GameSession,
  type PublicGameSession,
  type VisualNovel,
} from "@gal-yiba/shared";
import { defaultRules } from "../rooms.js";
import type {
  CustomAiPlayer,
  PublicCustomAiPlayer,
} from "./custom-ai-players.js";

export interface CyberArenaPlayer {
  playerId: string;
  profile: PublicCustomAiPlayer;
  game: PublicGameSession;
}

export interface CyberArenaSnapshot {
  id: string;
  status: "active" | "finished";
  fameTier: FameTier;
  createdAt: string;
  finishedAt: string | null;
  winnerPlayerId: string | null;
  answer: { id: string; title: string } | null;
  players: CyberArenaPlayer[];
  revision: number;
}

export interface CyberArenaSummary {
  id: string;
  status: CyberArenaSnapshot["status"];
  fameTier: FameTier;
  createdAt: string;
  winnerPlayerId: string | null;
  players: Array<{
    playerId: string;
    profileId: string;
    nickname: string;
    avatarUrl: string;
    guessCount: number;
  }>;
}

interface MutableCyberPlayer {
  playerId: string;
  profile: CustomAiPlayer;
  game: GameSession;
}

interface MutableCyberMatch {
  id: string;
  status: "active" | "finished";
  fameTier: FameTier;
  createdAt: string;
  finishedAt: string | null;
  winnerPlayerId: string | null;
  players: MutableCyberPlayer[];
  revision: number;
}

function publicProfile(profile: CustomAiPlayer): PublicCustomAiPlayer {
  const {
    collectionSubjectIds: _subjectIds,
    knowledgeByVisualNovelId: _knowledge,
    ...result
  } = profile;
  return structuredClone(result);
}

function snapshot(match: MutableCyberMatch): CyberArenaSnapshot {
  const answer = match.players[0]?.game.answer;
  return {
    id: match.id,
    status: match.status,
    fameTier: match.fameTier,
    createdAt: match.createdAt,
    finishedAt: match.finishedAt,
    winnerPlayerId: match.winnerPlayerId,
    answer:
      match.status === "finished" && answer
        ? { id: answer.id, title: answer.title }
        : null,
    players: match.players.map((player) => ({
      playerId: player.playerId,
      profile: publicProfile(player.profile),
      game: publicGameSession(player.game),
    })),
    revision: match.revision,
  };
}

export class CyberArenaRegistry {
  private readonly matches = new Map<string, MutableCyberMatch>();

  create(
    left: CustomAiPlayer,
    right: CustomAiPlayer,
    catalog: VisualNovel[],
    fameTier: FameTier,
    options: { now?: Date; random?: () => number } = {},
  ): CyberArenaSnapshot {
    if (left.id === right.id) throw new Error("CYBER_PLAYERS_MUST_DIFFER");
    const now = options.now ?? new Date();
    const rules: GameRules = {
      ...structuredClone(defaultRules),
      mode: "duel",
      maxGuesses: 12,
      roundTimeSeconds: 600,
      bestOf: 1,
      replayTiedRounds: false,
      pool: { ...structuredClone(defaultRules.pool), fameTier },
    };
    const base = createGameSession(catalog, rules, {
      now,
      ...(options.random ? { random: options.random } : {}),
    });
    const match: MutableCyberMatch = {
      id: randomUUID(),
      status: "active",
      fameTier,
      createdAt: now.toISOString(),
      finishedAt: null,
      winnerPlayerId: null,
      players: [left, right].map((profile) => ({
        playerId: randomUUID(),
        profile: structuredClone(profile),
        game: createGameSessionForAnswer(base.answer, rules, {
          now,
          id: `${base.id}:${profile.id}`,
        }),
      })),
      revision: 1,
    };
    this.matches.set(match.id, match);
    while (this.matches.size > 50) {
      const oldest = this.matches.keys().next().value as string | undefined;
      if (!oldest) break;
      this.matches.delete(oldest);
    }
    return snapshot(match);
  }

  get(id: string): CyberArenaSnapshot {
    const match = this.require(id);
    return snapshot(match);
  }

  list(): CyberArenaSummary[] {
    return [...this.matches.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((match) => ({
        id: match.id,
        status: match.status,
        fameTier: match.fameTier,
        createdAt: match.createdAt,
        winnerPlayerId: match.winnerPlayerId,
        players: match.players.map((player) => ({
          playerId: player.playerId,
          profileId: player.profile.id,
          nickname: player.profile.nickname,
          avatarUrl: player.profile.avatarUrl,
          guessCount: player.game.guesses.length,
        })),
      }));
  }

  activePlayers(id: string): Array<{
    playerId: string;
    profile: CustomAiPlayer;
    game: PublicGameSession;
  }> {
    const match = this.require(id);
    if (match.status !== "active") return [];
    return match.players
      .filter((player) => player.game.status === "active")
      .map((player) => ({
        playerId: player.playerId,
        profile: structuredClone(player.profile),
        game: publicGameSession(player.game),
      }));
  }

  submitGuess(
    id: string,
    playerId: string,
    visualNovelId: string,
    catalog: VisualNovel[],
    now = new Date(),
  ): CyberArenaSnapshot {
    const match = this.require(id);
    if (match.status !== "active") throw new Error("CYBER_MATCH_FINISHED");
    const player = match.players.find((item) => item.playerId === playerId);
    if (!player) throw new Error("CYBER_PLAYER_NOT_FOUND");
    const visualNovel = catalog.find((entry) => entry.id === visualNovelId);
    if (!visualNovel) throw new Error("GUESS_NOT_IN_CATALOG");
    const result = submitGuess(player.game, visualNovel, now);
    player.game = result.game;
    if (!result.ok && result.error !== "GAME_EXPIRED")
      throw new Error(result.error);
    if (player.game.status === "won") {
      match.winnerPlayerId = player.playerId;
      for (const opponent of match.players) {
        if (opponent.playerId === player.playerId) continue;
        if (opponent.game.status === "active") {
          opponent.game = {
            ...opponent.game,
            status: "lost",
            finishedAt: now.toISOString(),
          };
        }
      }
      match.status = "finished";
      match.finishedAt = now.toISOString();
    } else if (match.players.every((item) => item.game.status !== "active")) {
      match.status = "finished";
      match.finishedAt = now.toISOString();
    }
    match.revision += 1;
    return snapshot(match);
  }

  private require(id: string): MutableCyberMatch {
    const match = this.matches.get(id);
    if (!match) throw new Error("CYBER_MATCH_NOT_FOUND");
    return match;
  }
}
