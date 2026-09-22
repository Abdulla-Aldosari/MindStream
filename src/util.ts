import { randomUUID } from 'crypto';

/** Generates a unique id for every item/type. */
export function newId(): string {
  return randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}
