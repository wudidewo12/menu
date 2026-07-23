import "server-only";

import path from "node:path";

import { DishDifficulty } from "../../generated/prisma/enums";
import type { Menu as SourceMenu } from "../../types/menu";

export const DEFAULT_MENU_SLUG = "family-dinner";
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Invalid menu seed: ${message}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertNonEmptyString(
  value: unknown,
  field: string,
): asserts value is string {
  assert(typeof value === "string" && value.trim().length > 0, `${field} must be a non-empty string`);
}

export function assertPositiveInteger(
  value: unknown,
  field: string,
): asserts value is number {
  assert(Number.isInteger(value) && Number(value) > 0, `${field} must be a positive integer`);
}

export function parsePrepMinutes(value: string, dishId: number) {
  const match = value.match(/^(\d+)分钟$/);
  assert(match, `dish ${dishId} prepTime must use the "数字分钟" format`);

  const minutes = Number(match[1]);
  assertPositiveInteger(minutes, `dish ${dishId} prep minutes`);

  return minutes;
}

export function parseServings(value: string, dishId: number) {
  const match = value.match(/^(\d+)(?:-(\d+))?人份$/);
  assert(match, `dish ${dishId} servings must use the "数字人份" or "数字-数字人份" format`);

  const minimum = Number(match[1]);
  const maximum = Number(match[2] ?? match[1]);

  assertPositiveInteger(minimum, `dish ${dishId} minimum servings`);
  assertPositiveInteger(maximum, `dish ${dishId} maximum servings`);
  assert(maximum >= minimum, `dish ${dishId} servings maximum must not be below minimum`);

  return { minimum, maximum };
}

export function mapDifficulty(value: string, dishId: number): DishDifficulty {
  if (value === "简单") {
    return DishDifficulty.EASY;
  }

  if (value === "中等") {
    return DishDifficulty.MEDIUM;
  }

  assert(value === "困难", `dish ${dishId} has unsupported difficulty "${value}"`);
  return DishDifficulty.HARD;
}

export function parseSourceMenu(value: unknown): SourceMenu {
  assert(isRecord(value), "top level must be an object");
  assertPositiveInteger(value.version, "version");
  assertNonEmptyString(value.updatedAt, "updatedAt");
  assert(!Number.isNaN(Date.parse(value.updatedAt)), "updatedAt must be a valid ISO date");
  assert(isRecord(value.settings), "settings must be an object");
  assertNonEmptyString(value.settings.title, "settings.title");
  assertNonEmptyString(value.settings.subtitle, "settings.subtitle");
  assert(Array.isArray(value.settings.sections), "settings.sections must be an array");
  assert(Array.isArray(value.dishes), "dishes must be an array");

  return value as unknown as SourceMenu;
}

export function resolvePublicFile(projectRoot: string, storageKey: string) {
  const publicDirectory = path.resolve(projectRoot, "public");
  const filePath = path.resolve(publicDirectory, storageKey);

  assert(
    filePath.startsWith(`${publicDirectory}${path.sep}`),
    `image storage key "${storageKey}" escapes the public directory`,
  );

  return filePath;
}
