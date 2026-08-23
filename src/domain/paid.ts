/**
 * Merges the per-copy price paid when two batches of the same collection
 * line are combined: quantity-weighted average, rounded to cents. A batch
 * with an unknown price leaves the other batch's price standing — an
 * average with a guess would be worse than an honest partial record.
 */
export function mergePaid(
	qtyA: number,
	paidA: number | null,
	qtyB: number,
	paidB: number | null,
): number | null {
	if (paidA === null) return paidB
	if (paidB === null) return paidA
	const total = Math.max(0, qtyA) + Math.max(0, qtyB)
	if (total === 0) return null
	const average = (Math.max(0, qtyA) * paidA + Math.max(0, qtyB) * paidB) / total
	return Math.round(average * 100) / 100
}
