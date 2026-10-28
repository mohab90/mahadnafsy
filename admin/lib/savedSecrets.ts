// A secret saved in the settings never comes back to the browser: the server blanks it. It sends instead, beside the section, which ones are
// saved (`__savedSecrets`: the last four characters of a token or key, or true), so an empty box can say «محفوظ» instead of looking as if
// the value had been lost. An empty box on save means «leave it alone» (api/lib/configSecrets.js preserveStoredSecrets).
export type SavedSecrets = Record<string, string | true>;

/** The placeholder for a secret's input: what is saved, or the hint for typing a new one. */
export function savedSecretPlaceholder(saved: SavedSecrets | undefined, key: string, example = ''): string {
  const hint = saved?.[key];
  if (!hint) return example;
  return `محفوظ${typeof hint === 'string' ? ` (••••${hint})` : ''} — سيبه فاضي لو مش هتغيّره`;
}
