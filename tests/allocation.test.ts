import { describe, expect, it } from 'vitest'
import {
	analyzeDeck,
	buildAllocationSnapshot,
	clampAllocations,
	planBuild,
	planBuildAll,
	planDisassemble,
	sortDecksForBuild,
} from '../src/domain/allocation'
import type { AllocationDeck, AllocationDeckLine, AllocationInput } from '../src/domain/allocation'
import type { DeckStatus } from '../src/domain/deck-status'

// Two printings of Switch share one functional key; Nest Ball is its own card.
const keyOf = new Map<string, string>([
	['svi-45', 'switch'],
	['meg-12', 'switch'],
	['svi-181', 'nest ball'],
])

function line(id: string, qty: number, allocated = 0, ordered = 0): AllocationDeckLine {
	return { id, qty, allocated, ordered }
}

function deck(
	path: string,
	lines: AllocationDeckLine[],
	options: { status?: DeckStatus; sortOrder?: number | null; name?: string } = {},
): AllocationDeck {
	return {
		path,
		name: options.name ?? path,
		status: options.status ?? 'assembled',
		sortOrder: options.sortOrder ?? null,
		lines,
	}
}

function input(collections: { id: string; qty: number }[], decks: AllocationDeck[]): AllocationInput {
	return { keyOf, collections, decks }
}

describe('buildAllocationSnapshot', () => {
	it('sums owned copies by functional key across collections and printings', () => {
		const snapshot = buildAllocationSnapshot(
			input(
				[
					{ id: 'svi-45', qty: 2 },
					{ id: 'meg-12', qty: 1 },
					{ id: 'svi-45', qty: 1 },
				],
				[],
			),
		)
		expect(snapshot.pools.get('switch')).toMatchObject({ owned: 4, allocated: 0, free: 4, over: 0 })
	})

	it('takes allocated copies out of the free pool and reports who holds them', () => {
		const snapshot = buildAllocationSnapshot(
			input(
				[{ id: 'svi-45', qty: 4 }],
				[deck('A', [line('svi-45', 4, 3)]), deck('B', [line('meg-12', 2, 1)])],
			),
		)
		const pool = snapshot.pools.get('switch')
		expect(pool).toMatchObject({ owned: 4, allocated: 4, free: 0, over: 0 })
		expect([...(pool?.heldBy ?? [])]).toEqual([
			['A', 3],
			['B', 1],
		])
	})

	it('flags over-allocation without inflating the free pool', () => {
		const snapshot = buildAllocationSnapshot(
			input([{ id: 'svi-45', qty: 2 }], [deck('A', [line('svi-45', 4, 4)])]),
		)
		expect(snapshot.pools.get('switch')).toMatchObject({ owned: 2, allocated: 4, free: 0, over: 2 })
		expect(snapshot.overAllocated.map((pool) => pool.key)).toEqual(['switch'])
		// The deck keeps what it holds — over-allocation is a warning, not a clamp.
		expect(snapshot.decks.get('A')).toMatchObject({ allocated: 4, missing: 0, fullyAllocated: true })
	})

	it('ignores zero-quantity (checklist) collection lines', () => {
		const snapshot = buildAllocationSnapshot(input([{ id: 'svi-45', qty: 0 }], []))
		expect(snapshot.pools.has('switch')).toBe(false)
	})
})

describe('two decks sharing one playset (regression: mutual subtraction)', () => {
	it('only the deck holding the copies is covered; the other misses them', () => {
		const snapshot = buildAllocationSnapshot(
			input(
				[{ id: 'svi-45', qty: 4 }],
				[deck('A', [line('svi-45', 4, 4)]), deck('B', [line('svi-45', 4)])],
			),
		)
		expect(snapshot.decks.get('A')?.missing).toBe(0)
		expect(snapshot.decks.get('B')?.missing).toBe(4)
		expect(snapshot.overAllocated).toEqual([])
	})

	it('splits fairly when each deck holds half', () => {
		const snapshot = buildAllocationSnapshot(
			input(
				[{ id: 'svi-45', qty: 4 }],
				[deck('A', [line('svi-45', 4, 2)]), deck('B', [line('svi-45', 4, 2)])],
			),
		)
		expect(snapshot.decks.get('A')?.missing).toBe(2)
		expect(snapshot.decks.get('B')?.missing).toBe(2)
	})

	it('lets every deck see unallocated copies as available', () => {
		const snapshot = buildAllocationSnapshot(
			input([{ id: 'svi-45', qty: 4 }], [deck('A', [line('svi-45', 4)]), deck('B', [line('svi-45', 4)])]),
		)
		expect(snapshot.decks.get('A')?.missing).toBe(0)
		expect(snapshot.decks.get('B')?.missing).toBe(0)
	})
})

