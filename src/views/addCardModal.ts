import { App, Modal, Setting, Notice, normalizePath, TFile } from 'obsidian';
import MTGBinderPlugin from '../main';

export class AddCardModal extends Modal {
    plugin: MTGBinderPlugin;
    searchQuery: string = '';
    count: number = 1;
    finish: string = 'Regular';
    isWishlist: boolean = false;
    searchResults: any[] = [];
    selectedCard: any = null;
    searchTimeout: any = null;

    constructor(app: App, plugin: MTGBinderPlugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('mtg-import-modal');
        contentEl.addClass('mtg-add-card-modal-root');

        contentEl.createEl('h2', { text: 'Añadir Carta al Sistema' });
        contentEl.createEl('p', { 
            text: 'Escribe el nombre de la carta para explorar todas sus variantes y artes. Elige si es poseída o va a la Wishlist.',
            cls: 'setting-item-description'
        });

        const searchInputContainer = contentEl.createDiv({ cls: 'mtg-add-search-container' });
        
        new Setting(searchInputContainer)
            .setName('Buscar carta')
            .addText(text => {
                text.setPlaceholder('Ej: Vivi Ornitier, Lightning Bolt...');
                text.inputEl.focus();
                
                text.onChange(value => {
                    this.searchQuery = value;
                    if (this.searchTimeout) clearTimeout(this.searchTimeout);
                    
                    if (value.trim().length < 2) {
                        this.searchResults = [];
                        this.renderResults();
                        return;
                    }

                    this.searchTimeout = setTimeout(async () => {
                        await this.performLiveSearch(value.trim());
                    }, 400);
                });
            });

        const feedbackContainer = contentEl.createDiv({ cls: 'mtg-add-selection-feedback' });
        feedbackContainer.id = 'mtg-selection-feedback-bar';
        feedbackContainer.setText('Ninguna variante seleccionada.');

        const resultsContainer = contentEl.createDiv({ cls: 'mtg-add-results-container' });
        resultsContainer.id = 'mtg-live-search-results';

        const optionsContainer = contentEl.createDiv({ cls: 'mtg-add-options-container' });
        
        new Setting(optionsContainer)
            .setName('Acabado')
            .addDropdown(dropdown => dropdown
                .addOption('Regular', 'Regular')
                .addOption('Foil', 'Foil')
                .setValue('Regular')
                .onChange(value => {
                    this.finish = value;
                }));

        new Setting(optionsContainer)
            .setName('¿Agregar a la Wishlist?')
            .setDesc('Actívalo si deseas marcarla como un deseo de compra/intercambio.')
            .addToggle(toggle => toggle
                .setValue(false)
                .onChange(value => {
                    this.isWishlist = value;
                }));

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('Añadir al Sistema')
                .setCta()
                .onClick(async () => {
                    if (!this.selectedCard) {
                        new Notice('Por favor, selecciona una variante de la cuadrícula.');
                        return;
                    }
                    await this.saveCardMarkdown(this.selectedCard);
                    this.close();
                }));
    }

    async performLiveSearch(query: string) {
        try {
            const response = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&unique=prints`);
            if (!response.ok) {
                this.searchResults = [];
                this.renderResults();
                return;
            }

            const data = await response.json();
            this.searchResults = data.data ? data.data.slice(0, 60) : [];
            this.renderResults();
        } catch (err) {
            console.error('[MTG Binder] Error en live search:', err);
        }
    }

    renderResults() {
        const container = this.contentEl.querySelector('#mtg-live-search-results');
        if (!container) return;
        container.empty();

        if (this.searchResults.length === 0) {
            if (this.searchQuery.trim().length >= 2) {
                container.createDiv({ text: 'No se encontraron cartas.', cls: 'mtg-binder-empty' });
            }
            return;
        }

        const gridEl = container.createDiv({ cls: 'mtg-add-card-grid' });

        this.searchResults.forEach((card) => {
            const itemEl = gridEl.createDiv({ cls: 'mtg-add-grid-item' });
            
            if (this.selectedCard && this.selectedCard.id === card.id) {
                itemEl.addClass('selected');
            }

            const imgUrl = card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal || '';
            if (imgUrl) {
                itemEl.createEl('img', { attr: { src: imgUrl, alt: card.name }, cls: 'mtg-add-grid-thumb' });
            } else {
                const noThumb = itemEl.createDiv({ cls: 'mtg-add-grid-nothumb' });
                noThumb.setText('Sin imagen');
            }

            const infoEl = itemEl.createDiv({ cls: 'mtg-add-grid-info' });
            infoEl.createEl('div', { text: card.name, cls: 'mtg-add-grid-name' });
            infoEl.createEl('div', { 
                text: `${card.set.toUpperCase()} • #${card.collector_number}`, 
                cls: 'mtg-add-grid-details' 
            });

            itemEl.addEventListener('click', () => {
                this.selectedCard = card;
                
                gridEl.querySelectorAll('.mtg-add-grid-item').forEach(el => el.removeClass('selected'));
                itemEl.addClass('selected');

                const feedbackBar = this.contentEl.querySelector('#mtg-selection-feedback-bar');
                if (feedbackBar) {
                    feedbackBar.setText(`✔ Seleccionado: ${card.name} (${card.set.toUpperCase()} - #${card.collector_number})`);
                    feedbackBar.addClass('active-feedback');
                }

                new Notice(`Seleccionada: ${card.name} (${card.set.toUpperCase()} #${card.collector_number})`);
            });
        });
    }

    async saveCardMarkdown(cardData: any) {
        const folderPath = normalizePath(this.plugin.settings.cardsFolder);
        
        const folders = folderPath.split('/');
        let currentPath = '';
        for (const folder of folders) {
            currentPath = currentPath ? `${currentPath}/${folder}` : folder;
            if (!this.app.vault.getAbstractFileByPath(currentPath)) {
                await this.app.vault.createFolder(currentPath);
            }
        }

        const cardName = cardData.name;
        const setCode = cardData.set;
        const collectorNum = cardData.collector_number;
        const sanitizedName = cardName.replace(/[/\\?%*:|"<>]/g, '-');
        const fileName = `${folderPath}/${sanitizedName} (${setCode.toUpperCase()}-${collectorNum}).md`;

        const priceUsd = this.finish === 'Foil' 
            ? (cardData.prices?.usd_foil || cardData.prices?.usd || '0.00') 
            : (cardData.prices?.usd || '0.00');

        const imageUrl = cardData.image_uris?.normal || cardData.card_faces?.[0]?.image_uris?.normal || '';
        const typeLine = cardData.type_line || '';
        let types: string[] = [];
        let subtypes: string[] = [];

        if (typeLine.includes('—')) {
            const parts = typeLine.split('—');
            types = parts[0].trim().split(' ').map((t: string) => t.trim());
            subtypes = parts[1].trim().split(' ').map((s: string) => s.trim());
        } else {
            types = typeLine.split(' ').map((t: string) => t.trim());
        }

        const status = this.isWishlist ? 'wishlist' : 'owned';

        const fileContent = `---
tcg-binder: mtg-card
game: mtg
status: "${status}"
name: "${cardName}"
set_code: "${setCode}"
collector_number: "${collectorNum}"
count: ${this.count}
finish: "${this.finish}"
mana_cost: "${cardData.mana_cost || ''}"
cmc: ${cardData.cmc || 0}
types:
${types.map(t => `  - "${t}"`).join('\n')}
subtypes:
${subtypes.map(s => `  - "${s}"`).join('\n')}
colors: ${JSON.stringify(cardData.colors || [])}
color_identity: ${JSON.stringify(cardData.color_identity || [])}
type_line: "${typeLine}"
rarity: "${cardData.rarity || ''}"
prices:
  usd: "${priceUsd}"
image_url: "${imageUrl}"
---

# ${cardName}

![Card Image](${imageUrl})
`;

        const existingFile = this.app.vault.getAbstractFileByPath(fileName);
        if (existingFile instanceof TFile) {
            await this.app.vault.process(existingFile, (content) => {
                const countMatch = content.match(/count:\s*(\d+)/);
                if (countMatch) {
                    const currentCount = parseInt(countMatch[1], 10);
                    const newCount = currentCount + this.count;
                    return content.replace(/count:\s*\d+/, `count: ${newCount}`);
                }
                return content;
            });
            new Notice(`La carta ya existía. Se incrementó la cantidad en +${this.count}.`);
        } else {
            await this.app.vault.create(fileName, fileContent);
            const destino = this.isWishlist ? 'Wishlist' : 'Binder';
            new Notice(`¡Carta "${cardName}" añadida a la ${destino} con éxito!`);
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}