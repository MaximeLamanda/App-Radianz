export function shouldClearBillMonthToBaseline(params: {
  normalized: string;
  isValid: boolean;
  baselineMonth: number;
  monthWasEdited: boolean;
}): boolean {
  const { normalized, isValid, baselineMonth, monthWasEdited } = params;
  const shouldClear = normalized.length === 0 || !isValid || baselineMonth <= 0;
  if (!shouldClear) return false;
  // Un mois jamais modifie ne doit pas ecraser le profil courant sur blur vide.
  return monthWasEdited;
}
