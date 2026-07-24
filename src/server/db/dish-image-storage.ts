import { randomUUID } from "node:crypto";
import {
  mkdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import type { ValidatedDishImage } from "./dish-image-validation";

const UPLOAD_STORAGE_PREFIX = "uploads/";

export interface StoredDishImage extends ValidatedDishImage {
  filename: string;
  filePath: string;
  storageKey: string;
}

export function defaultUploadsDirectory() {
  const dataDirectory =
    process.env.DATA_DIR || path.join(process.cwd(), "data");

  return path.resolve(dataDirectory, "uploads");
}

export function publicImageUrl(storageKey: string) {
  return `/${storageKey.replace(/^\/+/, "")}`;
}

export function uploadFilePathFromStorageKey(
  uploadsDirectory: string,
  storageKey: string,
) {
  if (!storageKey.startsWith(UPLOAD_STORAGE_PREFIX)) {
    return null;
  }

  const relativeStoragePath = storageKey.slice(
    UPLOAD_STORAGE_PREFIX.length,
  );
  const filePath = path.resolve(
    uploadsDirectory,
    ...relativeStoragePath.split("/"),
  );
  const relativeFilePath = path.relative(uploadsDirectory, filePath);

  if (
    !relativeFilePath ||
    relativeFilePath.startsWith("..") ||
    path.isAbsolute(relativeFilePath)
  ) {
    return null;
  }

  return filePath;
}

export async function removeFileIfPresent(filePath: string) {
  try {
    await unlink(filePath);
  } catch (error) {
    if (
      typeof error !== "object" ||
      error === null ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }
}

export async function storeUniqueImageFile(
  image: ValidatedDishImage,
  uploadsDirectory: string,
): Promise<StoredDishImage> {
  const uniqueName = randomUUID();
  const filename = `${uniqueName}.${image.extension}`;
  const relativePath = path.posix.join(
    "dishes",
    String(image.dishId),
    filename,
  );
  const storageKey = path.posix.join(
    UPLOAD_STORAGE_PREFIX,
    relativePath,
  );
  const filePath = path.resolve(
    uploadsDirectory,
    ...relativePath.split("/"),
  );
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(
    directory,
    `.${uniqueName}.${process.pid}.${Date.now()}.tmp`,
  );

  await mkdir(directory, { recursive: true });

  try {
    await writeFile(temporaryPath, image.buffer, {
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporaryPath, filePath);
  } catch (error) {
    await removeFileIfPresent(temporaryPath);
    throw error;
  }

  return {
    ...image,
    filename,
    filePath,
    storageKey,
  };
}
