import "server-only";

export const ADMIN_EMAIL_SETTINGS = Object.freeze({
  maximumCharacters: 254,
});

const EMAIL_LOCAL_PATTERN = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i;
const EMAIL_DOMAIN_LABEL_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export function normalizeAdminEmail(value: unknown): string {
  return typeof value === "string"
    ? value.normalize("NFC").trim().toLowerCase()
    : "";
}

export function isValidAdminEmail(email: string): boolean {
  if (
    email.length > ADMIN_EMAIL_SETTINGS.maximumCharacters ||
    !/^[\x21-\x7e]+$/u.test(email)
  ) {
    return false;
  }

  const parts = email.split("@");

  if (parts.length !== 2) {
    return false;
  }

  const [local, domain] = parts;

  if (
    !local ||
    local.length > 64 ||
    local.startsWith(".") ||
    local.endsWith(".") ||
    local.includes("..") ||
    !EMAIL_LOCAL_PATTERN.test(local)
  ) {
    return false;
  }

  const labels = domain.split(".");

  return (
    domain.length <= 253 &&
    labels.length >= 2 &&
    labels.every((label) => EMAIL_DOMAIN_LABEL_PATTERN.test(label))
  );
}
