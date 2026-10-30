import type { ErrorObject } from "ajv/dist/2020";

export type PrecompiledFn = ((data: unknown, ctx?: object) => boolean) & { errors?: ErrorObject[] | null };
export type PrecompiledEntry = {
  key: string;
  version: number;
  root: PrecompiledFn;
  // `if` conditions of the schema, compiled on their own, keyed by canonical JSON (see ./index.ts).
  ifs: Record<string, PrecompiledFn>;
};
export const PRECOMPILED: Record<string, PrecompiledEntry>;
export const HASH_BY_TYPE: Record<string, string>;
