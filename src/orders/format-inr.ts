/** Amounts are stored in paise (integers). `paise` of 1499900 renders as "₹14,999" — mirrors i_Do_Frontend/lib/format.ts. */
export function formatINR(paise: number): string {
  const rupees = Math.round(paise) / 100;
  return '₹' + rupees.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}
