import { describe, expect, it } from 'vitest'
import { applyWishlistDelta, wishlistDelta } from '../src/domain/wishlist-sync'

describe('wishlistDelta', () => {
	it('is negative when more copies were ordered', () => {
		expect(wishlistDelta([], [{ qty: 2 }, { qty: 1 }])).toBe(-3)
	})

	it('is positive when orders were cancelled', () => {
		expect(wishlistDelta([{ qty: 2 }, { qty: 1 }], [{ qty: 1 }])).toBe(2)
	})

	it('is zero when totals match, ignoring negative garbage', () => {
		expect(wishlistDelta([{ qty: 2 }, { qty: -5 }], [{ qty: 2 }])).toBe(0)
	})
})

describe('applyWishlistDelta', () => {
	it('floors at zero', () => {
		expect(applyWishlistDelta(2, -3)).toBe(0)
		expect(applyWishlistDelta(2, -1)).toBe(1)
		expect(applyWishlistDelta(0, 2)).toBe(2)
	})
})
