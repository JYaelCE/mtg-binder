import { describe, expect, it } from 'vitest'
import { summarizePurchases } from '../src/domain/purchases'

describe('summarizePurchases', () => {
	it('totals copies and cost per copy, counting unpriced separately', () => {
		expect(
			summarizePurchases([
				{ qty: 2, price: 1.5 },
				{ qty: 1, price: null },
				{ qty: 3, price: 0.5 },
			]),
		).toEqual({ copies: 6, cost: 4.5, unpriced: 1 })
	})

	it('ignores empty purchases', () => {
		expect(summarizePurchases([{ qty: 0, price: 2 }])).toEqual({ copies: 0, cost: 0, unpriced: 0 })
	})
})
