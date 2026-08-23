import { App, TFile } from 'obsidian'
import type { CardCondition, CardVariant } from '../types'
import { isCardCondition, isCardVariant } from '../types'
import { isRecord } from '../utils/value-guards'
import { localIsoDate } from '../utils/date'
import { mergePaid } from '../domain/paid'

/** One line of a collection: a card in a specific variant + condition. */
export interface StoredEntry {
	id: string
	/** Wikilink to the card note, e.g. "[[Pikachu ex (SVI 45)]]". */
	link: string
	qty: number
	variant: CardVariant
	condition: CardCondition
	/**
	 * ISO date (YYYY-MM-DD) the card actually entered the collection —
	 * stamped when qty first goes above zero, never for checklist rows.
	 * Null on rows that predate this field.
	 */
	added: string | null
	/**
	 * Price paid PER COPY, in the user's currency. Batches merged into one
	 * line keep a quantity-weighted average. Null when never recorded.
	 */
	paid: number | null
}

function parsePaid(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : null
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/

function today(): string {
	return localIsoDate()
}

export interface EntryKey {
	id: string
	variant: CardVariant
	condition: CardCondition
}

/**
 * Reads/writes the `entries` array in a collection note's frontmatter.
 * Entries are keyed by (card id, variant, condition) — adding the same
 * key again merges quantities instead of duplicating lines.
 */
export class CollectionStore {
	constructor(private readonly app: App) {}

	readEntries(file: TFile): StoredEntry[] {
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter
		const raw: unknown = frontmatter?.entries
		if (!Array.isArray(raw)) return []

		return raw.flatMap((item: unknown): StoredEntry[] => {
			if (!isRecord(item)) return []
			const id = typeof item.id === 'string' && item.id.length > 0 ? item.id : null
			// qty 0 is valid: set-tracking collections list every card as a
			// checklist row before any copy is owned.
			const qty =
				typeof item.qty === 'number' && Number.isInteger(item.qty) && item.qty >= 0 ? item.qty : null
			if (!id || qty === null) return []
			return [
				{
					id,
					qty,
					link: typeof item.link === 'string' ? item.link : '',
					variant: isCardVariant(item.variant) ? item.variant : 'normal',
					condition: isCardCondition(item.condition) ? item.condition : 'NM',
					added:
						typeof item.added === 'string' && ISO_DATE.test(item.added)
							? item.added.slice(0, 10)
							: null,
					paid: parsePaid(item.paid),
				},
			]
		})
	}

	async addEntry(
		file: TFile,
		cardId: string,
		cardLink: string,
		qty: number,
		variant: CardVariant,
		condition: CardCondition,
		/** Insert the new line right after this entry instead of appending (variant splits). */
		afterKey?: EntryKey,
		/** Price paid per copy for THIS batch; merges as a weighted average. */
		paid?: number | null,
	): Promise<void> {
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			const raw: unknown = fm.entries
			const list: unknown[] = Array.isArray(raw) ? [...(raw as unknown[])] : []
			const index = list.findIndex((item) => matchesKey(item, { id: cardId, variant, condition }))
			if (index >= 0 && isRecord(list[index])) {
				const current = list[index]
				const currentQty = typeof current.qty === 'number' ? current.qty : 0
				const nextQty = currentQty + qty
				const mergedPaid = mergePaid(currentQty, parsePaid(current.paid), qty, paid ?? null)
				list[index] = {
					...current,
					qty: nextQty,
					// A checklist row receiving its first copies gets stamped now.
					...(nextQty > 0 && typeof current.added !== 'string' ? { added: today() } : {}),
					...(mergedPaid !== null ? { paid: mergedPaid } : {}),
				}
			} else {
				const entry = {
					id: cardId,
					link: cardLink,
					qty,
					variant,
					condition,
					...(qty > 0 ? { added: today() } : {}),
					...(paid !== null && paid !== undefined ? { paid: parsePaid(paid) } : {}),
				}
				const anchor = afterKey ? list.findIndex((item) => matchesKey(item, afterKey)) : -1
				if (anchor >= 0) {
					list.splice(anchor + 1, 0, entry)
				} else {
					list.push(entry)
				}
			}
			fm.entries = list
		})
	}

	/** Sets the quantity of an entry, clamping at 0 — the row stays as a checklist line. */
	async setQuantity(file: TFile, key: EntryKey, qty: number): Promise<void> {
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			const raw: unknown = fm.entries
			const list: unknown[] = Array.isArray(raw) ? [...(raw as unknown[])] : []
			const index = list.findIndex((item) => matchesKey(item, key))
			if (index < 0 || !isRecord(list[index])) return
			const current = list[index]
			const nextQty = Math.max(0, qty)
			const wasZero = typeof current.qty !== 'number' || current.qty <= 0
			list[index] = {
				...current,
				qty: nextQty,
				...(wasZero && nextQty > 0 && typeof current.added !== 'string'
					? { added: today() }
					: {}),
			}
			fm.entries = list
		})
	}

	/**
	 * Re-keys an entry to a new variant/condition. If a line with the target
	 * key already exists, quantities merge into it and the original line is
	 * removed — two paths to the same physical pile must not coexist.
	 */
	async updateEntryKey(
		file: TFile,
		key: EntryKey,
		variant: CardVariant,
		condition: CardCondition,
	): Promise<void> {
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			const raw: unknown = fm.entries
			const list: unknown[] = Array.isArray(raw) ? [...(raw as unknown[])] : []
			const index = list.findIndex((item) => matchesKey(item, key))
			if (index < 0 || !isRecord(list[index])) return

			const targetKey: EntryKey = { id: key.id, variant, condition }
			const target = list.findIndex((item, i) => i !== index && matchesKey(item, targetKey))
			if (target >= 0 && isRecord(list[target])) {
				const source = list[index]
				const sourceQty = typeof source.qty === 'number' ? source.qty : 0
				const targetQty = typeof list[target].qty === 'number' ? list[target].qty : 0
				list[target] = {
					...list[target],
					qty: targetQty + sourceQty,
					// The merged pile keeps its earliest known acquisition date.
					...(typeof list[target].added !== 'string' && typeof source.added === 'string'
						? { added: source.added }
						: {}),
				}
				list.splice(index, 1)
			} else {
				list[index] = { ...list[index], variant, condition }
			}
			fm.entries = list
		})
	}

	/**
	 * Inserts a full entry preserving its acquisition date; merges by key
	 * (quantities sum, the earliest known date wins). Used by moves.
	 */
	async upsertEntry(file: TFile, entry: StoredEntry): Promise<void> {
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			const raw: unknown = fm.entries
			const list: unknown[] = Array.isArray(raw) ? [...(raw as unknown[])] : []
			const key: EntryKey = { id: entry.id, variant: entry.variant, condition: entry.condition }
			const index = list.findIndex((item) => matchesKey(item, key))
			if (index >= 0 && isRecord(list[index])) {
				const current = list[index]
				const currentQty = typeof current.qty === 'number' ? current.qty : 0
				const currentAdded = typeof current.added === 'string' ? current.added : null
				const earliest =
					currentAdded && entry.added
						? (currentAdded < entry.added ? currentAdded : entry.added)
						: (currentAdded ?? entry.added)
				const mergedPaid = mergePaid(currentQty, parsePaid(current.paid), entry.qty, entry.paid)
				list[index] = {
					...current,
					qty: currentQty + entry.qty,
					...(earliest ? { added: earliest } : {}),
					...(mergedPaid !== null ? { paid: mergedPaid } : {}),
				}
			} else {
				list.push({
					id: entry.id,
					link: entry.link,
					qty: entry.qty,
					variant: entry.variant,
					condition: entry.condition,
					...(entry.added ? { added: entry.added } : {}),
					...(entry.paid !== null ? { paid: entry.paid } : {}),
				})
			}
			fm.entries = list
		})
	}

	/** Moves one line (qty, variant, condition and acquisition date) between collections. */
	async moveEntry(from: TFile, to: TFile, key: EntryKey): Promise<void> {
		const entry = this.readEntries(from).find(
			(item) => item.id === key.id && item.variant === key.variant && item.condition === key.condition,
		)
		if (!entry) return
		await this.upsertEntry(to, entry)
		await this.removeEntry(from, key)
	}

	/** Records (or clears, with null) the per-copy price paid for a line. */
	async setPaid(file: TFile, key: EntryKey, paid: number | null): Promise<void> {
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			const raw: unknown = fm.entries
			const list: unknown[] = Array.isArray(raw) ? [...(raw as unknown[])] : []
			const index = list.findIndex((item) => matchesKey(item, key))
			if (index < 0 || !isRecord(list[index])) return
			const entry: Record<string, unknown> = { ...list[index] }
			const value = paid === null ? null : parsePaid(paid)
			if (value !== null) entry.paid = value
			else delete entry.paid
			list[index] = entry
			fm.entries = list
		})
	}

	/** Deletes an entry line entirely (the explicit ×, as opposed to qty 0). */
	async removeEntry(file: TFile, key: EntryKey): Promise<void> {
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			const raw: unknown = fm.entries
			const list: unknown[] = Array.isArray(raw) ? [...(raw as unknown[])] : []
			const index = list.findIndex((item) => matchesKey(item, key))
			if (index < 0) return
			list.splice(index, 1)
			fm.entries = list
		})
	}

	/** Replaces the whole entries array in one write — used by set-collection creation. */
	async setEntries(file: TFile, entries: StoredEntry[]): Promise<void> {
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			fm.entries = entries.map((entry) => ({
				id: entry.id,
				link: entry.link,
				qty: entry.qty,
				variant: entry.variant,
				condition: entry.condition,
				...(entry.added ? { added: entry.added } : {}),
				...(entry.paid !== null ? { paid: entry.paid } : {}),
			}))
		})
	}
}

function matchesKey(item: unknown, key: EntryKey): boolean {
	if (!isRecord(item)) return false
	const variant = isCardVariant(item.variant) ? item.variant : 'normal'
	const condition = isCardCondition(item.condition) ? item.condition : 'NM'
	return item.id === key.id && variant === key.variant && condition === key.condition
}
