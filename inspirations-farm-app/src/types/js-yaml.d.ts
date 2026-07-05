/**
 * Minimal ambient declaration for the parts of `js-yaml` used in this project
 * (load / dump / JSON_SCHEMA). Full types live in @types/js-yaml, which isn't
 * installed. We parse frontmatter with JSON_SCHEMA specifically to avoid
 * js-yaml's `timestamp` type coercing date-like values (e.g. `create:
 * 2026-06-19 11:32:01`) into Date objects — that coercion would shift Beijing
 * time strings by a timezone and corrupt them on round-trip. This surface is
 * all we need.
 */
declare module "js-yaml" {
  export interface LoadOptions {
    schema?: unknown;
    json?: boolean;
    [key: string]: unknown;
  }
  export interface DumpOptions {
    schema?: unknown;
    lineWidth?: number;
    noRefs?: boolean;
    [key: string]: unknown;
  }
  export function load(input: string, opts?: LoadOptions): unknown;
  export function dump(obj: unknown, opts?: DumpOptions): string;
  export const JSON_SCHEMA: unknown;
}
