import { useIsMobile } from './useIsMobile'
import { useMediaQuery } from './useMediaQuery'

export interface LayoutMode {
	/** Narrow surface (phone or a slim side pane): stack, disclose, simplify. */
	narrow: boolean
	/**
	 * Coarse pointer (touch): native menus instead of <select> (an input
	 * focused inside view-content hides the view on mobile), visible labels
	 * instead of tooltips, 44px targets.
	 */
	coarse: boolean
}

/** Narrow decides LAYOUT; coarse decides INTERACTION. Desktop stays untouched. */
export function useLayoutMode(): LayoutMode {
	const mobile = useIsMobile()
	const narrowViewport = useMediaQuery('(max-width: 600px)')
	const coarsePointer = useMediaQuery('(pointer: coarse)')
	return { narrow: mobile || narrowViewport, coarse: mobile || coarsePointer }
}

/** Root-element classes the stylesheet keys the narrow/touch rules on. */
export function layoutClasses(mode: LayoutMode): string {
	return `${mode.narrow ? ' tcgb-narrow' : ''}${mode.coarse ? ' tcgb-touch' : ''}`
}
