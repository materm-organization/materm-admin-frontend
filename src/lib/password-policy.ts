// Password policy (NFR-10, doc/05 sections 2.5 / 2.7 / 2.9). The SERVER decides; this mirrors the rules that can
// be checked without a database or the common-password list, to give live feedback. Length is counted in code
// points (`[...s].length`), after NFKC normalisation like the backend (pkg/security/password).
export const PASSWORD_MIN_LENGTH = 12;
// doc/05 says 256; the backend's `password.MaxLength` is 128 (it answers `password_policy.max_length`). The
// stricter value is used so a password the form accepts is never refused for length (see the T1.1.11 report).
export const PASSWORD_MAX_LENGTH = 128;

export const codePointLength = (value: string): number => [...value.normalize("NFKC")].length;

const fold = (value: string): string => value.trim().normalize("NFKC").toLowerCase();

export type PasswordChecks = {
  minLength: boolean;
  // `null` = there is nothing to compare with (no identity known on this screen).
  notIdentity: boolean | null;
};

// `identity` = username / name / e-mail of the account. The backend rule is EQUALITY with the username, the
// display name or the local part of the e-mail (not a substring match).
export function evaluatePassword(password: string, identity: (string | null | undefined)[] = []): PasswordChecks {
  const candidates = identity
    .filter((value): value is string => !!value && value.trim() !== "")
    .map((value) => {
      const at = value.lastIndexOf("@");
      return at > 0 ? [fold(value), fold(value.slice(0, at))] : [fold(value)];
    })
    .flat();
  const folded = fold(password);
  return {
    minLength: codePointLength(password) >= PASSWORD_MIN_LENGTH,
    notIdentity: candidates.length === 0 ? null : !candidates.includes(folded),
  };
}
