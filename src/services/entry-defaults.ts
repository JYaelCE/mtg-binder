import type { CardCondition, CardVariant } from '../types'

/**
 * Session-sticky defaults for adding cards to collections — shared by the
 * add/quick-add/receive modals so "last used" means last used anywhere.
 */
export interface EntryDefaults {
	collectionPath: string | null
	variant: CardVariant
	condition: CardCondition
}

export const entryDefaults: EntryDefaults = {
	collectionPath: null,
	variant: 'normal',
	condition: 'NM',
}

export function rememberEntryDefaults(choice: Partial<EntryDefaults>): void {
	if (choice.collectionPath !== undefined) entryDefaults.collectionPath = choice.collectionPath
	if (choice.variant !== undefined) entryDefaults.variant = choice.variant
	if (choice.condition !== undefined) entryDefaults.condition = choice.condition
}
