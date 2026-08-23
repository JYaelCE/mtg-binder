import { useMemo } from 'react'
import type { CardMeta } from '../services/card-notes'
import { readAllocationState } from '../services/deck-availability'
import type { AllocationState } from '../services/deck-availability'
import type TcgBinderPlugin from '../main'

/**
 * One allocation snapshot per render: every collection and deck is read
 * once, then every deck/line question is answered from the result (the
 * dashboard used to rebuild ownership per deck — quadratic in decks).
 */
export function useAllocation(
	plugin: TcgBinderPlugin,
	cardIndex: Map<string, CardMeta>,
	version: number,
): AllocationState {
	// `version` is the vault change counter — the only reason to re-read.
	return useMemo(() => readAllocationState(plugin, cardIndex), [plugin, cardIndex, version])
}