describe('analyzeDeck', () => {
	it('covers own allocations first, then the free pool in deck order', () => {
		const d = deck('A', [line('svi-45', 2, 2), line('meg-12', 2)])
		const snapshot = buildAllocationSnapshot(input([{ id: 'svi-45', qty: 3 }], [d]))
		const rows = analyzeDeck(snapshot, d, keyOf)
		expect(rows.map((row) => row.covered)).toEqual([2, 1])
		expect(rows.map((row) => row.missing)).toEqual([0, 1])
		expect(rows.map((row) => row.firstOfKey)).toEqual([true, false])
		expect(rows[0]).toMatchObject({ owned: 3, free: 1, heldElsewhere: 0 })
	})

	it('reports copies held by other decks at name level', () => {
		const d = deck('B', [line('svi-45', 4)])
		const snapshot = buildAllocationSnapshot(
			input([{ id: 'svi-45', qty: 4 }], [deck('A', [line('meg-12', 4, 3)]), d]),
		)
		const [row] = analyzeDeck(snapshot, d, keyOf)
		expect(row).toMatchObject({ owned: 4, free: 1, heldElsewhere: 3, covered: 1, missing: 3 })
	})

	it('clamps ordered copies to what is missing', () => {
		const d = deck('A', [line('svi-45', 4, 0, 5)])
		const snapshot = buildAllocationSnapshot(input([{ id: 'svi-45', qty: 2 }], [d]))
		const [row] = analyzeDeck(snapshot, d, keyOf)
		expect(row).toMatchObject({ missing: 2, ordered: 2, toBuy: 0 })
	})

	it('treats allocated above qty as qty', () => {
		const d = deck('A', [line('svi-45', 2, 5)])
		const snapshot = buildAllocationSnapshot(input([{ id: 'svi-45', qty: 2 }], [d]))
		const [row] = analyzeDeck(snapshot, d, keyOf)
		expect(row).toMatchObject({ allocated: 2, covered: 2, missing: 0 })
		expect(snapshot.pools.get('switch')?.allocated).toBe(2)
	})

	it('falls back to the printing id when no key is known', () => {
		const d = deck('A', [line('unknown-1', 2)])
		const snapshot = buildAllocationSnapshot(input([{ id: 'unknown-1', qty: 1 }], [d]))
		const [row] = analyzeDeck(snapshot, d, keyOf)
		expect(row).toMatchObject({ key: 'unknown-1', covered: 1, missing: 1 })
	})

	it('keeps the partial-receipt story straight: 3 bought from 3 places, 1 arrived', () => {
		// Before: need 3, nothing owned, 3 on the way from three sellers.
		const before = deck('A', [line('svi-45', 3, 0, 3)])
		let snapshot = buildAllocationSnapshot(input([], [before]))
		expect(analyzeDeck(snapshot, before, keyOf)[0]).toMatchObject({ missing: 3, ordered: 3, toBuy: 0 })
		// After receiving one: it entered the collection and the deck holds it;
		// the other two purchases are still on the way.
		const after = deck('A', [line('svi-45', 3, 1, 2)])
		snapshot = buildAllocationSnapshot(input([{ id: 'svi-45', qty: 1 }], [after]))
		expect(analyzeDeck(snapshot, after, keyOf)[0]).toMatchObject({
			allocated: 1,
			missing: 2,
			ordered: 2,
			toBuy: 0,
		})
		expect(snapshot.decks.get('A')).toMatchObject({ need: 3, allocated: 1, missing: 2, toBuy: 0 })
	})
})

describe('DeckSummary', () => {
	it('is fully allocated only when every listed copy is held', () => {
		const full = deck('A', [line('svi-45', 2, 2), line('svi-181', 1, 1)])
		const partial = deck('B', [line('svi-45', 2, 1)])
		const empty = deck('C', [])
		const snapshot = buildAllocationSnapshot(input([{ id: 'svi-45', qty: 3 }], [full, partial, empty]))
		expect(snapshot.decks.get('A')?.fullyAllocated).toBe(true)
		expect(snapshot.decks.get('B')?.fullyAllocated).toBe(false)
		expect(snapshot.decks.get('C')?.fullyAllocated).toBe(false)
	})
})

