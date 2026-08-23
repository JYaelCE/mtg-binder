import type { TFile } from 'obsidian'
import { functionalKey } from '../domain/text-match'
import { buildAllocationSnapshot } from '../domain/allocation'
import type { AllocationDeck, AllocationInput, AllocationSnapshot } from '../domain/allocation'
import type { DeckStatus } from '../domain/deck-status'
import type { CardMeta } from './card-notes'
import type TcgBinderPlugin from '../main'

/**
 * Bridge between the vault (collections/decks as notes) and the pure
 * allocation model in domain/allocation.ts. Identity is the functional
 * card name: any printing of "Switch" satisfies a deck line for "Switch".
 */

export function keyFor(cardIndex: Map<string, CardMeta>, id: string): string {
	const meta = cardIndex.get(id)
	return functionalKey(meta?.nameEn ?? null, meta?.name ?? null, id)
}

/** id → functional key for every id the caller will look up. */
export function keyMapFrom(cardIndex: Map<string, CardMeta>, ids: Iterable<string>): Map<string, string> {
	const keyOf = new Map<string, string>()
	for (const id of ids) if (!keyOf.has(id)) keyOf.set(id, keyFor(cardIndex, id))
	return keyOf
}

export function toAllocationDeck(plugin: TcgBinderPlugin, deck: TFile): AllocationDeck {
	return {
		path: deck.path,
		name: deck.basename,
		status: plugin.decks.readStatus(deck),
		sortOrder: plugin.store.getSortOrder(deck),
		lines: plugin.decks.readEntries(deck).map((entry) => ({
			id: entry.id,
			qty: entry.qty,
			allocated: entry.allocated,
			ordered: entry.ordered,
		})),
	}
}

/** Reads every non-wishlist collection and every deck into plain data for the domain. */
export function buildAllocationInput(plugin: TcgBinderPlugin, cardIndex: Map<string, CardMeta>): AllocationInput {
	const collections: AllocationInput['collections'] = []
	const ids = new Set<string>()
	for (const collection of plugin.store.listFiles('collection')) {
		if (plugin.store.getRole(collection) === 'wishlist') continue
		for (const entry of plugin.collections.readEntries(collection)) {
			collections.push({ id: entry.id, qty: entry.qty })
			ids.add(entry.id)
		}
	}
	const decks = plugin.store.listFiles('deck').map((deck) => toAllocationDeck(plugin, deck))
	for (const deck of decks) for (const line of deck.lines) ids.add(line.id)
	return { keyOf: keyMapFrom(cardIndex, ids), collections, decks }
}

export interface AllocationState {
	input: AllocationInput
	snapshot: AllocationSnapshot
}

export function readAllocationState(plugin: TcgBinderPlugin, cardIndex: Map<string, CardMeta>): AllocationState {
	const input = buildAllocationInput(plugin, cardIndex)
	return { input, snapshot: buildAllocationSnapshot(input) }
}

export interface DeckUsage {
	path: string
	name: string
	/** Copies the deck lists. */
	qty: number
	/** Copies the deck holds. */
	allocated: number
	status: DeckStatus
}

/**
 * The decks that run a card, matched by functional identity (any printing
 * of the same name counts). Powers the card detail's "in decks" line.
 */
export function deckUsageFor(plugin: TcgBinderPlugin, card: CardMeta): DeckUsage[] {
	const cardIndex = plugin.cardNotes.buildIndex()
	const key = functionalKey(card.nameEn, card.name, card.cardId)
	const usage: DeckUsage[] = []
	for (const deck of plugin.store.listFiles('deck')) {
		let qty = 0
		let allocated = 0
		for (const entry of plugin.decks.readEntries(deck)) {
			if (keyFor(cardIndex, entry.id) === key || entry.id === card.cardId) {
				qty += entry.qty
				allocated += entry.allocated
			}
		}
		if (qty > 0) {
			usage.push({
				path: deck.path,
				name: deck.basename,
				qty,
				allocated,
				status: plugin.decks.readStatus(deck),
			})
		}
	}
	return usage.sort((a, b) => a.name.localeCompare(b.name))
}
