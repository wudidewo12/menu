import "server-only";

import path from "node:path";

import { Prisma } from "../../generated/prisma/client";
import type { Menu } from "../../types/menu";
import {
  defaultUploadsDirectory,
  publicImageUrl,
  removeFileIfPresent,
  type StoredDishImage,
  storeUniqueImageFile,
  uploadFilePathFromStorageKey,
} from "./dish-image-storage";
import {
  validateDatabaseDishImage,
} from "./dish-image-validation";
import {
  DEFAULT_MENU_READ_SLUG,
  readMenuFromDatabaseWithClient,
} from "./menu-read";
import { MenuVersionConflictError } from "./menu-write-plan";
import { prisma } from "./prisma";

const PRIMARY_IMAGE_SORT_ORDER = 1;

interface DatabaseDishImageTransactionResult {
  menu: Menu;
  previousStorageKey: string | null;
}

export interface DatabaseDishImageWriteResult {
  menu: Menu;
  image: {
    url: string;
    filename: string;
    storageKey: string;
    mimeType: string;
    width: number;
    height: number;
    byteSize: number;
  };
  oldFileCleanupPending: boolean;
}

export interface DatabaseDishImageWriteOptions {
  menuSlug?: string;
  uploadsDirectory?: string;
  /**
   * Test-only hook used to prove that the database transaction rolls back and
   * the newly written file is removed. Production API code must not set it.
   */
  beforeCommit?: (result: DatabaseDishImageWriteResult) => void | Promise<void>;
}

export class DatabaseMenuDishNotFoundError extends Error {
  readonly code = "DISH_NOT_IN_MENU";

  constructor(
    readonly dishId: number,
    readonly menuSlug: string,
  ) {
    super(`Dish ${dishId} is not part of database menu "${menuSlug}"`);
    this.name = "DatabaseMenuDishNotFoundError";
  }
}

export class DatabaseDishImageWriteVerificationError extends Error {
  readonly code = "DISH_IMAGE_WRITE_VERIFICATION_FAILED";

  constructor() {
    super("Database dish image did not match the validated upload");
    this.name = "DatabaseDishImageWriteVerificationError";
  }
}

export class DatabaseImageMenuNotFoundError extends Error {
  readonly code = "MENU_NOT_FOUND";

  constructor(readonly menuSlug: string) {
    super(`Database menu "${menuSlug}" was not found`);
    this.name = "DatabaseImageMenuNotFoundError";
  }
}

function imageResult(
  menu: Menu,
  image: StoredDishImage,
  oldFileCleanupPending: boolean,
): DatabaseDishImageWriteResult {
  return {
    menu,
    image: {
      url: publicImageUrl(image.storageKey),
      filename: image.filename,
      storageKey: image.storageKey,
      mimeType: image.mimeType,
      width: image.width,
      height: image.height,
      byteSize: image.byteSize,
    },
    oldFileCleanupPending,
  };
}

async function findMenuDish(
  transaction: Prisma.TransactionClient,
  menuId: string,
  dishId: number,
  menuSlug: string,
) {
  const menuDish = await transaction.menuDish.findUnique({
    where: {
      menuId_dishId: {
        menuId,
        dishId,
      },
    },
    select: {
      dish: {
        select: {
          name: true,
        },
      },
    },
  });

  if (!menuDish) {
    throw new DatabaseMenuDishNotFoundError(dishId, menuSlug);
  }

  return menuDish;
}

async function claimMenuVersion(
  transaction: Prisma.TransactionClient,
  menuId: string,
  submittedVersion: number,
) {
  const claimedMenu = await transaction.menu.updateMany({
    where: {
      id: menuId,
      version: submittedVersion,
    },
    data: {
      version: {
        increment: 1,
      },
    },
  });

  if (claimedMenu.count !== 1) {
    throw new MenuVersionConflictError(submittedVersion, null);
  }
}

async function replacePrimaryImage(
  transaction: Prisma.TransactionClient,
  image: StoredDishImage,
  altText: string,
) {
  const previousImage = await transaction.dishImage.findUnique({
    where: {
      dishId_sortOrder: {
        dishId: image.dishId,
        sortOrder: PRIMARY_IMAGE_SORT_ORDER,
      },
    },
    select: {
      storageKey: true,
    },
  });

  const imageData = {
    storageKey: image.storageKey,
    altText,
    mimeType: image.mimeType,
    width: image.width,
    height: image.height,
    byteSize: image.byteSize,
  };

  await transaction.dishImage.upsert({
    where: {
      dishId_sortOrder: {
        dishId: image.dishId,
        sortOrder: PRIMARY_IMAGE_SORT_ORDER,
      },
    },
    create: {
      dishId: image.dishId,
      ...imageData,
      sortOrder: PRIMARY_IMAGE_SORT_ORDER,
    },
    update: imageData,
  });
  await transaction.dish.update({
    where: {
      id: image.dishId,
    },
    data: {
      version: {
        increment: 1,
      },
    },
  });

  return previousImage?.storageKey ?? null;
}

