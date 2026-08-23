import { coverLines } from './deck-coverage'
import type { DeckStatus } from './deck-status'

/**
 * Explicit allocation model.
 *
 * Ownership lives in collections. A deck only "holds" the copies explicitly
 * allocated to it (`allocated` on each decklist line); everything else is a
 * FREE pool shared by every deck. For a deck D and a card key:
 *
 *   free        = max(0, owned − Σ allocated across ALL decks)
 *   available_D = allocated_D + free
 *   missing_D   = max(0, qty_D − available_D)
 *
 * No deck ever subtracts another deck's list — only real allocations take
 * copies out of the pool — so the numbers are deterministic and explainable
 * ("4 owned · 1 free · 3 held by other decks").
 *
 * Identity is by functional key (any printing of the same name is the same
 * card for the game); the caller resolves ids to keys via `keyOf`.
 */

export interface AllocationCollectionLine {
	id: string
	qty: number
}

export interface AllocationDeckLine {
	id: string
	qty: number
	/** Copies this line holds. Values above qty are treated as qty. */
	allocated: number
	/** Copies bought and on the way (sum of the line's orders). */
	ordered: number
}

export interface AllocationDeck {
	path: string
	name: string
	status: DeckStatus
	/** Dashboard position; null sorts last (then A–Z by name). */
	sortOrder: number | null
	lines: AllocationDeckLine[]
}

export interface AllocationInput {
	/** Printing id → functional key. Ids absent from the map key by themselves. */
	keyOf: ReadonlyMap<string, string>
	/** Lines of every non-wishlist collection. */
	collections: AllocationCollectionLine[]
	decks: AllocationDeck[]
}

export interface PoolEntry {
	key: string
	/** Copies in collections. */
	owned: number
	/** Σ allocated across all decks. */
	allocated: number
	/** max(0, owned − allocated). */
	free: number
	/** max(0, allocated − owned): decks claim more than the user owns. */
	over: number
	/** Copies held per deck path. */
	heldBy: ReadonlyMap<string, number>
}

export interface DeckSummary {
	path: string
	/** Σ qty. */
	need: number
	/** Σ allocated (clamped per line). */
	allocated: number
	missing: number
	/** Missing copies not yet bought. */
	toBuy: number
	/** Every listed copy is held by the deck. */
	fullyAllocated: boolean
}

export interface AllocationSnapshot {
	pools: ReadonlyMap<string, PoolEntry>
	decks: ReadonlyMap<string, DeckSummary>
	/** Pools where decks hold more than the user owns. */
	overAllocated: PoolEntry[]
}

export interface DeckLineAvailability {
	id: string
	key: string
	qty: number
	/** Copies this line holds (clamped to qty). */
	allocated: number
	/** allocated + the share of the free pool assigned to this printing. */
	covered: number
	missing: number
	/** Of the missing copies, already bought and on the way. */
	ordered: number
	/** Missing copies still to buy. */
	toBuy: number
	/** Name-level figures, identical for every printing of the key. */
	owned: number
	free: number
	heldElsewhere: number
	/** True on the first printing of each key — show the explanation once. */
	firstOfKey: boolean
}

/** One allocation write: the line's new absolute `allocated` value. */
export interface AllocationChange {
	path: string
	id: string
	allocated: number
}

export function resolveKey(keyOf: ReadonlyMap<string, string>, id: string): string {
	return keyOf.get(id) ?? id
}

function clampAllocated(line: AllocationDeckLine): number {
	return Math.max(0, Math.min(line.qty, line.allocated))
}

const EMPTY_POOL: Omit<PoolEntry, 'key'> = {
	owned: 0,
	allocated: 0,
	free: 0,
	over: 0,
	heldBy: new Map<string, number>(),
}

function poolOf(pools: ReadonlyMap<string, PoolEntry>, key: string): PoolEntry {
	return pools.get(key) ?? { key, ...EMPTY_POOL }
}

interface MutablePool {
	key: string
	owned: number
	allocated: number
	heldBy: Map<string, number>
}

function buildPools(input: AllocationInput): Map<string, PoolEntry> {
	const working = new Map<string, MutablePool>()
	const pool = (key: string): MutablePool => {
		let entry = working.get(key)
		if (!entry) {
			entry = { key, owned: 0, allocated: 0, heldBy: new Map() }
			working.set(key, entry)
		}
		return entry
	}
	for (const line of input.collections) {
		if (line.qty > 0) pool(resolveKey(input.keyOf, line.id)).owned += line.qty
	}
	for (const deck of input.decks) {
		for (const line of deck.lines) {
			const held = clampAllocated(line)
			if (held === 0) continue
			const entry = pool(resolveKey(input.keyOf, line.id))
			entry.allocated += held
			entry.heldBy.set(deck.path, (entry.heldBy.get(deck.path) ?? 0) + held)
		}
	}
	const pools = new Map<string, PoolEntry>()
	for (const [key, entry] of working) {
		pools.set(key, {
			key,
			owned: entry.owned,
			allocated: entry.allocated,
			free: Math.max(0, entry.owned - entry.allocated),
			over: Math.max(0, entry.allocated - entry.owned),
			heldBy: entry.heldBy,
		})
	}
	return pools
}

/**
 * Per-printing availability of a deck: each line keeps what it holds, then
 * the free pool covers the remaining gaps in deck order (`coverLines`), so
 * the same-name printings of a deck share one pool without double counting.
 */
