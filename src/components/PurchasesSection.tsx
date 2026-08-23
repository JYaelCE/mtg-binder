import { useMemo } from 'react'
import type { TFile } from 'obsidian'
import { useApp } from '../context'
import { t } from '../i18n'
import { analyzeDeck } from '../domain/allocation'
import { summarizePurchases } from '../domain/purchases'
import type { CardMeta } from '../services/card-notes'
import type { AllocationState } from '../services/deck-availability'
import type { DeckOrder, DeckStoredEntry } from '../services/deck-store'
import { ConfirmModal } from '../modals/confirm-modal'
import type TcgBinderPlugin from '../main'

interface PurchasesSectionProps {
	plugin: TcgBinderPlugin
	decks: TFile[]
	cardIndex: Map<string, CardMeta>
	allocation: AllocationState
	onOpenDeck: (deck: TFile) => void
}

interface PurchaseRow {
	deck: TFile
	entry: DeckStoredEntry
	orderIndex: number
	order: DeckOrder
	meta: CardMeta | null
}

/**
 * Every purchase in transit, across every deck, in one place — so "what am
 * I waiting for?" has an answer without opening deck by deck. Receiving or
 * cancelling here is the same per-purchase action as in the deck view.
 */
export function PurchasesSection({ plugin, decks, cardIndex, allocation, onOpenDeck }: PurchasesSectionProps) {
	const app = useApp()

	const rows = useMemo<PurchaseRow[]>(() => {
		const list: PurchaseRow[] = []
		for (const deck of decks) {
			for (const entry of plugin.decks.readEntries(deck)) {
				entry.orders.forEach((order, orderIndex) => {
					list.push({ deck, entry, orderIndex, order, meta: cardIndex.get(entry.id) ?? null })
				})
			}
		}
		// Newest purchases first; undated ones sink to the end.
		return list.sort((a, b) => (b.order.date ?? '').localeCompare(a.order.date ?? ''))
	}, [plugin, decks, cardIndex])

	const summary = useMemo(() => summarizePurchases(rows.map((row) => row.order)), [rows])

	/** Market cost of everything still to buy, across every deck. */
	const toBuyCost = useMemo(() => {
		let cost = 0
		for (const deck of allocation.input.decks) {
			for (const line of analyzeDeck(allocation.snapshot, deck, allocation.input.keyOf)) {
				if (line.toBuy > 0) cost += line.toBuy * (cardIndex.get(line.id)?.priceMarket ?? 0)
			}
		}
		return cost
	}, [allocation, cardIndex])

	if (rows.length === 0 && toBuyCost === 0) return null

	const cancel = (row: PurchaseRow) => {
		new ConfirmModal(
			app,
			t('purchases.cancel-title'),
			t('purchases.cancel-body', {
				qty: row.order.qty,
				name: row.meta?.name ?? row.entry.id,
				from: row.order.from.length > 0 ? row.order.from : t('purchases.from-unknown'),
			}),
			() => void plugin.cancelOrder(row.deck, row.entry, row.orderIndex),
			t('purchases.cancel-confirm'),
		).open()
	}

	return (
		<section className="tcgb-purchases">
			<h3 className="tcgb-section-title">
				{t('purchases.title')}
				{summary.copies > 0 && <span className="tcgb-count-pill">{summary.copies}</span>}
			</h3>
			<div className="tcgb-purchases-summary">
				{summary.copies > 0 && (
					<span>
						{t('purchases.in-transit-total', { cost: summary.cost.toFixed(2) })}
						{summary.unpriced > 0 && <> · {t('purchases.unpriced', { count: summary.unpriced })}</>}
					</span>
				)}
				{toBuyCost > 0 && <span>{t('purchases.to-buy-total', { cost: toBuyCost.toFixed(2) })}</span>}
			</div>
			{rows.length === 0 ? (
				<p className="tcgb-empty">{t('purchases.empty')}</p>
			) : (
				rows.map((row) => {
					const receive = () => {
						const meta = row.meta
						if (meta) plugin.receiveOrder(row.deck, row.entry, row.orderIndex, meta)
					}
					return (
						<div key={`${row.deck.path}-${row.entry.id}-${row.orderIndex}`} className="tcgb-deck-row tcgb-purchase-row">
							{row.meta?.image ? (
								<img className="tcgb-thumb" loading="lazy" src={row.meta.image} alt="" />
							) : (
								<div className="tcgb-thumb tcgb-thumb-empty" />
							)}
							<span className="tcgb-deck-missing-qty">{row.order.qty}×</span>
							<div className="tcgb-deck-missing-name">
								<span className="tcgb-purchase-card">{row.meta?.name ?? row.entry.id}</span>
								<span className="tcgb-deck-missing-note">
									{[
										row.order.from.length > 0 ? row.order.from : t('purchases.from-unknown'),
										row.order.price !== null
											? `$${(row.order.qty * row.order.price).toFixed(2)}`
											: null,
										row.order.date,
									]
										.filter(Boolean)
										.join(' · ')}
								</span>
							</div>
							<button className="tcgb-btn tcgb-purchase-deck" onClick={() => onOpenDeck(row.deck)}>
								{row.deck.basename}
							</button>
							{row.meta && (
								<button className="tcgb-btn tcgb-acq-receive" onClick={receive}>
									{t('acq.received')}
								</button>
							)}
							<button
								className="tcgb-remove"
								aria-label={t('purchases.cancel')}
								title={t('purchases.cancel')}
								onClick={() => cancel(row)}
							>
								×
							</button>
						</div>
					)
				})
			)}
		</section>
	)
}
