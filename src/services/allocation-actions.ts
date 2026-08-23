import type { TFile } from 'obsidian'
import { planBuild, planBuildAll, planDisassemble } from '../domain/allocation'
import type { AllocationChange } from '../domain/allocation'
import { readAllocationState, toAllocationDeck } from './deck-availability'
import type TcgBinderPlugin from '../main'

/** Writes planner output to the vault — one frontmatter write per deck. */
export async function applyAllocationChanges(plugin: TcgBinderPlugin, changes: AllocationChange[]): Promise<void> {
	const byDeck = new Map<string, { id: string; allocated: number }[]>()
	for (const change of changes) {
		const list = byDeck.get(change.path) ?? []
		list.push({ id: change.id, allocated: change.allocated })
		byDeck.set(change.path, list)
	}
	for (const [path, list] of byDeck) {
		const file = plugin.app.vault.getFileByPath(path)
		if (file) await plugin.decks.setAllocations(file, list)
	}
}

export interface BuildResult {
	/** Copies newly taken from the free pool. */
	allocated: number
	/** Copies the deck still lacks after the build. */
	missing: number
	/** Copies the deck holds after the build. */
	held: number
	need: number
}

/** Allocates every free copy the deck can use, in deck order. */
export async function buildDeck(plugin: TcgBinderPlugin, deck: TFile): Promise<BuildResult> {
	const cardIndex = plugin.cardNotes.buildIndex()
	const { input, snapshot } = readAllocationState(plugin, cardIndex)
	const target = toAllocationDeck(plugin, deck)
	const changes = planBuild(snapshot, target, input.keyOf)
	await applyAllocationChanges(plugin, changes)
	const before = snapshot.decks.get(deck.path)
	const gained = changes.reduce((sum, change) => {
		const line = target.lines.find((entry) => entry.id === change.id)
		return sum + (change.allocated - Math.min(line?.qty ?? 0, line?.allocated ?? 0))
	}, 0)
	const held = (before?.allocated ?? 0) + gained
	const need = before?.need ?? 0
	return { allocated: gained, held, need, missing: Math.max(0, need - held) }
}

/** Builds every assembled/building deck in dashboard order; lists are skipped. */
export async function buildAllDecks(
	plugin: TcgBinderPlugin,
	filter?: (deck: TFile) => boolean,
): Promise<{ decks: number; allocated: number }> {
	const cardIndex = plugin.cardNotes.buildIndex()
	const { input } = readAllocationState(plugin, cardIndex)
	const files = plugin.store.listFiles('deck').filter((deck) => (filter ? filter(deck) : true))
	const paths = new Set(files.map((deck) => deck.path))
	const targets = input.decks.filter((deck) => paths.has(deck.path))
	const changes = planBuildAll(input, targets)
	await applyAllocationChanges(plugin, changes)
	const touched = new Set(changes.map((change) => change.path))
	const allocated = changes.reduce((sum, change) => {
		const line = targets
			.find((deck) => deck.path === change.path)
			?.lines.find((entry) => entry.id === change.id)
		return sum + (change.allocated - Math.min(line?.qty ?? 0, line?.allocated ?? 0))
	}, 0)
	return { decks: touched.size, allocated }
}

/** Releases every copy the deck holds back to the free pool. */
export async function disassembleDeck(plugin: TcgBinderPlugin, deck: TFile): Promise<number> {
	const target = toAllocationDeck(plugin, deck)
	const changes = planDisassemble(target)
	await applyAllocationChanges(plugin, changes)
	return target.lines.reduce((sum, line) => sum + Math.min(line.qty, line.allocated), 0)
}
