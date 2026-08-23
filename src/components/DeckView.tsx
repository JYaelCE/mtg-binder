import { useEffect, useMemo, useState } from 'react'
import { Notice, type TFile } from 'obsidian'
import { useApp } from '../context'
import { showCoverMenu } from '../utils/cover-menu'
import { t } from '../i18n'
import { legalitiesByFunctionalName, validateDeck, validateDeckLegality } from '../domain/deck-rules'
import { functionalKey } from '../domain/text-match'
import type { ViewMode } from '../settings'
import type { CardMeta } from '../services/card-notes'
import { keyMapFrom, toAllocationDeck } from '../services/deck-availability'
import { useAllocation } from '../hooks/useAllocation'
import { analyzeDeck } from '../domain/allocation'
import type { DeckLineAvailability } from '../domain/allocation'
import { OrderedQtyModal } from '../modals/ordered-qty-modal'
import type { DeckStatus, DeckStoredEntry } from '../services/deck-store'
import type { DeckFormat } from '../types'
import { CardDetailModal } from '../modals/card-detail-modal'
import type TcgBinderPlugin from '../main'

interface DeckViewProps {
	plugin: TcgBinderPlugin
	file: TFile
	version: number
	onBack: () => void
}

interface Row extends DeckStoredEntry {
	meta: CardMeta | null
}

const GROUPS = ['pokemon', 'trainer', 'energy'] as const
type Group = (typeof GROUPS)[number]

function groupOf(row: Row): Group {
	if (row.meta?.supertype === 'Pokémon') return 'pokemon'
	if (row.meta?.supertype === 'Energy') return 'energy'
	return 'trainer'
}

