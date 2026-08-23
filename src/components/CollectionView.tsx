import { useEffect, useMemo, useState } from 'react'
import { Notice, TFile } from 'obsidian'
import { useApp } from '../context'
import { showCoverMenu } from '../utils/cover-menu'
import { localIsoDate } from '../utils/date'
import { t } from '../i18n'
import { CARD_CONDITIONS, CARD_VARIANTS } from '../types'
import type { CardCondition, CardVariant } from '../types'
import type { ViewMode } from '../settings'
import { computeCollectionStats } from '../domain/collection-stats'
import { functionalKey } from '../domain/text-match'
import { computeSetProgress } from '../domain/set-progress'
import type { SetInfo } from '../services/card-data/card-data-source'
import type { CardMeta } from '../services/card-notes'
import type { StoredEntry } from '../services/collection-store'
import { FilePickerModal } from '../modals/file-picker-modal'
import { ChoiceControl } from './ChoiceControl'
import { layoutClasses, useLayoutMode } from '../hooks/useLayoutMode'
import { showActionMenu, showChoiceMenu } from '../utils/choice-menu'
import { CardDetailModal } from '../modals/card-detail-modal'
import type TcgBinderPlugin from '../main'

interface CollectionViewProps {
	plugin: TcgBinderPlugin
	file: TFile
	version: number
	onBack: () => void
}

interface Row extends StoredEntry {
	meta: CardMeta | null
}

const ALL = 'all'

