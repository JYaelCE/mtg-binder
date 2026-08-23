/**
 * Lifecycle of a deck, as stated by the user:
 * - 'assembled': physically built — expected to hold every copy it lists.
 * - 'building': the user is actively hunting its cards.
 * - 'list': just an idea/reference.
 *
 * Status is intent; which copies the deck actually holds is the
 * `allocated` count on each line (see domain/allocation.ts).
 */
export type DeckStatus = 'assembled' | 'building' | 'list'

export function isDeckStatus(value: unknown): value is DeckStatus {
	return value === 'assembled' || value === 'building' || value === 'list'
}
