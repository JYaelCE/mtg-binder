/**
 * The wishlist mirrors "still to buy": placing an order takes copies off
 * it, cancelling puts them back. These helpers keep that arithmetic pure
 * and testable; the caller applies the result to the wishlist note.
 */

export interface OrderQty {
	qty: number
}

/**
 * How the wishlist should move when a line's orders change from `prev` to
 * `next`: negative when more copies were ordered (wishlist shrinks),
 * positive when orders were cancelled (wishlist grows back).
 */
export function wishlistDelta(prev: OrderQty[], next: OrderQty[]): number {
	const sum = (orders: OrderQty[]) => orders.reduce((total, order) => total + Math.max(0, order.qty), 0)
	return sum(prev) - sum(next)
}

/** Applies a delta to a wishlist quantity, never going below zero. */
export function applyWishlistDelta(current: number, delta: number): number {
	return Math.max(0, current + delta)
}
