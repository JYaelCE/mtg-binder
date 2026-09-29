import { Plugin, Notice, PluginSettingTab, Setting, App, normalizePath } from 'obsidian';
import { MTGBinderView, VIEW_TYPE_MTG_BINDER } from './views/binderView';
import { ImportModal } from './views/importModal';
import { AddCardModal } from './views/addCardModal';
import { DeckCreateModal } from './views/deckModal';

interface CollectionSetting {
    name: string;
    query: string;
    colors: string[];
}

interface MTGBinderSettings {
    cardsFolder: string;
    savedCollections: CollectionSetting[];
}

const DEFAULT_SETTINGS: MTGBinderSettings = {
    cardsFolder: 'MTG Binder/cards',
    savedCollections: []
}

export default class MTGBinderPlugin extends Plugin {
    settings: MTGBinderSettings;

    async onload() {
        await this.loadSettings();

        // Registrar la vista del Binder (Cuadrícula / Lista / Decks integrados)
        this.registerView(
            VIEW_TYPE_MTG_BINDER,
            (leaf) => new MTGBinderView(leaf, this)
        );

        // Icono en la barra lateral
        this.addRibbonIcon('book-open', 'Abrir MTG Binder', () => {
            this.activateView();
        });

        // Comandos del plugin
        this.addCommand({
            id: 'open-mtg-binder',
            name: 'Abrir MTG Binder',
            callback: () => { this.activateView(); }
        });

        this.addCommand({
            id: 'import-mtg-list',
            name: 'Importar lista de Moxfield / Cartas',
            callback: () => { new ImportModal(this.app, this).open(); }
        });

        this.addCommand({
            id: 'add-single-mtg-card',
            name: 'Añadir carta individual al Binder',
            callback: () => { new AddCardModal(this.app, this).open(); }
        });

        this.addCommand({
            id: 'update-mtg-binder-prices',
            name: 'Actualizar precios de todas las cartas del Binder',
            callback: () => { this.updateAllPrices(); }
        });

        // Comando rápido para crear un nuevo Mazo
        this.addCommand({
            id: 'mtg-create-deck',
            name: 'Crear nuevo Mazo',
            callback: () => { new DeckCreateModal(this.app, this).open(); }
        });

        this.addSettingTab(new MTGBinderSettingTab(this.app, this));
    }

    async onunload() {}

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async activateView() {
        const { workspace } = this.app;
        let leaf = workspace.getLeavesOfType(VIEW_TYPE_MTG_BINDER)[0];

        if (!leaf) {
            const centerLeaf = workspace.getMostRecentLeaf() || workspace.getLeaf(true);
            leaf = centerLeaf;
            await leaf.setViewState({ type: VIEW_TYPE_MTG_BINDER, active: true });
        }

        if (leaf) {
            workspace.revealLeaf(leaf);
        }
    }

    async updateAllPrices() {
        const normalizedFolder = normalizePath(this.settings.cardsFolder);
        const files = this.app.vault.getMarkdownFiles();
        let updatedCount = 0;
        
        new Notice('Iniciando actualización masiva de precios...');

        for (const file of files) {
            if (!file.path.startsWith(normalizedFolder)) continue;

            const cache = this.app.metadataCache.getFileCache(file);
            const frontmatter = cache?.frontmatter;

            if (frontmatter && frontmatter['tcg-binder'] === 'mtg-card' && frontmatter['game'] === 'mtg') {
                const setCode = frontmatter.set_code;
                const collectorNumber = frontmatter.collector_number;
                const isFoil = frontmatter.finish === 'Foil';

                if (!setCode || !collectorNumber) continue;

                try {
                    const response = await fetch(`https://api.scryfall.com/cards/${setCode}/${collectorNumber}`);
                    if (response.ok) {
                        const cardData = await response.json();
                        const newPrice = isFoil 
                            ? (cardData.prices?.usd_foil || cardData.prices?.usd || null)
                            : (cardData.prices?.usd || null);

                        if (newPrice !== null) {
                            await this.app.vault.process(file, (content) => {
                                return content.replace(/usd:\s*"?[0-9.]+"?/g, `usd: "${newPrice}"`);
                            });
                            updatedCount++;
                        }
                    }
                } catch (err) {
                    console.error(`[MTG Binder] Error actualizando precio para ${file.basename}:`, err);
                }

                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        new Notice(`¡Actualización de precios finalizada! Se actualizaron ${updatedCount} cartas.`);
    }
}

class MTGBinderSettingTab extends PluginSettingTab {
    plugin: MTGBinderPlugin;

    constructor(app: App, plugin: MTGBinderPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Configuración de MTG Binder' });

        new Setting(containerEl)
            .setName('Carpeta de Cartas')
            .setDesc('Ruta en tu Vault donde se guardarán los archivos Markdown.')
            .addText(text => text
                .setPlaceholder('MTG Binder/cards')
                .setValue(this.plugin.settings.cardsFolder)
                .onChange(async (value) => {
                    this.plugin.settings.cardsFolder = value;
                    await this.plugin.saveSettings();
                }));
    }
}