import { createHash } from "node:crypto";

import type {
  Dish,
  DishImage,
  Menu,
  MenuDish,
  MenuSection,
  Prisma,
  PrismaClient,
  SectionDish,
} from "../src/generated/prisma/client.ts";

export interface MenuDatabaseSnapshot {
  data: {
    menus: Menu[];
    dishes: Dish[];
    menuDishes: MenuDish[];
    menuSections: MenuSection[];
    sectionDishes: SectionDish[];
    dishImages: DishImage[];
  };
  fingerprint: string;
  totalBusinessRows: number;
  menuVersion: number;
  dishSequenceValue: number;
  dishSequenceCalled: boolean;
}

function fingerprintSnapshotData(data: MenuDatabaseSnapshot["data"]) {
  return createHash("sha256")
    .update(JSON.stringify(data))
    .digest("hex");
}

function totalBusinessRows(data: MenuDatabaseSnapshot["data"]) {
  return Object.values(data).reduce(
    (total, records) => total + records.length,
    0,
  );
}

export async function takeMenuDatabaseSnapshot(
  client: PrismaClient,
): Promise<MenuDatabaseSnapshot> {
  const [
    menus,
    dishes,
    menuDishes,
    menuSections,
    sectionDishes,
    dishImages,
    dishSequenceRows,
  ] = await Promise.all([
    client.menu.findMany({
      orderBy: {
        id: "asc",
      },
    }),
    client.dish.findMany({
      orderBy: {
        id: "asc",
      },
    }),
    client.menuDish.findMany({
      orderBy: [{ menuId: "asc" }, { dishId: "asc" }],
    }),
    client.menuSection.findMany({
      orderBy: {
        id: "asc",
      },
    }),
    client.sectionDish.findMany({
      orderBy: [{ sectionId: "asc" }, { dishId: "asc" }],
    }),
    client.dishImage.findMany({
      orderBy: {
        id: "asc",
      },
    }),
    client.$queryRaw<
      Array<{ sequenceValue: bigint; sequenceCalled: boolean }>
    >`
      SELECT
        last_value AS "sequenceValue",
        is_called AS "sequenceCalled"
      FROM "Dish_id_seq"
    `,
  ]);
  const data = {
    menus,
    dishes,
    menuDishes,
    menuSections,
    sectionDishes,
    dishImages,
  };

  return {
    data,
    fingerprint: fingerprintSnapshotData(data),
    totalBusinessRows: totalBusinessRows(data),
    menuVersion: menus[0]?.version ?? 0,
    dishSequenceValue: Number(dishSequenceRows[0]?.sequenceValue),
    dishSequenceCalled: dishSequenceRows[0]?.sequenceCalled ?? false,
  };
}

async function restoreBusinessRecords(
  transaction: Prisma.TransactionClient,
  snapshot: MenuDatabaseSnapshot,
) {
  await transaction.sectionDish.deleteMany();
  await transaction.dishImage.deleteMany();
  await transaction.menuDish.deleteMany();
  await transaction.menuSection.deleteMany();
  await transaction.dish.deleteMany();
  await transaction.menu.deleteMany();

  await transaction.menu.createMany({
    data: snapshot.data.menus,
  });
  await transaction.dish.createMany({
    data: snapshot.data.dishes,
  });
  await transaction.menuDish.createMany({
    data: snapshot.data.menuDishes,
  });
  await transaction.menuSection.createMany({
    data: snapshot.data.menuSections,
  });
  await transaction.sectionDish.createMany({
    data: snapshot.data.sectionDishes,
  });
  await transaction.dishImage.createMany({
    data: snapshot.data.dishImages,
  });

  const [menus, dishes, menuDishes, menuSections, sectionDishes, dishImages] =
    await Promise.all([
      transaction.menu.count(),
      transaction.dish.count(),
      transaction.menuDish.count(),
      transaction.menuSection.count(),
      transaction.sectionDish.count(),
      transaction.dishImage.count(),
    ]);
  const restoredTotal =
    menus +
    dishes +
    menuDishes +
    menuSections +
    sectionDishes +
    dishImages;

  if (restoredTotal !== snapshot.totalBusinessRows) {
    throw new Error(
      `Snapshot restore count mismatch: expected ${snapshot.totalBusinessRows}, received ${restoredTotal}`,
    );
  }
}

export async function restoreMenuDatabaseSnapshot(
  client: PrismaClient,
  snapshot: MenuDatabaseSnapshot,
) {
  await client.$transaction(
    async (transaction) => {
      await restoreBusinessRecords(transaction, snapshot);
    },
    {
      isolationLevel: "Serializable",
      maxWait: 5_000,
      timeout: 30_000,
    },
  );

  await client.$queryRaw<Array<{ value: bigint }>>`
    SELECT setval(
      pg_get_serial_sequence('"Dish"', 'id'),
      ${BigInt(snapshot.dishSequenceValue)},
      ${snapshot.dishSequenceCalled}
    ) AS "value"
  `;
}
