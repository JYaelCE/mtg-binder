/** One in-transit purchase, flattened out of a deck line for the Purchases view. */
export interface PurchaseLike {
	qty: number
	/** Price paid per copy; null when the user did not record it. */
	price: number | null
}

export interface PurchasesSummary {
	/** Copies on the way. */
	copies: number
	/** Total cost of the priced purchases (qty × per-copy price). */
	cost: number
	/** Purchases without a recorded price. */
	unpriced: number
}

export function summarizePurchases(purchases: PurchaseLike[]): PurchasesSummary {
	let copies = 0
	let cost = 0
	let unpriced = 0
	for (const purchase of purchases) {
		const qty = Math.max(0, purchase.qty)
		if (qty === 0) continue
		copies += qty
		if (purchase.price === null) unpriced += 1
		else cost += qty * purchase.price
	}
	return { copies, cost: Math.round(cost * 100) / 100, unpriced }
}
