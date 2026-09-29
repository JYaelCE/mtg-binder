import { ItemView, WorkspaceLeaf, TFile, normalizePath, App, Modal, Setting, Notice } from 'obsidian';
import MTGBinderPlugin from '../main';
import { CardDetailModal } from './cardDetailModal';
import { AddCardModal } from './addCardModal';
import { DeckCreateModal } from './deckModal';
import { DeckCalculator } from '../utils/deckCalculator';

export const VIEW_TYPE_MTG_BINDER = 'mtg-binder-view';

interface Collection {
    name: string;
    query: string;
    colors: string[];
}

class SaveCollectionModal extends Modal {
    result: string = '';
    onSubmit: (result: string) => void;

    constructor(app: App, defaultName: string, onSubmit: (result: string) => void) {
        super(app);
        this.onSubmit = onSubmit;
        this.result = defaultName;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h3', { text: 'Guardar Colección Dinámica' });

        new Setting(contentEl)
            .setName('Nombre de la colección')
            .addText(text => {
                text.setValue(this.result);
                text.inputEl.focus();
                text.inputEl.select();
                text.onChange(value => {
                    this.result = value;
                });
                text.inputEl.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        this.close();
                        this.onSubmit(this.result);
                    }
                });
            });

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('Guardar')
                .setCta()
                .onClick(() => {
                    this.close();
                    this.onSubmit(this.result);
                }));
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

export class MTGBinderView extends ItemView {
    plugin: MTGBinderPlugin;
    currentViewMode: 'grid' | 'list' = 'grid';
    currentSearchQuery: string = '';
    currentSelectedColors: string[] = ['all'];
    currentSortBy: string = 'name-asc';
    activeCollectionName: string = 'Todas las cartas';
    activeStatusFilter: 'all' | 'owned' | 'wishlist' | 'decks' = 'all';
    selectedDeckFile: TFile | null = null; // NUEVO: Controla qué mazo se está visualizando en detalle

