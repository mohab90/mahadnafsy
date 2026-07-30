export const normBranchId = (value: string | null | undefined): string =>
  String(value || '').trim().toUpperCase().replace(/[-\s]+/g, '_');