describe('planBuild', () => {
	it('takes free copies greedily in deck order and returns only changed lines', () => {
		const d = deck('A', [line('svi-45', 2), line('meg-12', 2), line('svi-181', 4, 4)])
		const snapshot = buildAllocationSnapshot(
			input(
				[
					{ id: 'svi-45', qty: 3 },
					{ id: 'svi-181', qty: 4 },
				],
				[d],
			),
		)
		expect(planBuild(snapshot, d, keyOf)).toEqual([
			{ path: 'A', id: 'svi-45', allocated: 2 },
			{ path: 'A', id: 'meg-12', allocated: 1 },
		])
	})

	it('is a no-op on a fully allocated deck', () => {
		const d = deck('A', [line('svi-45', 2, 2)])
		const snapshot = buildAllocationSnapshot(input([{ id: 'svi-45', qty: 4 }], [d]))
		expect(planBuild(snapshot, d, keyOf)).toEqual([])
	})

	it('never allocates copies held by another deck', () => {
		const d = deck('B', [line('svi-45', 4)])
		const snapshot = buildAllocationSnapshot(
			input([{ id: 'svi-45', qty: 4 }], [deck('A', [line('svi-45', 4, 4)]), d]),
		)
		expect(planBuild(snapshot, d, keyOf)).toEqual([])
	})

	it('tops up a partially held line', () => {
		const d = deck('A', [line('svi-45', 4, 1)])
		const snapshot = buildAllocationSnapshot(input([{ id: 'svi-45', qty: 2 }], [d]))
		expect(planBuild(snapshot, d, keyOf)).toEqual([{ path: 'A', id: 'svi-45', allocated: 2 }])
	})
})

describe('planBuildAll', () => {
	it('builds in priority order so later decks see what is left', () => {
		const first = deck('Second by name', [line('svi-45', 3)], { sortOrder: 0 })
		const second = deck('First by name', [line('svi-45', 3)], { sortOrder: 1 })
		const changes = planBuildAll(input([{ id: 'svi-45', qty: 4 }], [second, first]), [second, first])
		expect(changes).toEqual([
			{ path: 'Second by name', id: 'svi-45', allocated: 3 },
			{ path: 'First by name', id: 'svi-45', allocated: 1 },
		])
	})

	it('skips lists and puts assembled decks before building ones', () => {
		const building = deck('building', [line('svi-45', 2)], { status: 'building', sortOrder: 0 })
		const assembled = deck('assembled', [line('svi-45', 2)], { status: 'assembled', sortOrder: 5 })
		const list = deck('list', [line('svi-45', 2)], { status: 'list', sortOrder: 0 })
		const changes = planBuildAll(input([{ id: 'svi-45', qty: 3 }], [building, assembled, list]), [
			building,
			assembled,
			list,
		])
		expect(changes).toEqual([
			{ path: 'assembled', id: 'svi-45', allocated: 2 },
			{ path: 'building', id: 'svi-45', allocated: 1 },
		])
	})
})

describe('sortDecksForBuild', () => {
	it('orders by status, then dashboard position (null last), then name', () => {
		const decks = [
			deck('b', [], { status: 'building', sortOrder: 0, name: 'B' }),
			deck('z', [], { status: 'assembled', sortOrder: null, name: 'Z' }),
			deck('y', [], { status: 'assembled', sortOrder: null, name: 'Y' }),
			deck('a', [], { status: 'assembled', sortOrder: 3, name: 'A' }),
			deck('l', [], { status: 'list', sortOrder: 0, name: 'L' }),
		]
		expect(sortDecksForBuild(decks).map((d) => d.path)).toEqual(['a', 'y', 'z', 'b', 'l'])
	})
})

describe('planDisassemble / clampAllocations', () => {
	it('releases every held line and leaves the rest untouched', () => {
		const d = deck('A', [line('svi-45', 4, 4), line('svi-181', 2), line('meg-12', 1, 1)])
		expect(planDisassemble(d)).toEqual([
			{ path: 'A', id: 'svi-45', allocated: 0 },
			{ path: 'A', id: 'meg-12', allocated: 0 },
		])
	})

	it('clamps only lines holding more than they list', () => {
		const d = deck('A', [line('svi-45', 2, 4), line('svi-181', 2, 2), line('meg-12', 0, 1)])
		expect(clampAllocations(d)).toEqual([
			{ path: 'A', id: 'svi-45', allocated: 2 },
			{ path: 'A', id: 'meg-12', allocated: 0 },
		])
	})
})
