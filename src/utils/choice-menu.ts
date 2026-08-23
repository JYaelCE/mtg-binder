import { Menu } from 'obsidian'

/**
 * Native Obsidian menus as the touch replacement for <select> and crowded
 * toolbars: on mobile a Menu renders as a bottom sheet, needs no portal,
 * and never focuses an input inside view-content (which hides the view).
 */

export interface ChoiceOption<T extends string> {
	value: T
	label: string
}

type MenuAnchor = { x: number; y: number } | MouseEvent

function show(menu: Menu, anchor: MenuAnchor): void {
	if (anchor instanceof MouseEvent) menu.showAtMouseEvent(anchor)
	else menu.showAtPosition(anchor)
}

/** Single-choice menu with a check on the current value. */
export function showChoiceMenu<T extends string>(
	anchor: MenuAnchor,
	options: ChoiceOption<T>[],
	current: T | null,
	onSelect: (value: T) => void,
): void {
	const menu = new Menu()
	for (const option of options) {
		menu.addItem((item) => {
			item.setTitle(option.label)
				.setChecked(option.value === current)
				.onClick(() => {
					onSelect(option.value)
				})
		})
	}
	show(menu, anchor)
}

export interface ActionItem {
	label: string
	icon?: string
	danger?: boolean
	onClick: () => void
}

/** Overflow ("⋯") menu for secondary toolbar actions. */
export function showActionMenu(anchor: MenuAnchor, items: ActionItem[]): void {
	const menu = new Menu()
	for (const action of items) {
		menu.addItem((item) => {
			item.setTitle(action.label).onClick(() => {
				action.onClick()
			})
			if (action.icon) item.setIcon(action.icon)
			if (action.danger) item.setWarning(true)
		})
	}
	show(menu, anchor)
}