    constructor(leaf: WorkspaceLeaf, plugin: MTGBinderPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string { return VIEW_TYPE_MTG_BINDER; }
    getDisplayText(): string { return 'MTG Binder'; }
    getIcon(): string { return 'book-open'; }

    async onOpen() { await this.renderBinder(); }
    async onClose() {}

    async renderBinder() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('mtg-binder-container');

        const header = container.createDiv({ cls: 'mtg-binder-header' });
        
        const topHeader = header.createDiv({ cls: 'mtg-binder-top-row' });

        // Si estamos viendo el detalle de un mazo, mostramos el botón de regresar y el título del mazo
        if (this.selectedDeckFile) {
            const cache = this.app.metadataCache.getFileCache(this.selectedDeckFile);
            const deckName = cache?.frontmatter?.deck_name || this.selectedDeckFile.basename;
            
            const backBtn = topHeader.createEl('button', { text: '← Volver a Decks', cls: 'mtg-collection-btn' });
            backBtn.onclick = () => {
                this.selectedDeckFile = null;
                this.renderBinder();
            };

            topHeader.createEl('h2', { text: `Mazo: ${deckName}` });
            
            const deckContentContainer = container.createDiv({ cls: 'mtg-binder-deck-detail-main' });
            await this.renderDeckDetailInView(deckContentContainer, this.selectedDeckFile);
            return;
        }

        topHeader.createEl('h2', { text: 'Mi Carpeta de Colección' });

        const controls = topHeader.createDiv({ cls: 'mtg-binder-controls' });
        
        const addCardBtn = controls.createEl('button', { text: '+ Añadir Carta', cls: 'mod-cta' });
        addCardBtn.addEventListener('click', () => {
            new AddCardModal(this.app, this.plugin).open();
        });

        if (this.activeStatusFilter === 'decks') {
            const createDeckBtn = controls.createEl('button', { text: '+ Crear Mazo', cls: 'mod-cta' });
            createDeckBtn.onclick = () => {
                new DeckCreateModal(this.app, this.plugin).open();
            };
        }

        const searchInput = controls.createEl('input', {
            type: 'text',
            placeholder: 'Ej: type:legendary; subtype:wizard',
            cls: 'mtg-binder-search-input'
        });
        searchInput.value = this.currentSearchQuery;
        if (this.activeStatusFilter === 'decks') {
            searchInput.disabled = true;
            searchInput.placeholder = 'Filtro no disponible en Decks';
        }

        const sortSelect = controls.createEl('select', { cls: 'mtg-binder-sort-select' });
        const sortOptions = [
            { value: 'name-asc', text: 'Nombre (A - Z)' },
            { value: 'name-desc', text: 'Nombre (Z - A)' },
            { value: 'cmc-asc', text: 'Coste Maná (Menor a Mayor)' },
            { value: 'cmc-desc', text: 'Coste Maná (Mayor a Menor)' },
            { value: 'price-desc', text: 'Precio (Mayor a Menor)' },
            { value: 'price-asc', text: 'Precio (Menor a Mayor)' }
        ];
        
        sortOptions.forEach(opt => {
            const option = sortSelect.createEl('option', { value: opt.value, text: opt.text });
            if (opt.value === this.currentSortBy) option.selected = true;
        });

        if (this.activeStatusFilter !== 'decks') {
            const toggleButton = controls.createEl('button', { 
                text: this.currentViewMode === 'grid' ? 'Cambiar a Vista Lista' : 'Cambiar a Vista Grid',
                cls: 'mtg-collection-btn'
            });

            toggleButton.addEventListener('click', () => {
                this.currentViewMode = this.currentViewMode === 'grid' ? 'list' : 'grid';
                this.renderBinder();
            });
        }

        const statusFilterBar = header.createDiv({ cls: 'mtg-binder-collection-bar' });
        statusFilterBar.createSpan({ text: 'Vista:', cls: 'mtg-collection-label' });

        const statusOptions = [
            { id: 'all', label: 'Todas' },
            { id: 'owned', label: 'Poseídas' },
            { id: 'wishlist', label: 'Wishlist' },
            { id: 'decks', label: '📦 Decks' }
        ];

        statusOptions.forEach(st => {
            const isStActive = this.activeStatusFilter === st.id;
            const stBtn = statusFilterBar.createEl('button', {
                text: st.label,
                cls: `mtg-collection-btn ${isStActive ? 'active' : ''}`
            });
            stBtn.addEventListener('click', () => {
                this.activeStatusFilter = st.id as any;
                this.renderBinder();
            });
        });

        if (this.activeStatusFilter === 'decks') {
            const decksContainer = container.createDiv({ cls: 'mtg-binder-decks-main-container' });
            await this.renderDecksInView(decksContainer);
            return;
        }

        const collectionBar = header.createDiv({ cls: 'mtg-binder-collection-bar' });
        collectionBar.createSpan({ text: 'Colecciones:', cls: 'mtg-collection-label' });

        const allCollections: Collection[] = [
            { name: 'Todas las cartas', query: '', colors: ['all'] },
            ...(this.plugin.settings.savedCollections || [])
        ];

        allCollections.forEach(col => {
            const colBtn = collectionBar.createEl('button', {
                text: col.name,
                cls: `mtg-collection-btn ${this.activeCollectionName === col.name ? 'active' : ''}`
            });
            colBtn.addEventListener('click', () => {
                this.activeCollectionName = col.name;
                this.currentSearchQuery = col.query;
                this.currentSelectedColors = [...col.colors];
                this.renderBinder();
            });
        });

        const saveCollectionBtn = collectionBar.createEl('button', {
            text: '+ Guardar Colección',
            cls: 'mtg-save-collection-btn'
        });
        saveCollectionBtn.addEventListener('click', () => {
            const defaultName = this.currentSearchQuery.trim() ? this.currentSearchQuery : 'Mi Colección';
            new SaveCollectionModal(this.app, defaultName, async (name) => {
                if (name && name.trim() !== '') {
                    const newCol: Collection = {
                        name: name.trim(),
                        query: this.currentSearchQuery,
                        colors: [...this.currentSelectedColors]
                    };

                    if (!this.plugin.settings.savedCollections) {
                        this.plugin.settings.savedCollections = [];
                    }
                    this.plugin.settings.savedCollections.push(newCol);
                    await this.plugin.saveSettings();

                    this.activeCollectionName = newCol.name;
                    this.renderBinder();
                }
            }).open();
        });

        const colorBar = header.createDiv({ cls: 'mtg-binder-color-bar' });
        const colors = [
            { id: 'all', label: 'Todas', symbol: null },
            { id: 'w', label: 'White', symbol: 'W' },
            { id: 'u', label: 'Blue', symbol: 'U' },
            { id: 'b', label: 'Black', symbol: 'B' },
            { id: 'r', label: 'Red', symbol: 'R' },
            { id: 'g', label: 'Green', symbol: 'G' },
            { id: 'c', label: 'Incolora', symbol: 'C' }
        ];

        colors.forEach(col => {
            const isActive = this.currentSelectedColors.includes(col.id);
            const btn = colorBar.createEl('button', { 
                cls: `mtg-color-filter-btn mtg-color-${col.id} ${isActive ? 'active' : ''}` 
            });

            if (col.symbol) {
                btn.createEl('img', {
                    attr: {
                        src: `https://svgs.scryfall.io/card-symbols/${col.symbol}.svg`,
                        width: 18,
                        height: 18,
                        alt: col.label
                    },
                    cls: 'mtg-scryfall-mana-icon'
                });
            } else {
                btn.setText(col.label);
            }

            btn.addEventListener('click', () => {
                if (col.id === 'all') {
                    this.currentSelectedColors = ['all'];
                } else {
                    if (this.currentSelectedColors.includes('all')) {
                        this.currentSelectedColors = [];
                    }
                    
                    if (this.currentSelectedColors.includes(col.id)) {
                        this.currentSelectedColors = this.currentSelectedColors.filter(c => c !== col.id);
                        if (this.currentSelectedColors.length === 0) {
                            this.currentSelectedColors = ['all'];
                        }
                    } else {
                        this.currentSelectedColors.push(col.id);
                    }
                }
                this.activeCollectionName = '';
                this.renderBinder();
            });
        });

        const contentWrapper = container.createDiv({ 
            cls: this.currentViewMode === 'grid' ? 'mtg-binder-grid' : 'mtg-binder-list-view' 
        });

        const cardsFolder = normalizePath(this.plugin.settings.cardsFolder);
        const files = this.app.vault.getMarkdownFiles();
        let cardFiles = files.filter(file => file.path.startsWith(cardsFolder));

        if (cardFiles.length === 0) {
            contentWrapper.createDiv({ 
                text: 'No hay cartas en el Binder. Usa el botón superior para añadir alguna.',
                cls: 'mtg-binder-empty'
            });
            return;
        }

        const processAndRender = () => {
            contentWrapper.empty();
            const rawQuery = this.currentSearchQuery.trim();
            const conditions = rawQuery ? rawQuery.split(';').map(c => c.trim()).filter(Boolean) : [];

            let filteredFiles = cardFiles.map(file => {
                const cache = this.app.metadataCache.getFileCache(file);
                const frontmatter = cache?.frontmatter;
                return { file, frontmatter };
            }).filter(item => {
                const fm = item.frontmatter;
                if (!fm || fm['tcg-binder'] !== 'mtg-card') return false;

                const status = fm['status'] || 'owned';
                if (this.activeStatusFilter === 'owned' && status !== 'owned') return false;
                if (this.activeStatusFilter === 'wishlist' && status !== 'wishlist') return false;

                const name = String(fm.name || '').toLowerCase();
                const setCode = String(fm.set_code || '').toLowerCase();
                const typesArray = Array.isArray(fm.types) ? fm.types.map((t: string) => t.toLowerCase()) : [];
                const subtypesArray = Array.isArray(fm.subtypes) ? fm.subtypes.map((s: string) => s.toLowerCase()) : [];
                const typeLine = String(fm.type_line || '').toLowerCase();

                for (const cond of conditions) {
                    if (cond.includes(':')) {
                        const [field, ...valParts] = cond.split(':');
                        const fieldName = field.trim().toLowerCase();
                        const fieldValue = valParts.join(':').trim().toLowerCase();

                        if (fieldName === 'type') {
                            const matchesType = typesArray.some(t => t.includes(fieldValue)) || typeLine.includes(fieldValue);
                            if (!matchesType) return false;
                        } else if (fieldName === 'subtype') {
                            const matchesSubtype = subtypesArray.some(s => s.includes(fieldValue));
                            if (!matchesSubtype) return false;
                        } else if (fieldName === 'set') {
                            if (!setCode.includes(fieldValue)) return false;
                        } else {
                            if (!name.includes(cond.toLowerCase()) && !typeLine.includes(cond.toLowerCase())) return false;
                        }
                    } else {
                        const q = cond.toLowerCase();
                        const matchesGeneral = name.includes(q) || 
                                               typeLine.includes(q) || 
                                               setCode.includes(q) || 
                                               typesArray.some(t => t.includes(q)) || 
                                               subtypesArray.some(s => s.includes(q));
                        if (!matchesGeneral) return false;
                    }
                }

                if (!this.currentSelectedColors.includes('all')) {
                    let cardColors = fm.colors || fm.color_identity || [];
                    if (typeof cardColors === 'string') {
                        try { cardColors = JSON.parse(cardColors.replace(/'/g, '"')); } catch(e) { cardColors = []; }
                    }
                    if (!Array.isArray(cardColors)) cardColors = [];
                    const upperColors = cardColors.map((c: string) => c.toUpperCase());
                    const selectedUpper = this.currentSelectedColors.map(s => s.toUpperCase());

                    if (this.currentSelectedColors.includes('c')) {
                        if (upperColors.length > 0) return false;
                    } else {
                        if (upperColors.length === 0) {
                            return false;
                        }
                        const hasAtLeastOneSelectedColor = upperColors.some(col => selectedUpper.includes(col));
                        if (!hasAtLeastOneSelectedColor) return false;
                    }
                }

                return true;
            });

            filteredFiles.sort((a, b) => {
                const fmNodeA = a.frontmatter;
                const fmNodeB = b.frontmatter;

                switch (this.currentSortBy) {
                    case 'name-asc':
                        return String(fmNodeA.name || '').localeCompare(String(fmNodeB.name || ''));
                    case 'name-desc':
                        return String(fmNodeB.name || '').localeCompare(String(fmNodeA.name || ''));
                    case 'cmc-asc':
                        return (Number(fmNodeA.cmc) || 0) - (Number(fmNodeB.cmc) || 0);
                    case 'cmc-desc':
                        return (Number(fmNodeB.cmc) || 0) - (Number(fmNodeA.cmc) || 0);
                    case 'price-desc':
                        return (Number(fmNodeB.prices?.usd) || 0) - (Number(fmNodeA.prices?.usd) || 0);
                    case 'price-asc':
                        return (Number(fmNodeA.prices?.usd) || 0) - (Number(fmNodeB.prices?.usd) || 0);
                    default:
                        return 0;
                }
            });

            if (filteredFiles.length === 0) {
                contentWrapper.createDiv({
                    text: 'No se encontraron cartas que coincidan con los filtros seleccionados.',
                    cls: 'mtg-binder-empty'
                });
                return;
            }

            for (const item of filteredFiles) {
                if (this.currentViewMode === 'grid') {
                    this.renderGridItem(contentWrapper, item.file, item.frontmatter);
                } else {
                    this.renderListItem(contentWrapper, item.file, item.frontmatter);
                }
            }
        };

        searchInput.addEventListener('input', (e) => {
            this.currentSearchQuery = (e.target as HTMLInputElement).value;
            this.activeCollectionName = '';
            processAndRender();
        });

        sortSelect.addEventListener('change', (e) => {
            this.currentSortBy = (e.target as HTMLSelectElement).value;
            processAndRender();
        });

        processAndRender();
    }

    async renderDecksInView(container: HTMLElement) {
        container.empty();
        const files = this.app.vault.getMarkdownFiles();
        let deckFiles: TFile[] = [];

        for (const file of files) {
            const cache = this.app.metadataCache.getFileCache(file);
            const fm = cache?.frontmatter;
            if (fm && fm['tcg-binder'] === 'mtg-deck') {
                deckFiles.push(file);
            }
        }

        if (deckFiles.length === 0) {
            const emptyEl = container.createDiv({ cls: 'mtg-binder-empty' });
            emptyEl.createEl('p', { text: 'No tienes ningún mazo creado todavía.' });
            const createBtn = emptyEl.createEl('button', { text: '+ Crear tu primer mazo', cls: 'mod-cta' });
            createBtn.onclick = () => {
                new DeckCreateModal(this.app, this.plugin).open();
            };
            return;
        }

        const listContainer = container.createDiv({ cls: 'mtg-deck-list-container' });

        deckFiles.forEach(file => {
            const cache = this.app.metadataCache.getFileCache(file);
            const fm = cache?.frontmatter || {};
            const deckName = fm.deck_name || file.basename;
            const format = fm.format || 'Casual';
            const cards = Array.isArray(fm.cards) ? fm.cards : [];

            const deckCardEl = listContainer.createDiv({ cls: 'mtg-deck-item-card' });
            
            const infoDiv = deckCardEl.createDiv();
            infoDiv.createEl('h3', { text: deckName, cls: 'mtg-deck-title' });
            infoDiv.createEl('p', { text: `Formato: ${format} • Total de cartas: ${cards.reduce((acc: number, c: any) => acc + (Number(c.count) || 1), 0)}`, cls: 'mtg-deck-subtitle' });

            const btnContainer = deckCardEl.createDiv({ cls: 'mtg-deck-btn-container' });
            const viewBtn = btnContainer.createEl('button', { text: 'Ver Detalle', cls: 'mod-cta' });
            
            // Al hacer clic, asignamos el mazo seleccionado y renderizamos de nuevo la vista en modo detalle
            viewBtn.onclick = () => {
                this.selectedDeckFile = file;
                this.renderBinder();
            };
        });
    }

    async renderDeckDetailInView(container: HTMLElement, file: TFile) {
        container.empty();
        const cache = this.app.metadataCache.getFileCache(file);
        const fm = cache?.frontmatter || {};
        const format = fm.format || 'Casual';
        const cards = Array.isArray(fm.cards) ? fm.cards : [];

        container.createEl('p', { text: `Formato: ${format}`, cls: 'setting-item-description' });

        const calculator = new DeckCalculator(this.app, this.plugin.settings);
        const deficits = await calculator.getInventoryDeficits();

        const listContainer = container.createDiv({ cls: 'mtg-deck-cards-container' });
        
        if (cards.length === 0) {
            listContainer.createDiv({ text: 'Este mazo aún no tiene cartas registradas.', cls: 'mtg-binder-empty' });
            return;
        }

        cards.forEach((card: any) => {
            const row = listContainer.createDiv({ cls: 'mtg-deck-card-row' });
            row.createSpan({ text: `${card.count}x `, cls: 'mtg-deck-card-count' });
            row.createSpan({ text: card.name, cls: 'mtg-deck-card-name' });
            row.createSpan({ text: `(${card.set_code?.toUpperCase()})`, cls: 'mtg-deck-card-set' });

            const uniqueKey = `${card.set_code}_${card.collector_number}`.toLowerCase();
            const deficitInfo = deficits.find(d => `${d.setCode}_${d.collectorNumber}`.toLowerCase() === uniqueKey);

            if (deficitInfo) {
                const warningTag = row.createSpan({ cls: 'mtg-deck-deficit-badge' });
                warningTag.setText(`⚠️ Faltan ${deficitInfo.deficit} (Tienes ${deficitInfo.ownedCount}/${deficitInfo.totalDemand})`);
            } else {
                const okTag = row.createSpan({ cls: 'mtg-deck-ok-badge' });
                okTag.setText('✓ Stock OK');
            }
        });
    }

    private renderGridItem(parent: HTMLElement, file: TFile, frontmatter: any) {
        const status = frontmatter.status || 'owned';
        const pocket = parent.createDiv({ cls: `mtg-binder-pocket ${status === 'wishlist' ? 'mtg-wishlist-pocket' : ''}` });

        pocket.addEventListener('click', () => {
            const modal = new CardDetailModal(this.app, file);
            modal.open();
        });

        const imageUrl = frontmatter.image_url;
        if (imageUrl) {
            pocket.createEl('img', { 
                attr: { src: imageUrl, alt: frontmatter.name || file.basename },
                cls: 'mtg-card-image'
            });
        } else {
            pocket.createDiv({ cls: 'mtg-card-no-image', text: frontmatter.name || file.basename });
        }

        if (status === 'wishlist') {
            pocket.createDiv({ cls: 'mtg-card-wishlist-badge', text: '★ Deseo' });
        }

        const count = frontmatter.count || 1;
        if (count > 1) {
            pocket.createDiv({ cls: 'mtg-card-count', text: `x${count}` });
        }

        const footer = pocket.createEl('div', { cls: 'mtg-card-footer' });
        footer.createEl('div', { cls: 'mtg-card-name', text: frontmatter.name || file.basename });

        const setCode = (frontmatter.set_code || '').toUpperCase();
        const price = frontmatter.prices?.usd ? `$${frontmatter.prices.usd}` : 'N/A';
        const finish = frontmatter.finish || 'Regular';
        const foilIcon = finish === 'Foil' ? ' ✨ Foil' : ' (Regular)';

        footer.createEl('div', { 
            cls: 'mtg-card-price', 
            text: `${setCode} #${frontmatter.collector_number || ''}${foilIcon} • ${price}` 
        });
    }

    private renderListItem(parent: HTMLElement, file: TFile, frontmatter: any) {
        const status = frontmatter.status || 'owned';
        const row = parent.createDiv({ cls: `mtg-list-row ${status === 'wishlist' ? 'mtg-wishlist-row' : ''}` });

        row.addEventListener('click', () => {
            const modal = new CardDetailModal(this.app, file);
            modal.open();
        });

        const imgWrapper = row.createDiv({ cls: 'mtg-list-img-wrapper' });
        const imageUrl = frontmatter.image_url;
        if (imageUrl) {
            imgWrapper.createEl('img', { 
                attr: { src: imageUrl, alt: frontmatter.name || file.basename },
                cls: 'mtg-list-thumb'
            });
        } else {
            imgWrapper.createDiv({ text: 'Sin img', cls: 'mtg-list-no-thumb' });
        }

        const count = frontmatter.count || 1;
        row.createDiv({ cls: 'mtg-list-col mtg-list-count', text: `${count}x` });

        const nameCol = row.createDiv({ cls: 'mtg-list-col mtg-list-name-col' });
        nameCol.createSpan({ text: frontmatter.name || file.basename });
        
        if (status === 'wishlist') {
            nameCol.createSpan({ text: ' [Wishlist]', cls: 'mtg-list-wishlist-tag' });
        }

        const finish = frontmatter.finish || 'Regular';
        if (finish === 'Foil') {
            nameCol.createSpan({ text: ' ✨', cls: 'mtg-foil-star' });
        }

        const manaCost = frontmatter.mana_cost || '';
        const manaCol = row.createDiv({ cls: 'mtg-list-col mtg-list-mana' });
        
        if (manaCost) {
            manaCost
                .split("//")
                .map((part: string) => part.trim())
                .forEach((part: string, index: number) => {
                    if (index > 0) {
                        manaCol.createSpan({ cls: "card-cost-divider", text: " // " });
                    }
                    part
                        .replace(/\//g, "")
                        .split("{")
                        .slice(1)
                        .forEach((symbol: string) => {
                            const cleanSymbol = symbol.slice(0, -1);
                            manaCol.createEl("img", {
                                attr: {
                                    src: `https://svgs.scryfall.io/card-symbols/${cleanSymbol}.svg`,
                                    width: 18,
                                    height: 18,
                                },
                                cls: "mtg-scryfall-mana-icon"
                            });
                        });
                });
        } else {
            manaCol.setText('-');
        }

        const price = frontmatter.prices?.usd ? `$${frontmatter.prices.usd} USD` : 'N/A';
        row.createDiv({ cls: 'mtg-list-col mtg-list-price', text: price });
    }
}