/** Table of one collection: filters, totals, market value and set progress. */
export function CollectionView({ plugin, file, version, onBack }: CollectionViewProps) {
	const app = useApp()
	const [sets, setSets] = useState<SetInfo[]>([])
	const [completion, setCompletion] = useState<
		Record<string, { missing: number; cost: number } | 'loading'>
	>({})
	const [mode, setMode] = useState<ViewMode>(plugin.settings.defaultViewMode)
	const [setFilter, setSetFilter] = useState(ALL)
	const [variantFilter, setVariantFilter] = useState(ALL)
	const [conditionFilter, setConditionFilter] = useState(ALL)
	const [dateFilter, setDateFilter] = useState(ALL)
	const [sortMode, setSortMode] = useState<'default' | 'newest' | 'oldest'>('default')
	const [search, setSearch] = useState('')
	const layout = useLayoutMode()

	useEffect(() => {
		let cancelled = false
		void plugin.setCatalog.load().then((loaded) => {
			if (!cancelled) setSets(loaded)
		})
		return () => {
			cancelled = true
		}
	}, [plugin])

	const rows = useMemo<Row[]>(() => {
		const index = plugin.cardNotes.buildIndex()
		return plugin.collections
			.readEntries(file)
			.map((entry) => ({ ...entry, meta: index.get(entry.id) ?? null }))
	}, [plugin, file, version])

	const filtered = useMemo(() => {
		const query = search.trim().toLowerCase()
		const cutoff =
			dateFilter === ALL
				? null
				: localIsoDate(new Date(Date.now() - Number(dateFilter) * 24 * 60 * 60 * 1000))
		const result = rows.filter((row) => {
			if (setFilter !== ALL && row.meta?.setId !== setFilter) return false
			if (variantFilter !== ALL && row.variant !== variantFilter) return false
			if (conditionFilter !== ALL && row.condition !== conditionFilter) return false
			// Undated rows (checklist lines, pre-feature entries) fail period filters.
			if (cutoff && (!row.added || row.added < cutoff)) return false
			if (query && !(row.meta?.name ?? row.id).toLowerCase().includes(query)) return false
			return true
		})
		if (sortMode === 'default') return result
		return [...result].sort((a, b) => {
			if (!a.added && !b.added) return 0
			if (!a.added) return 1 // undated rows always sink to the end
			if (!b.added) return -1
			return sortMode === 'newest' ? b.added.localeCompare(a.added) : a.added.localeCompare(b.added)
		})
	}, [rows, setFilter, variantFilter, conditionFilter, dateFilter, sortMode, search])

	const stats = useMemo(
		() =>
			computeCollectionStats(
				filtered.map((row) => ({
					card: { game: 'pokemon' as const, cardId: row.id, name: row.meta?.name ?? row.id },
					quantity: row.qty,
					variant: row.variant,
					condition: row.condition,
				})),
			),
		[filtered],
	)

	const totalValue = useMemo(
		() => filtered.reduce((sum, row) => sum + row.qty * (row.meta?.priceMarket ?? 0), 0),
		[filtered],
	)

	const ownedSets = useMemo(() => {
		const bySet = new Map<string, Set<string>>()
		for (const row of rows) {
			const setId = row.meta?.setId
			// qty-0 rows are checklist lines — they don't count as owned.
			if (!setId || row.qty <= 0) continue
			const owned = bySet.get(setId) ?? new Set<string>()
			owned.add(row.id)
			bySet.set(setId, owned)
		}
		return [...bySet.entries()]
			.map(([setId, owned]) => {
				const info = sets.find((s) => s.id === setId)
				return { setId, name: info?.name ?? setId, ...computeSetProgress(owned.size, info?.total ?? 0) }
			})
			.sort((a, b) => b.percent - a.percent)
	}, [rows, sets])

	/** Total copies per functional card (name across printings) — 4+ is a playset. */
	const keyOf = (row: Row) => functionalKey(row.meta?.nameEn ?? null, row.meta?.name ?? null, row.id)
	const copiesByKey = useMemo(() => {
		const map = new Map<string, number>()
		for (const row of rows) {
			const key = functionalKey(row.meta?.nameEn ?? null, row.meta?.name ?? null, row.id)
			map.set(key, (map.get(key) ?? 0) + row.qty)
		}
		return map
	}, [rows])

	const variants = useMemo(() => [...new Set(rows.map((r) => r.variant))], [rows])
	const conditions = useMemo(() => [...new Set(rows.map((r) => r.condition))], [rows])
	const rowSets = useMemo(() => {
		const ids = [...new Set(rows.map((r) => r.meta?.setId).filter((id): id is string => !!id))]
		return ids.map((id) => ({ id, name: sets.find((s) => s.id === id)?.name ?? id }))
	}, [rows, sets])

	/** Set collections keep qty-0 rows — they are the checklist. */
	const isSetCollection = useMemo(() => plugin.store.getSetId(file) !== null, [plugin, file, version])

	const changeQty = (row: Row, delta: number) => {
		const key = { id: row.id, variant: row.variant, condition: row.condition }
		const next = row.qty + delta
		// In a regular collection a line at zero is no longer owned — drop it.
		if (next <= 0 && !isSetCollection) {
			void plugin.collections.removeEntry(file, key)
			return
		}
		void plugin.collections.setQuantity(file, key, next)
	}

	const rekey = (row: Row, variant: CardVariant, condition: CardCondition) => {
		void plugin.collections.updateEntryKey(
			file,
			{ id: row.id, variant: row.variant, condition: row.condition },
			variant,
			condition,
		)
	}

	/** Adds a sibling checklist line for the same card in the next unused variant. */
	const addVariantLine = (row: Row) => {
		const used = new Set(
			rows.filter((r) => r.id === row.id && r.condition === row.condition).map((r) => r.variant),
		)
		const next = CARD_VARIANTS.find((variant) => !used.has(variant))
		if (!next) {
			new Notice(t('notice.variants-exhausted'))
			return
		}
		void plugin.collections.addEntry(file, row.id, row.link, 0, next, row.condition, {
			id: row.id,
			variant: row.variant,
			condition: row.condition,
		})
	}

	/**
	 * Navigation order for the card viewer = the list on screen (filters and
	 * sort applied), deduped by card id — variant lines share one card.
	 */
	const detailMetas = useMemo(() => {
		const seen = new Set<string>()
		const list: CardMeta[] = []
		for (const row of filtered) {
			if (row.meta && !seen.has(row.meta.cardId)) {
				seen.add(row.meta.cardId)
				list.push(row.meta)
			}
		}
		return list
	}, [filtered])

	const openCard = (row: Row) => {
		if (!row.meta) return
		const start = detailMetas.findIndex((meta) => meta.cardId === row.meta?.cardId)
		new CardDetailModal(app, plugin, detailMetas, Math.max(0, start)).open()
	}

	const openCoverMenu = (event: MouseEvent) => {
		showCoverMenu(app, plugin, file, detailMetas, event)
	}

	const isWishlist = plugin.store.getRole(file) === 'wishlist'

	/** The paid column only earns its width when someone recorded a price. */
	const anyPaid = useMemo(() => rows.some((row) => row.paid !== null), [rows])

	/**
	 * Wishlist only: copies arrived — the shared receive flow adds them to a
	 * real collection (price paid, optional deck to allocate them to) and
	 * shrinks this line by what actually came.
	 */
	const acquire = (row: Row) => {
		plugin.receiveFromWishlist(file, row, row.meta)
	}

	/** Moves the whole line to another collection, chosen via fuzzy picker. */
	const moveToCollection = (row: Row) => {
		const targets = plugin.store.listFiles('collection').filter((f) => f.path !== file.path)
		if (targets.length === 0) {
			new Notice(t('notice.no-other-collection'))
			return
		}
		new FilePickerModal(app, targets, t('picker.collection'), (target) => {
			void plugin.collections
				.moveEntry(file, target, { id: row.id, variant: row.variant, condition: row.condition })
				.then(() => {
					new Notice(
						t('notice.card-moved', { name: row.meta?.name ?? row.id, collection: target.basename }),
					)
				})
		}).open()
	}

	/** Fetches the full set once (cached) and prices the cards not yet owned. */
	const loadCompletion = (setId: string) => {
		setCompletion((current) => ({ ...current, [setId]: 'loading' }))
		void (async () => {
			try {
				const cards = await plugin.setCards.getSetCards(setId)
				const ownedIds = new Set(rows.filter((row) => row.meta?.setId === setId).map((row) => row.id))
				const missingCards = cards.filter((card) => !ownedIds.has(card.id))
				const cost = missingCards.reduce((sum, card) => sum + (card.marketPrice ?? 0), 0)
				setCompletion((current) => ({
					...current,
					[setId]: { missing: missingCards.length, cost },
				}))
			} catch (error) {
				console.error(`[TCG Binder] cost-to-completion failed for set ${setId}`, error)
				setCompletion((current) => {
					const next = { ...current }
					delete next[setId]
					return next
				})
				new Notice(t('search.error'))
			}
		})()
	}

	const setOptions = [
		{ value: ALL, label: t('view.filter.all-sets') },
		...rowSets.map((s) => ({ value: s.id, label: s.name })),
	]
	const variantOptions = [
		{ value: ALL, label: t('view.filter.all-variants') },
		...variants.map((v) => ({ value: v, label: t(`variant.${v}`) })),
	]
	const conditionOptions = [
		{ value: ALL, label: t('view.filter.all-conditions') },
		...conditions.map((c) => ({ value: c, label: c })),
	]
	const dateOptions = [
		{ value: ALL, label: t('view.filter.any-date') },
		{ value: '7', label: t('view.filter.last-days-7') },
		{ value: '30', label: t('view.filter.last-days-30') },
		{ value: '90', label: t('view.filter.last-days-90') },
	]
	const sortOptions = [
		{ value: 'default', label: t('view.sort.default') },
		{ value: 'newest', label: t('view.sort.newest') },
		{ value: 'oldest', label: t('view.sort.oldest') },
	]

	/** Active filters, as chip data — what the collapsed disclosure summarizes. */
	const activeFilters: { label: string; clear: () => void }[] = [
		...(setFilter !== ALL
			? [{ label: setOptions.find((o) => o.value === setFilter)?.label ?? setFilter, clear: () => setSetFilter(ALL) }]
			: []),
		...(variantFilter !== ALL
			? [{ label: t(`variant.${variantFilter as CardVariant}`), clear: () => setVariantFilter(ALL) }]
			: []),
		...(conditionFilter !== ALL ? [{ label: conditionFilter, clear: () => setConditionFilter(ALL) }] : []),
		...(dateFilter !== ALL
			? [{ label: dateOptions.find((o) => o.value === dateFilter)?.label ?? dateFilter, clear: () => setDateFilter(ALL) }]
			: []),
		...(sortMode !== 'default'
			? [{ label: sortOptions.find((o) => o.value === sortMode)?.label ?? sortMode, clear: () => setSortMode('default') }]
			: []),
	]

	const filterControls = (
		<>
			<ChoiceControl value={setFilter} coarse={layout.coarse} ariaLabel={t('view.filter.all-sets')} options={setOptions} onChange={setSetFilter} />
			<ChoiceControl value={variantFilter} coarse={layout.coarse} ariaLabel={t('view.filter.all-variants')} options={variantOptions} onChange={setVariantFilter} />
			<ChoiceControl value={conditionFilter} coarse={layout.coarse} ariaLabel={t('view.filter.all-conditions')} options={conditionOptions} onChange={setConditionFilter} />
			<ChoiceControl value={dateFilter} coarse={layout.coarse} ariaLabel={t('view.filter.added')} options={dateOptions} onChange={setDateFilter} />
			<ChoiceControl
				value={sortMode}
				coarse={layout.coarse}
				ariaLabel={t('view.sort')}
				options={sortOptions}
				onChange={(value) => setSortMode(value as 'default' | 'newest' | 'oldest')}
			/>
		</>
	)

	/** Row actions behind one ⋯ on touch — four hover icons don't fit a phone row. */
	const rowActionMenu = (row: Row, anchor: { x: number; y: number }) => {
		showActionMenu(anchor, [
			...(isWishlist && row.meta
				? [{ label: t('acq.received'), icon: 'check', onClick: () => acquire(row) }]
				: []),
			{ label: t('view.move'), icon: 'corner-up-right', onClick: () => moveToCollection(row) },
			{ label: t('view.add-variant'), icon: 'copy-plus', onClick: () => addVariantLine(row) },
			{
				label: t('view.remove'),
				icon: 'trash-2',
				danger: true,
				onClick: () =>
					void plugin.collections.removeEntry(file, {
						id: row.id,
						variant: row.variant,
						condition: row.condition,
					}),
			},
		])
	}

	/** Narrow layout: the 11-column table becomes stacked two-line rows. */
	const stackedRows = (
		<div className="tcgb-stack-list">
			{filtered.map((row) => (
				<div key={`${row.id}-${row.variant}-${row.condition}`} className="tcgb-stack-row">
					<div className="tcgb-stack-primary">
						{row.meta?.image ? (
							<img className="tcgb-thumb" loading="lazy" src={row.meta.image} alt="" />
						) : (
							<div className="tcgb-thumb tcgb-thumb-empty" />
						)}
						<a className="tcgb-card-link" onClick={() => openCard(row)}>
							{row.meta?.name ?? row.id}
						</a>
						<span className="tcgb-qty">
							<button className="tcgb-qty-btn" onClick={() => changeQty(row, -1)}>
								−
							</button>
							<span className="tcgb-qty-value">{row.qty}</span>
							<button className="tcgb-qty-btn" onClick={() => changeQty(row, 1)}>
								+
							</button>
						</span>
						<button
							className="tcgb-row-action tcgb-stack-more"
							aria-label={t('mobile.actions')}
							aria-haspopup="menu"
							onClick={(e) => rowActionMenu(row, { x: e.clientX, y: e.clientY })}
						>
							⋯
						</button>
					</div>
					<div className="tcgb-stack-secondary">
						<span className="tcgb-stack-set">
							{[row.meta?.setCode ?? row.meta?.setName, row.meta?.number ? `#${row.meta.number}` : null]
								.filter(Boolean)
								.join(' ')}
						</span>
						<button
							className="tcgb-chip"
							aria-haspopup="menu"
							onClick={(e) =>
								showChoiceMenu(
									{ x: e.clientX, y: e.clientY },
									CARD_VARIANTS.map((variant) => ({ value: variant, label: t(`variant.${variant}`) })),
									row.variant,
									(variant) => rekey(row, variant, row.condition),
								)
							}
						>
							{t(`variant.${row.variant}`)}
						</button>
						<button
							className={`tcgb-chip tcgb-cond tcgb-cond-${row.condition}`}
							aria-haspopup="menu"
							onClick={(e) =>
								showChoiceMenu(
									{ x: e.clientX, y: e.clientY },
									CARD_CONDITIONS.map((condition) => ({ value: condition, label: condition })),
									row.condition,
									(condition) => rekey(row, row.variant, condition),
								)
							}
						>
							{row.condition}
						</button>
						{(copiesByKey.get(keyOf(row)) ?? 0) >= 4 && (
							<span className="tcgb-chip tcgb-chip-ok">{t('view.col.playset')}</span>
						)}
						{row.meta?.priceMarket !== null && row.meta?.priceMarket !== undefined && (
							<span className="tcgb-stack-price">${(row.qty * row.meta.priceMarket).toFixed(2)}</span>
						)}
						{isWishlist && row.meta && (
							<button className="tcgb-btn tcgb-acq-receive" onClick={() => acquire(row)}>
								{t('acq.received')}
							</button>
						)}
					</div>
				</div>
			))}
		</div>
	)

	return (
		<div className={`tcgb-root${layoutClasses(layout)}`}>
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

			<div className="tcgb-summary">
				<div className="tcgb-stat">
					<span className="tcgb-stat-value">{stats.totalCards}</span>
					{t('root.total-cards')}
				</div>
				<div className="tcgb-stat">
					<span className="tcgb-stat-value">{stats.uniqueCards}</span>
					{t('view.unique')}
				</div>
				<div className="tcgb-stat">
					<span className="tcgb-stat-value">${totalValue.toFixed(2)}</span>
					{t('view.total-value')}
				</div>
			</div>

			<div className="tcgb-filters">
				<input
					className="tcgb-filter-search"
					type="search"
					placeholder={t('view.filter.search')}
					value={search}
					onChange={(e) => setSearch(e.target.value)}
				/>
				{layout.narrow ? (
					<details className="tcgb-disclosure">
						<summary className="tcgb-disclosure-summary">
							{t('mobile.filters')}
							{activeFilters.length > 0 && (
								<span className="tcgb-count-pill">{activeFilters.length}</span>
							)}
						</summary>
						<div className="tcgb-disclosure-body">{filterControls}</div>
					</details>
				) : (
					filterControls
				)}
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
				{isWishlist && rows.length > 0 && (
					<button className="tcgb-btn" onClick={() => plugin.confirmClearWishlist(file)}>
						{t('wishlist.clear')}
					</button>
				)}
			</div>

			{layout.narrow && activeFilters.length > 0 && (
				<div className="tcgb-filter-chips">
					{activeFilters.map((chip) => (
						<button key={chip.label} className="tcgb-chip tcgb-chip-clear" onClick={chip.clear}>
							{chip.label} ×
						</button>
					))}
				</div>
			)}

			{filtered.length === 0 ? (
				<p className="tcgb-empty">{t('view.no-entries')}</p>
			) : mode === 'grid' ? (
				<div className="tcgb-card-grid">
					{filtered.map((row) => (
						<div key={`${row.id}-${row.variant}-${row.condition}`} className="tcgb-card-tile">
							<div className="tcgb-tile-imgwrap" onClick={() => openCard(row)}>
								<button
									className="tcgb-tile-remove"
									aria-label={t('view.remove')}
									title={t('view.remove')}
									onClick={(e) => {
										e.stopPropagation()
										void plugin.collections.removeEntry(file, {
											id: row.id,
											variant: row.variant,
											condition: row.condition,
										})
									}}
								>
									×
								</button>
								{row.meta?.image ? (
									<img className="tcgb-tile-img" loading="lazy" src={row.meta.image} alt="" />
								) : (
									<div className="tcgb-tile-img tcgb-tile-img-empty" />
								)}
								{(copiesByKey.get(keyOf(row)) ?? 0) >= 4 && (
									<span className="tcgb-playset tcgb-tile-playset" title={t('view.playset-tooltip')}>
										4×
									</span>
								)}
							</div>
							<div className="tcgb-tile-name" onClick={() => openCard(row)}>
								{row.meta?.name ?? row.id}
							</div>
							<div className="tcgb-tile-meta">
								{[row.meta?.setCode ?? row.meta?.setName, row.meta?.number ? `#${row.meta.number}` : null, t(`variant.${row.variant}`)]
									.filter(Boolean)
									.join(' · ')}
							</div>
							<div className="tcgb-tile-footer">
								<span className={`tcgb-cond tcgb-cond-${row.condition}`}>{row.condition}</span>
								<span className="tcgb-qty">
									{isWishlist && (
										<button
											className="tcgb-qty-btn tcgb-acquire"
											aria-label={t('acq.received')}
											title={t('acq.received-hint')}
											onClick={() => acquire(row)}
										>
											✓
										</button>
									)}
									<button className="tcgb-qty-btn" onClick={() => changeQty(row, -1)}>
										−
									</button>
									<span className="tcgb-qty-value">{row.qty}</span>
									<button className="tcgb-qty-btn" onClick={() => changeQty(row, 1)}>
										+
									</button>
								</span>
							</div>
						</div>
					))}
				</div>
			) : layout.narrow ? (
				stackedRows
			) : (
				<div className="tcgb-table-wrap">
					<table className="tcgb-table">
						<thead>
							<tr>
								<th className="tcgb-cell-thumb" />
								<th>{t('view.col.card')}</th>
								<th>{t('view.col.set')}</th>
								<th>#</th>
								<th>{t('view.col.variant')}</th>
								<th>{t('view.col.condition')}</th>
								<th className="tcgb-cell-center">{t('view.col.playset')}</th>
								<th className="tcgb-cell-num">{t('view.col.qty')}</th>
								<th className="tcgb-cell-num">{t('view.col.price')}</th>
								{anyPaid && <th className="tcgb-cell-num">{t('view.col.paid')}</th>}
								<th className="tcgb-cell-num">{t('view.col.added')}</th>
								<th />
							</tr>
						</thead>
						<tbody>
							{filtered.map((row) => (
								<tr key={`${row.id}-${row.variant}-${row.condition}`}>
									<td className="tcgb-cell-thumb">
										{row.meta?.image ? (
											<img className="tcgb-thumb" loading="lazy" src={row.meta.image} alt="" />
										) : (
											<div className="tcgb-thumb tcgb-thumb-empty" />
										)}
									</td>
									<td>
										<a className="tcgb-card-link" onClick={() => openCard(row)}>
											{row.meta?.name ?? row.id}
										</a>
									</td>
									<td className="tcgb-cell-muted">
										{[row.meta?.setCode ?? row.meta?.setName].filter(Boolean).join('') || '—'}
									</td>
									<td className="tcgb-cell-muted">{row.meta?.number ?? '—'}</td>
									<td>
										<select
											className="tcgb-cell-select"
											value={row.variant}
											aria-label={t('view.col.variant')}
											onChange={(e) => rekey(row, e.target.value as CardVariant, row.condition)}
										>
											{CARD_VARIANTS.map((variant) => (
												<option key={variant} value={variant}>
													{t(`variant.${variant}`)}
												</option>
											))}
										</select>
									</td>
									<td>
										<select
											className={`tcgb-cell-select tcgb-cond tcgb-cond-${row.condition}`}
											value={row.condition}
											aria-label={t('view.col.condition')}
											onChange={(e) => rekey(row, row.variant, e.target.value as CardCondition)}
										>
											{CARD_CONDITIONS.map((condition) => (
												<option key={condition} value={condition}>
													{condition}
												</option>
											))}
										</select>
									</td>
									<td className="tcgb-cell-center">
										{(copiesByKey.get(keyOf(row)) ?? 0) >= 4 && (
											<span className="tcgb-playset" title={t('view.playset-tooltip')}>
												<svg
													className="tcgb-playset-icon"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													strokeWidth="3.5"
													strokeLinecap="round"
													strokeLinejoin="round"
													aria-hidden="true"
												>
													<path d="M20 6 9 17l-5-5" />
												</svg>
												4×
											</span>
										)}
									</td>
									<td className="tcgb-qty tcgb-cell-num">
										<button className="tcgb-qty-btn" onClick={() => changeQty(row, -1)}>
											−
										</button>
										<span className="tcgb-qty-value">{row.qty}</span>
										<button className="tcgb-qty-btn" onClick={() => changeQty(row, 1)}>
											+
										</button>
									</td>
									<td className="tcgb-cell-num">
										{row.meta?.priceMarket !== null && row.meta?.priceMarket !== undefined
											? `$${(row.qty * row.meta.priceMarket).toFixed(2)}`
											: '—'}
									</td>
									{anyPaid && (
										<td className="tcgb-cell-num tcgb-cell-muted">
											{row.paid !== null ? `$${(row.qty * row.paid).toFixed(2)}` : '—'}
										</td>
									)}
									<td className="tcgb-cell-num tcgb-cell-muted">{row.added ?? '—'}</td>
									<td className="tcgb-cell-actions">
										{isWishlist && (
											<button
												className="tcgb-row-action tcgb-acquire"
												aria-label={t('acq.received')}
												title={t('acq.received-hint')}
												onClick={() => acquire(row)}
											>
												✓
											</button>
										)}
										<button
											className="tcgb-row-action"
											aria-label={t('view.move')}
											title={t('view.move')}
											onClick={() => moveToCollection(row)}
										>
											→
										</button>
										<button
											className="tcgb-row-action"
											aria-label={t('view.add-variant')}
											title={t('view.add-variant')}
											onClick={() => addVariantLine(row)}
										>
											⧉
										</button>
										<button
											className="tcgb-remove"
											aria-label={t('view.remove')}
											title={t('view.remove')}
											onClick={() =>
												void plugin.collections.removeEntry(file, {
													id: row.id,
													variant: row.variant,
													condition: row.condition,
												})
											}
										>
											×
										</button>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

			{ownedSets.length > 0 && (
				<section className="tcgb-sets">
					<h3>{t('view.set-progress')}</h3>
					{ownedSets.map((set) => (
						<div key={set.setId} className="tcgb-set-row">
							<span className="tcgb-set-name">{set.name}</span>
							<div className="tcgb-progress">
								<div
									className="tcgb-progress-fill"
									style={{ transform: `scaleX(${set.percent / 100})` }}
								/>
							</div>
							<span className="tcgb-set-count">
								{set.owned}/{set.total || '?'} · {set.percent}%
							</span>
							{(() => {
								const state = completion[set.setId]
								if (state === undefined) {
									return (
										<button className="tcgb-cost-btn" onClick={() => loadCompletion(set.setId)}>
											{t('set.cost-button')}
										</button>
									)
								}
								if (state === 'loading') return <span className="tcgb-set-count">…</span>
								return (
									<span className="tcgb-set-cost">
										{t('set.cost', { missing: state.missing, cost: `$${state.cost.toFixed(2)}` })}
									</span>
								)
							})()}
						</div>
					))}
				</section>
			)}
		</div>
	)
}
