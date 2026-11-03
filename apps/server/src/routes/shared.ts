import { DomainError } from "../errors.ts";

export function requireUuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new DomainError(400, "BAD_REQUEST", "Path id must be a UUID");
  }
  return value;
}
