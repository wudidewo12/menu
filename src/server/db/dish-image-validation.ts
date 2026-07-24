import { imageSize } from "image-size";

export const DATABASE_IMAGE_UPLOAD_LIMIT = 12_000_000;
export const DATABASE_IMAGE_MAX_SIDE = 10_000;
export const DATABASE_IMAGE_MAX_PIXELS = 40_000_000;

const SUPPORTED_IMAGE_TYPES = {
  jpg: {
    extension: "jpg",
    mimeType: "image/jpeg",
  },
  png: {
    extension: "png",
    mimeType: "image/png",
  },
  webp: {
    extension: "webp",
    mimeType: "image/webp",
  },
  gif: {
    extension: "gif",
    mimeType: "image/gif",
  },
} as const;

type SupportedImageType = keyof typeof SUPPORTED_IMAGE_TYPES;

export interface ValidatedDishImage {
  dishId: number;
  menuVersion: number;
  buffer: Buffer;
  extension: string;
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
}

export class DishImageWriteValidationError extends Error {
  readonly code = "DISH_IMAGE_VALIDATION_FAILED";

  constructor(readonly issues: string[]) {
    super(`Dish image validation failed:\n- ${issues.join("\n- ")}`);
    this.name = "DishImageWriteValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInteger(
  value: unknown,
  field: string,
  issues: string[],
) {
  const number = typeof value === "number" ? value : Number.NaN;

  if (!Number.isInteger(number) || number <= 0) {
    issues.push(`${field} 必须是正整数`);
    return 0;
  }

  return number;
}

function supportedType(
  value: string | undefined,
): SupportedImageType | null {
  if (!value || !(value in SUPPORTED_IMAGE_TYPES)) {
    return null;
  }

  return value as SupportedImageType;
}

export function validateDatabaseDishImage(
  input: unknown,
): ValidatedDishImage {
  const issues: string[] = [];
  const source = isRecord(input) ? input : {};

  if (!isRecord(input)) {
    issues.push("图片上传数据必须是对象");
  }

  const dishId = positiveInteger(source.dishId, "dishId", issues);
  const menuVersion = positiveInteger(
    source.menuVersion,
    "menuVersion",
    issues,
  );
  const contentType =
    typeof source.contentType === "string"
      ? source.contentType.trim().toLowerCase()
      : "";
  const buffer =
    source.buffer instanceof Uint8Array
      ? Buffer.from(source.buffer)
      : Buffer.alloc(0);

  if (!(source.buffer instanceof Uint8Array)) {
    issues.push("buffer 必须是图片字节");
  } else if (buffer.length === 0) {
    issues.push("图片内容不能为空");
  } else if (buffer.length > DATABASE_IMAGE_UPLOAD_LIMIT) {
    issues.push("图片不能超过 12MB");
  }

  const declaredType = Object.entries(SUPPORTED_IMAGE_TYPES).find(
    ([, imageType]) => imageType.mimeType === contentType,
  )?.[0] as SupportedImageType | undefined;

  if (!declaredType) {
    issues.push("contentType 只支持 image/jpeg、image/png、image/webp 或 image/gif");
  }

  let detectedType: SupportedImageType | null = null;
  let width = 0;
  let height = 0;

  if (
    source.buffer instanceof Uint8Array &&
    buffer.length > 0 &&
    buffer.length <= DATABASE_IMAGE_UPLOAD_LIMIT
  ) {
    try {
      const dimensions = imageSize(buffer);
      detectedType = supportedType(dimensions.type);
      width = dimensions.width;
      height = dimensions.height;

      if (!detectedType) {
        issues.push("图片真实格式只支持 JPG、PNG、WebP 或 GIF");
      }
      if (
        !Number.isInteger(width) ||
        width <= 0 ||
        !Number.isInteger(height) ||
        height <= 0
      ) {
        issues.push("无法读取有效的图片宽高");
      } else {
        if (
          width > DATABASE_IMAGE_MAX_SIDE ||
          height > DATABASE_IMAGE_MAX_SIDE
        ) {
          issues.push("图片宽度和高度都不能超过 10000 像素");
        }
        if (width * height > DATABASE_IMAGE_MAX_PIXELS) {
          issues.push("图片总像素不能超过 4000 万");
        }
      }
    } catch {
      issues.push("图片内容损坏或不是真实图片");
    }
  }

  if (
    declaredType &&
    detectedType &&
    declaredType !== detectedType
  ) {
    issues.push("contentType 与图片真实格式不一致");
  }

  if (issues.length > 0 || !detectedType) {
    throw new DishImageWriteValidationError(issues);
  }

  const imageType = SUPPORTED_IMAGE_TYPES[detectedType];

  return {
    dishId,
    menuVersion,
    buffer,
    extension: imageType.extension,
    mimeType: imageType.mimeType,
    width,
    height,
    byteSize: buffer.length,
  };
}