async function verifySavedImage(
  transaction: Prisma.TransactionClient,
  image: StoredDishImage,
  menuSlug: string,
) {
  const savedMenu = await readMenuFromDatabaseWithClient(
    transaction,
    menuSlug,
  );
  const savedDish = savedMenu?.dishes.find(
    (dish) => dish.id === image.dishId,
  );
  const expectedUrl = publicImageUrl(image.storageKey);

  if (
    !savedMenu ||
    savedMenu.version !== image.menuVersion + 1 ||
    savedDish?.image !== expectedUrl ||
    savedDish.images[0] !== expectedUrl
  ) {
    throw new DatabaseDishImageWriteVerificationError();
  }

  return savedMenu;
}

async function writeImageMetadataTransaction(
  image: StoredDishImage,
  menuSlug: string,
  beforeCommit: DatabaseDishImageWriteOptions["beforeCommit"],
): Promise<DatabaseDishImageTransactionResult> {
  return prisma.$transaction(
    async (transaction) => {
      const menuRecord = await transaction.menu.findUnique({
        where: {
          slug: menuSlug,
        },
        select: {
          id: true,
          version: true,
        },
      });
      if (!menuRecord) {
        throw new DatabaseImageMenuNotFoundError(menuSlug);
      }
      if (menuRecord.version !== image.menuVersion) {
        throw new MenuVersionConflictError(
          image.menuVersion,
          menuRecord.version,
        );
      }

      const menuDish = await findMenuDish(
        transaction,
        menuRecord.id,
        image.dishId,
        menuSlug,
      );
      await claimMenuVersion(
        transaction,
        menuRecord.id,
        image.menuVersion,
      );
      const previousStorageKey = await replacePrimaryImage(
        transaction,
        image,
        menuDish.dish.name,
      );
      const savedMenu = await verifySavedImage(
        transaction,
        image,
        menuSlug,
      );

      await beforeCommit?.(imageResult(savedMenu, image, false));

      return {
        menu: savedMenu,
        previousStorageKey,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5_000,
      timeout: 30_000,
    },
  );
}

async function removeNewFileAfterDatabaseFailure(
  filePath: string,
) {
  try {
    await removeFileIfPresent(filePath);
  } catch {
    console.error("Failed to compensate a database image upload file.");
  }
}

async function cleanPreviousUpload(
  previousStorageKey: string | null,
  currentStorageKey: string,
  uploadsDirectory: string,
) {
  if (
    !previousStorageKey ||
    previousStorageKey === currentStorageKey
  ) {
    return false;
  }

  const previousFilePath = uploadFilePathFromStorageKey(
    uploadsDirectory,
    previousStorageKey,
  );
  if (!previousFilePath) {
    return false;
  }

  try {
    await removeFileIfPresent(previousFilePath);
    return false;
  } catch {
    console.error("Failed to clean up a replaced database dish image.");
    return true;
  }
}

export async function writeDishImageToDatabase(
  input: unknown,
  options: DatabaseDishImageWriteOptions = {},
): Promise<DatabaseDishImageWriteResult> {
  const image = validateDatabaseDishImage(input);
  const menuSlug = options.menuSlug ?? DEFAULT_MENU_READ_SLUG;
  const uploadsDirectory = path.resolve(
    options.uploadsDirectory ?? defaultUploadsDirectory(),
  );
  const storedImage = await storeUniqueImageFile(
    image,
    uploadsDirectory,
  );

  let transactionResult: DatabaseDishImageTransactionResult;

  try {
    transactionResult = await writeImageMetadataTransaction(
      storedImage,
      menuSlug,
      options.beforeCommit,
    );
  } catch (error) {
    await removeNewFileAfterDatabaseFailure(storedImage.filePath);
    throw error;
  }

  const oldFileCleanupPending = await cleanPreviousUpload(
    transactionResult.previousStorageKey,
    storedImage.storageKey,
    uploadsDirectory,
  );

  return imageResult(
    transactionResult.menu,
    storedImage,
    oldFileCleanupPending,
  );
}

export {
  DishImageWriteValidationError,
  validateDatabaseDishImage,
} from "./dish-image-validation";