export function analyzeDeck(
	snapshot: AllocationSnapshot,
	deck: AllocationDeck,
	keyOf: ReadonlyMap<string, string>,
): DeckLineAvailability[] {
	const groups = new Map<string, number[]>()
	deck.lines.forEach((line, index) => {
		const key = resolveKey(keyOf, line.id)
		const group = groups.get(key)
		if (group) group.push(index)
		else groups.set(key, [index])
	})
	const result: DeckLineAvailability[] = new Array<DeckLineAvailability>(deck.lines.length)
	for (const [key, indexes] of groups) {
		const pool = poolOf(snapshot.pools, key)
		const lines = indexes.map((i) => deck.lines[i])
		const held = lines.map(clampAllocated)
		const heldHere = held.reduce((sum, n) => sum + n, 0)
		const gaps = lines.map((line, i) => ({ qty: line.qty - held[i] }))
		const fromPool = coverLines(gaps, pool.free)
		indexes.forEach((lineIndex, i) => {
			const line = lines[i]
			const covered = held[i] + fromPool[i]
			const missing = Math.max(0, line.qty - covered)
			const ordered = Math.max(0, Math.min(line.ordered, missing))
			result[lineIndex] = {
				id: line.id,
				key,
				qty: line.qty,
				allocated: held[i],
				covered,
				missing,
				ordered,
				toBuy: missing - ordered,
				owned: pool.owned,
				free: pool.free,
				heldElsewhere: Math.max(0, pool.allocated - heldHere),
				firstOfKey: i === 0,
			}
		})
	}
	return result
}

function summarize(path: string, lines: DeckLineAvailability[]): DeckSummary {
	const need = lines.reduce((sum, line) => sum + line.qty, 0)
	const allocated = lines.reduce((sum, line) => sum + line.allocated, 0)
	return {
		path,
		need,
		allocated,
		missing: lines.reduce((sum, line) => sum + line.missing, 0),
		toBuy: lines.reduce((sum, line) => sum + line.toBuy, 0),
		fullyAllocated: need > 0 && allocated === need,
	}
}

export function buildAllocationSnapshot(input: AllocationInput): AllocationSnapshot {
	const pools = buildPools(input)
	const partial: AllocationSnapshot = { pools, decks: new Map(), overAllocated: [] }
	const decks = new Map<string, DeckSummary>()
	for (const deck of input.decks) {
		decks.set(deck.path, summarize(deck.path, analyzeDeck(partial, deck, input.keyOf)))
	}
	const overAllocated = [...pools.values()]
		.filter((pool) => pool.over > 0)
		.sort((a, b) => b.over - a.over || a.key.localeCompare(b.key))
	return { pools, decks, overAllocated }
}

/** Build order: assembled decks first, then building, each by dashboard position (null last, then A–Z). */
export function sortDecksForBuild(decks: AllocationDeck[]): AllocationDeck[] {
	const rank = (status: DeckStatus) => (status === 'assembled' ? 0 : status === 'building' ? 1 : 2)
	return [...decks].sort(
		(a, b) =>
			rank(a.status) - rank(b.status) ||
			(a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER) ||
			a.name.localeCompare(b.name),
	)
}

/** Greedy build against a mutable free pool, shared across decks by planBuildAll. */
function planBuildFrom(
	free: Map<string, number>,
	deck: AllocationDeck,
	keyOf: ReadonlyMap<string, string>,
): AllocationChange[] {
	const changes: AllocationChange[] = []
	for (const line of deck.lines) {
		const key = resolveKey(keyOf, line.id)
		const held = clampAllocated(line)
		const gap = line.qty - held
		const available = free.get(key) ?? 0
		const take = Math.min(gap, available)
		if (take <= 0) continue
		free.set(key, available - take)
		changes.push({ path: deck.path, id: line.id, allocated: held + take })
	}
	return changes
}

function freePoolOf(snapshot: AllocationSnapshot): Map<string, number> {
	const free = new Map<string, number>()
	for (const [key, pool] of snapshot.pools) if (pool.free > 0) free.set(key, pool.free)
	return free
}

/**
 * Allocates free copies to a deck, line by line in deck order, until each
 * line is full or the pool is empty. Returns only the lines that change.
 */
export function planBuild(
	snapshot: AllocationSnapshot,
	deck: AllocationDeck,
	keyOf: ReadonlyMap<string, string>,
): AllocationChange[] {
	return planBuildFrom(freePoolOf(snapshot), deck, keyOf)
}

/**
 * Builds several decks in priority order (`sortDecksForBuild`); each deck
 * sees the pool left by the previous ones. Lists are never built.
 */
export function planBuildAll(input: AllocationInput, decks: AllocationDeck[]): AllocationChange[] {
	const free = freePoolOf(buildAllocationSnapshot(input))
	const changes: AllocationChange[] = []
	for (const deck of sortDecksForBuild(decks)) {
		if (deck.status === 'list') continue
		changes.push(...planBuildFrom(free, deck, input.keyOf))
	}
	return changes
}

/** Releases every copy the deck holds back to the free pool. */
export function planDisassemble(deck: AllocationDeck): AllocationChange[] {
	return deck.lines
		.filter((line) => clampAllocated(line) > 0)
		.map((line) => ({ path: deck.path, id: line.id, allocated: 0 }))
}

/** Lines holding more copies than they list (after a qty edit) → allocated = qty. */
export function clampAllocations(deck: AllocationDeck): AllocationChange[] {
	return deck.lines
		.filter((line) => line.allocated > line.qty)
		.map((line) => ({ path: deck.path, id: line.id, allocated: Math.max(0, line.qty) }))
}
