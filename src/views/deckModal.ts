import { App, Modal, TFile, normalizePath, Notice, Setting } from 'obsidian';
import { DeckCalculator } from '../utils/deckCalculator';

export class DeckCreateModal extends Modal {
    constructor(app, plugin) {
        super(app);
        this.plugin = plugin;
        this.deckName = '';
        this.deckFormat = 'Commander';
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('mtg-card-modal');

        contentEl.createEl('h2', { text: 'Crear Nuevo Mazo' });

        new Setting(contentEl)
            .setName('Nombre del mazo')
            .addText(text => text
                .setPlaceholder('Ej: Control Dimir')
                .onChange(val => this.deckName = val));

        new Setting(contentEl)
            .setName('Formato')
            .addDropdown(dropdown => dropdown
                .addOption('Commander', 'Commander')
                .addOption('Modern', 'Modern')
                .addOption('Standard', 'Standard')
                .addOption('Pioneer', 'Pioneer')
                .addOption('Legacy', 'Legacy')
                .addOption('Pauper', 'Pauper')
                .addOption('Casual', 'Casual')
                .setValue('Commander')
                .onChange(val => this.deckFormat = val));

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('Crear Mazo')
                .setCta()
                .onClick(async () => {
                    if (!this.deckName.trim()) {
                        new Notice('Por favor, ingresa un nombre válido para el mazo.');
                        return;
                    }
                    await this.createDeckFile();
                    this.close();
                }));
    }

    async createDeckFile() {
        const folderPath = normalizePath('MTG Binder/Decks');
        
        const folders = folderPath.split('/');
        let currentPath = '';
        for (const folder of folders) {
            currentPath = currentPath ? `${currentPath}/${folder}` : folder;
            if (!this.app.vault.getAbstractFileByPath(currentPath)) {
                await this.app.vault.createFolder(currentPath);
            }
        }

        const sanitizedName = this.deckName.replace(/[/\\?%*:|"<>]/g, '-');
        const fileName = `${folderPath}/${sanitizedName}.md`;

        const fileContent = `---
tcg-binder: mtg-deck
deck_name: "${this.deckName.trim()}"
format: "${this.deckFormat}"
cards: []
---

# ${this.deckName.trim()}

## Cartas del Mazo
`;

        const existingFile = this.app.vault.getAbstractFileByPath(fileName);
        if (existingFile) {
            new Notice('Ya existe un mazo con ese nombre.');
            return;
        }

        await this.app.vault.create(fileName, fileContent);
        // Ahora solo lanzamos la notificación y cerramos el modal limpiamente
        new Notice(`¡Mazo "${this.deckName}" creado con éxito!`);
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

export class DeckDetailModal extends Modal {
    constructor(app, plugin, file) {
        super(app);
        this.plugin = plugin;
        this.file = file;
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('mtg-card-modal');

        const cache = this.app.metadataCache.getFileCache(this.file);
        const fm = cache?.frontmatter || {};
        const deckName = fm.deck_name || this.file.basename;
        const cards = Array.isArray(fm.cards) ? fm.cards : [];

        const headerRow = contentEl.createDiv({ cls: 'mtg-deck-detail-header' });
        headerRow.createEl('h2', { text: deckName });
        
        contentEl.createEl('p', { text: `Formato: ${fm.format || 'Casual'}`, cls: 'setting-item-description' });

        const calculator = new DeckCalculator(this.app, this.plugin.settings);
        const deficits = await calculator.getInventoryDeficits();

        const listContainer = contentEl.createDiv({ cls: 'mtg-deck-cards-container' });
        
        if (cards.length === 0) {
            listContainer.createDiv({ text: 'Este mazo aún no tiene cartas registradas en su Frontmatter.', cls: 'mtg-binder-empty' });
            return;
        }

        cards.forEach((card) => {
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

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}