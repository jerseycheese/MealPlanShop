// Canonical string normalization for case-insensitive matching: trim + lowercase.
// Lives at the repo root (next to types.ts) so both the server (`../normalize`)
// and the client (`../../normalize`) share one source of truth — matching that
// differs by module is a recurring bug source. Null-safe so callers don't have
// to guard.
export function normalize(value: string): string {
  return (value ?? "").trim().toLowerCase();
}
