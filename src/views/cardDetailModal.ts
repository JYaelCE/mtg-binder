import { App, Modal, TFile, Notice } from 'obsidian';

export class CardDetailModal extends Modal {
    file: TFile;
    app: App;

    constructor(app: App, file: TFile) {
        super(app);
        this.app = app;
        this.file = file;
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('mtg-card-modal');

        const cache = this.app.metadataCache.getFileCache(this.file);
        const fm = cache?.frontmatter || {};

        const name = fm.name || this.file.basename;
        const imageUrl = fm.image_url || '';
        const manaCost = fm.mana_cost || '';
        const typeLine = fm.type_line || '';
        const oracleText = fm.oracle_text || '';
        const power = fm.power;
        const toughness = fm.toughness;
        const loyalty = fm.loyalty;
        const rarity = fm.rarity || '';
        const setCode = (fm.set_code || '').toUpperCase();
        const collectorNumber = fm.collector_number || '';
        const finish = fm.finish || 'Regular';
        const price = fm.prices?.usd ? `$${fm.prices.usd} USD` : 'N/A';
        const status = fm.status || 'owned';
        let currentCount = typeof fm.count === 'number' ? fm.count : 1;

        const container = contentEl.createDiv({ cls: 'mtg-modal-container' });

        const imgCol = container.createDiv({ cls: 'mtg-modal-img-col' });
        if (imageUrl) {
            imgCol.createEl('img', { attr: { src: imageUrl, alt: name }, cls: 'mtg-modal-image' });
        } else {
            imgCol.createDiv({ text: 'Imagen no disponible', cls: 'mtg-modal-no-img' });
        }

        const infoCol = container.createDiv({ cls: 'mtg-modal-info-col' });
        infoCol.createEl('h2', { text: name, cls: 'mtg-modal-title' });

        // Costo de maná con íconos de Scryfall
        if (manaCost) {
            const manaContainer = infoCol.createDiv({ cls: 'mtg-modal-mana' });
            manaContainer.createSpan({ text: 'Costo: ' });
            
            manaCost
                .split("//")
                .map((part: string) => part.trim())
                .forEach((part: string, index: number) => {
                    if (index > 0) {
                        manaContainer.createSpan({ cls: "card-cost-divider", text: " // " });
                    }
                    part
                        .replace(/\//g, "")
                        .split("{")
                        .slice(1)
                        .forEach((symbol: string) => {
                            const cleanSymbol = symbol.slice(0, -1);
                            manaContainer.createEl("img", {
                                attr: {
                                    src: `https://svgs.scryfall.io/card-symbols/${cleanSymbol}.svg`,
                                    width: 18,
                                    height: 18,
                                },
                                cls: "mtg-scryfall-mana-icon"
                            });
                        });
                });
        }

        infoCol.createEl('div', { text: typeLine, cls: 'mtg-modal-type' });

        if (oracleText) {
            const oracleBox = infoCol.createDiv({ cls: 'mtg-modal-oracle' });
            oracleText.split('\n').forEach((line: string) => {
                if (line === '---') {
                    oracleBox.createEl('hr');
                } else {
                    oracleBox.createEl('p', { text: line });
                }
            });
        }

        if (power && toughness) {
            infoCol.createEl('div', { text: `Poder / Resistencia: ${power} / ${toughness}`, cls: 'mtg-modal-stats' });
        }
        if (loyalty) {
            infoCol.createEl('div', { text: `Lealtad Inicial: ${loyalty}`, cls: 'mtg-modal-stats' });
        }

        infoCol.createEl('hr', { cls: 'mtg-modal-divider' });

        const metaBox = infoCol.createDiv({ cls: 'mtg-modal-meta' });
        metaBox.createEl('p', { text: `Set: ${setCode} • #${collectorNumber}` });
        metaBox.createEl('p', { text: `Acabado: ${finish === 'Foil' ? '✨ Foil' : 'Regular'}` });
        metaBox.createEl('p', { text: `Rareza: ${rarity.toUpperCase()}` });
        
        // Indicador de estado actual
        const statusText = status === 'wishlist' ? '★ En Wishlist (Deseada)' : '✓ Poseída (Físico)';
        const statusEl = metaBox.createEl('p', { cls: `mtg-modal-status-badge ${status === 'wishlist' ? 'wishlist' : 'owned'}` });
        statusEl.setText(`Estado: ${statusText}`);

        // --- CONTROL INTERACTIVO DE CANTIDAD ---
        const countRow = metaBox.createDiv({ cls: 'mtg-modal-count-row' });
        const countLabelText = status === 'wishlist' ? 'Copias deseadas: ' : 'Copias físicas: ';
        countRow.createSpan({ text: countLabelText });

        const btnMinus = countRow.createEl('button', { text: '-', cls: 'mtg-count-btn' });
        const countDisplay = countRow.createSpan({ text: `${currentCount}`, cls: 'mtg-count-display' });
        const btnPlus = countRow.createEl('button', { text: '+', cls: 'mtg-count-btn' });

        const updateCountInVault = async (newCount: number) => {
            if (newCount < 1) return;
            currentCount = newCount;
            countDisplay.setText(`${currentCount}`);

            await this.app.vault.process(this.file, (content) => {
                if (/count:\s*\d+/.test(content)) {
                    return content.replace(/count:\s*\d+/, `count: ${currentCount}`);
                }
                return content;
            });
            new Notice(`Cantidad actualizada a ${currentCount}`);
        };

        btnMinus.onclick = async () => {
            if (currentCount > 1) {
                await updateCountInVault(currentCount - 1);
            }
        };

        btnPlus.onclick = async () => {
            await updateCountInVault(currentCount + 1);
        };
        // ----------------------------------------

        // --- BOTÓN PARA CAMBIAR DE ESTADO (WISHLIST <-> POSEÍDA) ---
        const actionRow = metaBox.createDiv({ cls: 'mtg-modal-action-row' });
        const toggleStatusBtn = actionRow.createEl('button', { 
            text: status === 'wishlist' ? '✓ Marcar como Poseída (Obtenida)' : '★ Mover a Wishlist',
            cls: 'mod-cta mtg-toggle-status-btn'
        });

        toggleStatusBtn.onclick = async () => {
            const newStatus = status === 'wishlist' ? 'owned' : 'wishlist';
            
            await this.app.vault.process(this.file, (content) => {
                if (/status:\s*"?[a-zA-Z]+"?[ \t]*\n/.test(content)) {
                    return content.replace(/status:\s*"?[a-zA-Z]+"?[ \t]*\n/, `status: "${newStatus}"\n`);
                }
                return content;
            });

            new Notice(newStatus === 'owned' ? '¡Carta movida a Poseídas con éxito!' : 'Carta movida a la Wishlist.');
            this.close();
        };
        // -----------------------------------------------------------

        const priceEl = metaBox.createEl('p', { cls: 'mtg-modal-price' });
        priceEl.setText(`Precio de mercado: ${price}`);
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}