/** One deck: grouped list, live validation, price and missing-vs-collection. */
export function DeckView({ plugin, file, version, onBack }: DeckViewProps) {
	const app = useApp()
	const format = plugin.decks.readFormat(file)
	const status = plugin.decks.readStatus(file)
	const [mode, setMode] = useState<ViewMode>(plugin.settings.defaultViewMode)

	const cardIndex = useMemo(() => plugin.cardNotes.buildIndex(), [plugin, version])

	const rows = useMemo<Row[]>(
		() =>
			plugin.decks.readEntries(file).map((entry) => ({ ...entry, meta: cardIndex.get(entry.id) ?? null })),
		[plugin, file, version, cardIndex],
	)

	const total = useMemo(() => rows.reduce((sum, row) => sum + row.qty, 0), [rows])

	/**
	 * Reprint rule: legality per FUNCTIONAL name, unioned across every card
	 * note in the binder — an old printing is legal when a current same-name
	 * reprint (in this deck or any collection) is.
	 */
	const legalByName = useMemo(
		() =>
			legalitiesByFunctionalName(
				[...cardIndex.values()].map((meta) => ({
					id: meta.cardId,
					name: meta.name,
					nameEn: meta.nameEn,
					legalities: meta.legalities,
				})),
			),
		[cardIndex],
	)

	const effectiveLegalities = (row: Row): string[] | null => {
		const key = functionalKey(row.meta?.nameEn ?? null, row.meta?.name ?? null, row.id)
		const byName = legalByName.get(key)
		if (byName && byName.size > 0) return [...byName]
		return row.meta?.legalities ?? null
	}

	const issues = useMemo(() => {
		const deckEntries = rows.map((row) => ({
			card: { game: 'pokemon' as const, cardId: row.id, name: row.meta?.name ?? row.id },
			quantity: row.qty,
			copyLimitExempt: row.meta?.copyLimitExempt ?? false,
		}))
		const legalityEntries = rows.map((row) => ({
			name: row.meta?.name ?? row.id,
			legalities: effectiveLegalities(row),
		}))
		return [...validateDeck(deckEntries), ...validateDeckLegality(legalityEntries, format)]
	}, [rows, format, legalByName])

	// Cards still illegal after the local union get checked against the card
	// database for a legal reprint — a hit stamps the note and revalidates.
	useEffect(() => {
		if (format !== 'standard' && format !== 'expanded') return
		const flagged = rows
			.filter((row) => {
				const legalities = effectiveLegalities(row)
				return row.meta !== null && legalities !== null && !legalities.includes(format)
			})
			.map((row) => row.meta)
			.filter((meta): meta is CardMeta => meta !== null)
		if (flagged.length > 0) void plugin.checkReprintLegalities(flagged, format)
	}, [rows, format, legalByName, plugin])

	const totalPrice = useMemo(
		() => rows.reduce((sum, row) => sum + row.qty * (row.meta?.priceMarket ?? 0), 0),
		[rows],
	)

	const { snapshot } = useAllocation(plugin, cardIndex, version)

	/** What this deck holds / lacks, across every line. */
	const summary = snapshot.decks.get(file.path)

	/** Per-printing availability: what this deck holds, the free pool, what is missing. */
	const availability = useMemo(
		() => analyzeDeck(snapshot, toAllocationDeck(plugin, file), keyMapFrom(cardIndex, rows.map((row) => row.id))),
		[snapshot, plugin, file, cardIndex, rows],
	)

	type MissingRow = Row & DeckLineAvailability
	const missing = useMemo<MissingRow[]>(() => {
		const byId = new Map(rows.map((row) => [row.id, row]))
		return availability
			.filter((line) => line.missing > 0)
			.flatMap((line) => {
				const row = byId.get(line.id)
				return row ? [{ ...row, ...line }] : []
			})
	}, [rows, availability])

	/** Missing lines fully covered by a purchase on the way don't count. */
	const missingCost = useMemo(
		() => missing.reduce((sum, row) => sum + row.toBuy * (row.meta?.priceMarket ?? 0), 0),
		[missing],
	)

	/** Copies bought and on the way, across the whole deck. */
	const orderedTotal = useMemo(() => rows.reduce((sum, row) => sum + row.ordered, 0), [rows])

	/** Coverage per deck line ("2/4" badges) — derived from the missing math. */
	const missingByRow = useMemo(() => {
		const map = new Map<string, { missingQty: number; orderedQty: number }>()
		for (const row of missing) map.set(row.id, { missingQty: row.missing, orderedQty: row.ordered })
		return map
	}, [missing])

	const changeQty = (row: Row, delta: number) => {
		void plugin.decks.setQuantity(file, row.id, row.qty + delta)
	}

	const grouped = useMemo(() => {
		const buckets: Record<Group, Row[]> = { pokemon: [], trainer: [], energy: [] }
		for (const row of rows) buckets[groupOf(row)].push(row)
		for (const group of GROUPS) {
			buckets[group].sort((a, b) => (a.meta?.name ?? a.id).localeCompare(b.meta?.name ?? b.id))
		}
		return buckets
	}, [rows])

	/** Navigation order for the card viewer = the grouped order on screen. */
	const detailMetas = useMemo(
		() =>
			GROUPS.flatMap((group) => grouped[group])
				.map((row) => row.meta)
				.filter((meta): meta is CardMeta => meta !== null),
		[grouped],
	)

	const openCard = (row: Row) => {
		if (!row.meta) return
		const start = detailMetas.findIndex((meta) => meta.cardId === row.meta?.cardId)
		new CardDetailModal(app, plugin, detailMetas, Math.max(0, start)).open()
	}

	const openCoverMenu = (event: MouseEvent) => {
		showCoverMenu(app, plugin, file, detailMetas, event)
	}

	const missingToWishlist = () => {
		// Copies already bought (on the way) don't belong on a wishlist.
		void plugin
			.addMissingToWishlist(
				missing
					.filter((row) => row.toBuy > 0)
					.map((row) => ({ id: row.id, link: row.link, qty: row.toBuy })),
			)
			.then((count) => {
				new Notice(count > 0 ? t('wishlist.added', { count }) : t('wishlist.covered'))
			})
	}

	/** "2/4" badge on deck lines the collection can't fully cover yet. */
	const coverageBadge = (row: Row) => {
		const gap = missingByRow.get(row.id)
		if (!gap) return null
		const covered = row.qty - gap.missingQty
		return (
			<span
				className="tcgb-deck-coverage"
				title={t('deck.coverage-tooltip', { covered, qty: row.qty, held: row.allocated, ordered: gap.orderedQty })}
			>
				{covered}/{row.qty}
			</span>
		)
	}

	const editOrdered = (row: MissingRow) => {
		new OrderedQtyModal(app, row.meta?.name ?? row.id, row.orders, row.missing, (orders) => {
			void plugin.placeOrders(file, row.id, row.link, row.orders, orders)
		}).open()
	}

	/** to buy / on the way / held — one word the eye can sort the list by. */
	const stateChip = (row: MissingRow) => {
		if (row.toBuy > 0) {
			return <span className="tcgb-acq-state tcgb-acq-state-buy">{t('acq.state.buy')}</span>
		}
		if (row.ordered > 0) {
			return <span className="tcgb-acq-state tcgb-acq-state-ordered">{t('acq.state.ordered')}</span>
		}
		return null
	}

	/**
	 * Why copies are missing — once per card name: owned, free and held by
	 * other decks; then what THIS deck holds and what is on the way (with
	 * sellers).
	 */
	const missingNote = (row: MissingRow) => {
		const parts: string[] = []
		if (row.firstOfKey && (row.heldElsewhere > 0 || row.allocated > 0)) {
			parts.push(t('deck.missing-explain', { owned: row.owned, free: row.free, held: row.heldElsewhere }))
		}
		if (row.allocated > 0) parts.push(t('deck.missing-held-here', { allocated: row.allocated }))
		if (row.ordered > 0) {
			const sellers = row.orders.some((order) => order.from.length > 0)
				? ` (${row.orders
						.map((order) => (order.from.length > 0 ? `${order.qty} ${order.from}` : `${order.qty}×`))
						.join(' · ')})`
				: ''
			parts.push(t('deck.missing-ordered', { ordered: row.ordered }) + sellers)
		}
		if (parts.length === 0) return null
		return <span className="tcgb-deck-missing-note">{parts.join(' · ')}</span>
	}

	return (
		<div className="tcgb-root">
			<div className="tcgb-view-header">
				<button className="tcgb-back" onClick={onBack}>
					← {t('view.back')}
				</button>
				<h2 className="tcgb-title">{file.basename}</h2>
				<button
					className="tcgb-btn tcgb-mode-toggle"
					title={t('rename.title')}
					aria-label={t('rename.title')}
					onClick={() => plugin.openRename(file)}
				>
					✎
				</button>
			</div>

			<div className="tcgb-deck-toolbar">
				<select
					value={format}
					onChange={(e) => void plugin.decks.setFormat(file, e.target.value as DeckFormat)}
				>
					<option value="standard">{t('format.standard')}</option>
					<option value="expanded">{t('format.expanded')}</option>
					<option value="unlimited">{t('format.unlimited')}</option>
				</select>
				<select
					value={status}
					title={t('deck.status-hint')}
					aria-label={t('deck.status-hint')}
					onChange={(e) => void plugin.changeDeckStatus(file, e.target.value as DeckStatus)}
				>
					<option value="assembled">{t('status.assembled')}</option>
					<option value="building">{t('status.building')}</option>
					<option value="list">{t('status.list')}</option>
				</select>
				<button className="tcgb-btn tcgb-btn-cta" onClick={() => plugin.runAddToDeckLoop([file])}>
					{t('deck.add-cards')}
				</button>
				{summary && summary.need > 0 && !summary.fullyAllocated && (
					<button
						className="tcgb-btn"
						title={t('deck.build-hint')}
						onClick={() => void plugin.buildDeckFromCollection(file)}
					>
						{t('deck.build')}
					</button>
				)}
				{summary && summary.allocated > 0 && (
					<button
						className="tcgb-btn"
						title={t('deck.disassemble-hint')}
						onClick={() => plugin.confirmDisassembleDeck(file)}
					>
						{t('deck.disassemble')}
					</button>
				)}
				<button className="tcgb-btn" onClick={() => void plugin.exportDeck(file)}>
					{t('deck.export')}
				</button>
				<button
					className="tcgb-btn"
					title={t('deck.to-collections-hint')}
					onClick={() => void plugin.addDeckToCollections(file)}
				>
					{t('deck.to-collections')}
				</button>
				<button className="tcgb-btn" onClick={() => plugin.openDeckRevisions(file)}>
					{t('deck.revisions')}
				</button>
				<button
					className="tcgb-btn tcgb-mode-toggle"
					title={t('view.toggle-mode')}
					aria-label={t('view.toggle-mode')}
					onClick={() => setMode((m) => (m === 'list' ? 'grid' : 'list'))}
				>
					{mode === 'list' ? '▦' : '≣'}
				</button>
				<button
					className="tcgb-btn tcgb-mode-toggle"
					title={t('cover.set')}
					aria-label={t('cover.set')}
					onClick={(event) => {
						openCoverMenu(event.nativeEvent)
					}}
				>
					🖼
				</button>
			</div>

			<div className="tcgb-summary">
				<div className="tcgb-stat">
					<span className="tcgb-stat-value">{total}/60</span>
					{t('deck.total')}
				</div>
				<div className="tcgb-stat">
					<span className="tcgb-stat-value">${totalPrice.toFixed(2)}</span>
					{t('view.total-value')}
				</div>
				<div className="tcgb-stat">
					<span className="tcgb-stat-value">
						{summary?.allocated ?? 0}/{total}
					</span>
					{t('deck.held-stat')}
				</div>
				<div className="tcgb-stat">
					<span className="tcgb-stat-value">${missingCost.toFixed(2)}</span>
					{t('deck.missing-cost')}
				</div>
				{orderedTotal > 0 && (
					<div className="tcgb-stat">
						<span className="tcgb-stat-value">{orderedTotal}</span>
						{t('deck.ordered-stat')}
					</div>
				)}
			</div>

			{issues.length === 0 ? (
				<div className="tcgb-panel tcgb-panel-ok">✓ {t('deck.valid')}</div>
			) : (
				<div className="tcgb-panel tcgb-panel-issues">
					<div className="tcgb-panel-title">{t('deck.issues', { count: issues.length })}</div>
					<ul className="tcgb-deck-issues">
						{issues.map((issue, i) => (
							<li key={i}>{issue.message}</li>
						))}
					</ul>
				</div>
			)}

			{GROUPS.map((group) => {
				const items = grouped[group]
				if (items.length === 0) return null
				return (
					<section key={group} className="tcgb-deck-group">
						<h3 className="tcgb-section-title">
							{t(`deck.group.${group}`)}
							<span className="tcgb-count-pill">{items.reduce((sum, r) => sum + r.qty, 0)}</span>
						</h3>
						{mode === 'grid' ? (
							<div className="tcgb-card-grid">
								{items.map((row) => (
									<div key={row.id} className="tcgb-card-tile">
										<div className="tcgb-tile-imgwrap" onClick={() => openCard(row)}>
											{row.meta?.image ? (
												<img className="tcgb-tile-img" loading="lazy" src={row.meta.image} alt="" />
											) : (
												<div className="tcgb-tile-img tcgb-tile-img-empty" />
											)}
											<span className="tcgb-tile-qty">{row.qty}×</span>
										</div>
										<div className="tcgb-tile-name" onClick={() => openCard(row)}>
											{row.meta?.name ?? row.id}
										</div>
										<div className="tcgb-tile-footer">
											<span className="tcgb-tile-meta">
												{[row.meta?.setCode, row.meta?.number].filter(Boolean).join(' ')}
											</span>
											{coverageBadge(row)}
											<span className="tcgb-qty">
												<button className="tcgb-qty-btn" onClick={() => changeQty(row, -1)}>
													−
												</button>
												<button className="tcgb-qty-btn" onClick={() => changeQty(row, 1)}>
													+
												</button>
											</span>
										</div>
									</div>
								))}
							</div>
						) : (
							items.map((row) => (
							<div key={row.id} className="tcgb-deck-row">
								{row.meta?.image ? (
									<img className="tcgb-thumb" loading="lazy" src={row.meta.image} alt="" />
								) : (
									<div className="tcgb-thumb tcgb-thumb-empty" />
								)}
								<span className="tcgb-qty">
									<button className="tcgb-qty-btn" onClick={() => changeQty(row, -1)}>
										−
									</button>
									<span className="tcgb-qty-value">{row.qty}</span>
									<button className="tcgb-qty-btn" onClick={() => changeQty(row, 1)}>
										+
									</button>
								</span>
								<a className="tcgb-card-link" onClick={() => openCard(row)}>
									{row.meta?.name ?? row.id}
								</a>
								{coverageBadge(row)}
								<span className="tcgb-deck-row-meta">
									{[row.meta?.setCode, row.meta?.number].filter(Boolean).join(' ')}
								</span>
								<button
									className="tcgb-remove"
									aria-label={t('view.remove')}
									onClick={() => changeQty(row, -row.qty)}
								>
									×
								</button>
							</div>
							))
						)}
					</section>
				)
			})}

			<section className="tcgb-deck-missing">
				<h3 className="tcgb-section-title">
					{t('deck.missing')}
					{missing.length > 0 && <span className="tcgb-count-pill">{missing.length}</span>}
					{missing.length > 0 && (
						<button className="tcgb-btn tcgb-missing-wishlist" onClick={missingToWishlist}>
							{t('deck.missing-to-wishlist')}
						</button>
					)}
				</h3>
				{missing.length === 0 ? (
					<p className="tcgb-empty">{t('deck.missing-none')}</p>
				) : (
						missing.map((row) => (
							<div
								key={row.id}
								className={`tcgb-deck-row ${
									row.toBuy === 0 && row.ordered > 0 ? 'tcgb-missing-ordered-done' : ''
								}`}
							>
								{row.meta?.image ? (
									<img className="tcgb-thumb" loading="lazy" src={row.meta.image} alt="" />
								) : (
									<div className="tcgb-thumb tcgb-thumb-empty" />
								)}
								<span className="tcgb-deck-missing-qty">{row.toBuy}×</span>
								{stateChip(row)}
								<div className="tcgb-deck-missing-name">
									<a className="tcgb-card-link" onClick={() => openCard(row)}>
										{row.meta?.name ?? row.id}
										{row.meta && (row.meta.setCode || row.meta.number) && (
											<span className="tcgb-deck-missing-set">
												{' '}
												{[row.meta.setCode, row.meta.number].filter(Boolean).join(' ')}
											</span>
										)}
									</a>
									{missingNote(row)}
								</div>
							<span className="tcgb-deck-row-meta tcgb-cell-num">
								{row.meta?.priceMarket !== null && row.meta?.priceMarket !== undefined
									? `$${(row.toBuy * row.meta.priceMarket).toFixed(2)}`
									: '—'}
							</span>
							<span className="tcgb-acq-actions">
								<button
									className="tcgb-row-action"
									aria-label={t('acq.bought')}
									title={t('acq.bought-hint')}
									onClick={() => {
										editOrdered(row)
									}}
								>
									🛒
								</button>
								{row.meta && row.missing > row.ordered && (
									<button
										className="tcgb-row-action tcgb-acquire"
										aria-label={t('acq.have')}
										title={t('acq.have-hint')}
										onClick={() => {
											const meta = row.meta
											if (meta) {
												void plugin.markHave(file, row.id, row.link, row.missing - row.ordered, meta)
											}
										}}
									>
										✓
									</button>
								)}
								{row.meta &&
									row.orders.map((order, orderIndex) => (
										<button
											key={orderIndex}
											className="tcgb-btn tcgb-acq-receive"
											title={t('acq.received-hint')}
											onClick={() => {
												const meta = row.meta
												if (meta) plugin.receiveOrder(file, row, orderIndex, meta)
											}}
										>
											{t('acq.received')}{' '}
											{order.from.length > 0 ? `${order.qty}× ${order.from}` : `${order.qty}×`}
										</button>
									))}
							</span>
						</div>
					))
				)}
			</section>
		</div>
	)
}
