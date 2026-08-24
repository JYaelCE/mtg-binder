import { App, Modal, Setting, TFile } from 'obsidian'
import type { CardCondition, CardVariant } from '../types'
import { CARD_CONDITIONS, CARD_VARIANTS } from '../types'
import type { CardPreview } from './add-card-modal'
import { entryDefaults, rememberEntryDefaults } from '../services/entry-defaults'
import { t } from '../i18n'

export interface ReceiveChoice {
	collection: TFile
	quantity: number
	variant: CardVariant
	condition: CardCondition
	/** Price paid per copy; null when not recorded. */
	paid: number | null
	/** Deck the received copies should belong to (wishlist entry point only). */
	deck: TFile | null
}

export interface ReceiveOptions {
	/** Where the copies come from ("Liga ABC"); empty for "I have it". */
	from: string
	/** Prefilled and maximum quantity — receipts are per purchase and can be partial. */
	max: number
	/** Prefilled per-copy price (the purchase's recorded price). */
	price: number | null
	/** Decks offered for allocation; null hides the dropdown (deck context is implicit). */
	decks: TFile[] | null
	/** Collection matching the card's type — pre-selected over the sticky default. */
	preferredCollection?: TFile | null
}

/**
 * Registers copies that ARRIVED: into which collection, as what variant/
 * condition, how many (a package can bring only part of a purchase) and at
 * what price. One primary action — the flow is a single confirm when the
 * defaults are right.
 */
export class ReceiveModal extends Modal {
	constructor(
		app: App,
		private readonly preview: CardPreview,
		private readonly collections: TFile[],
		private readonly options: ReceiveOptions,
		private readonly onSubmit: (choice: ReceiveChoice) => void,
	) {
		super(app)
	}

	onOpen(): void {
		const { contentEl, options } = this
		this.setTitle(
			options.from.length > 0
				? t('acq.receive-title-from', { name: this.preview.name, from: options.from })
				: t('acq.receive-title', { name: this.preview.name }),
		)
		contentEl.empty()

		const previewEl = contentEl.createDiv('tcgb-add-preview')
		if (this.preview.image) {
			previewEl.createEl('img', {
				cls: 'tcgb-add-image',
				attr: { src: this.preview.image, alt: this.preview.name },
			})
		}
		previewEl.createDiv({ cls: 'tcgb-suggestion-meta', text: this.preview.metaLine })

		let collection =
			(options.preferredCollection && this.collections.includes(options.preferredCollection)
				? options.preferredCollection
				: null) ??
			this.collections.find((f) => f.path === entryDefaults.collectionPath) ??
			this.collections[0]
		let quantity = options.max
		let variant = entryDefaults.variant
		let condition = entryDefaults.condition
		let paid = options.price
		let deck: TFile | null = null

		const hint = contentEl.createEl('p', { cls: 'tcgb-receive-hint' })
		const renderHint = () => {
			if (options.from.length === 0) {
				hint.setText('')
				return
			}
			const remaining = Math.max(0, options.max - quantity)
			hint.setText(t('acq.receive-hint', { qty: options.max, from: options.from, remaining }))
		}
		renderHint()

		new Setting(contentEl).setName(t('add.quantity')).addText((text) => {
			text.inputEl.type = 'number'
			text.inputEl.min = '1'
			text.inputEl.max = String(options.max)
			text.setValue(String(quantity))
			text.onChange((value) => {
				quantity = Number(value)
				renderHint()
			})
		})

		new Setting(contentEl).setName(t('add.collection')).addDropdown((dd) => {
			this.collections.forEach((file, i) => {
				dd.addOption(String(i), file.basename)
			})
			dd.setValue(String(this.collections.indexOf(collection)))
			dd.onChange((value) => {
				collection = this.collections[Number(value)]
			})
		})

		new Setting(contentEl).setName(t('add.variant')).addDropdown((dd) => {
			for (const option of CARD_VARIANTS) dd.addOption(option, t(`variant.${option}`))
			dd.setValue(variant)
			dd.onChange((value) => {
				variant = value as CardVariant
			})
		})

		new Setting(contentEl).setName(t('add.condition')).addDropdown((dd) => {
			for (const option of CARD_CONDITIONS) dd.addOption(option, option)
			dd.setValue(condition)
			dd.onChange((value) => {
				condition = value as CardCondition
			})
		})

		new Setting(contentEl).setName(t('acq.paid')).addText((text) => {
			text.inputEl.type = 'number'
			text.inputEl.min = '0'
			text.inputEl.step = '0.01'
			if (paid !== null) text.setValue(String(paid))
			text.onChange((value) => {
				const parsed = Number(value)
				paid = value.length > 0 && Number.isFinite(parsed) && parsed >= 0 ? parsed : null
			})
		})

		if (this.options.decks && this.options.decks.length > 0) {
			const decks = this.options.decks
			new Setting(contentEl).setName(t('acq.receive-deck')).addDropdown((dd) => {
				dd.addOption('-1', t('acq.receive-deck-none'))
				decks.forEach((file, i) => {
					dd.addOption(String(i), file.basename)
				})
				dd.setValue('-1')
				dd.onChange((value) => {
					deck = value === '-1' ? null : decks[Number(value)]
				})
			})
		}

		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText(t('acq.receive-submit'))
				.setCta()
				.onClick(() => {
					const qty =
						Number.isInteger(quantity) && quantity > 0
							? Math.min(quantity, options.max)
							: options.max
					rememberEntryDefaults({ collectionPath: collection.path, variant, condition })
					this.close()
					this.onSubmit({ collection, quantity: qty, variant, condition, paid, deck })
				}),
		)
	}

	onClose(): void {
		this.contentEl.empty()
	}
}
