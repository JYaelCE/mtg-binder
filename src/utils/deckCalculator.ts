import { App, TFile, normalizePath } from 'obsidian';

export interface DeckCardDemand {
    name: string;
    setCode: string;
    collectorNumber: string;
    totalDemand: number;
    decksUsing: { deckName: string; count: number }[];
}

export class DeckCalculator {
    app: App;
    pluginSettings: any;

    constructor(app: App, pluginSettings: any) {
        this.app = app;
        this.pluginSettings = pluginSettings;
    }

    /**
     * Escanea todos los archivos de mazos y calcula la demanda total por cada carta única.
     */
    async calculateAggregateDemand(): Promise<Map<string, DeckCardDemand>> {
        const demandMap = new Map<string, DeckCardDemand>();
        const files = this.app.vault.getMarkdownFiles();

        for (const file of files) {
            const cache = this.app.metadataCache.getFileCache(file);
            const fm = cache?.frontmatter;

            if (fm && fm['tcg-binder'] === 'mtg-deck' && Array.isArray(fm.cards)) {
                const deckName = fm.deck_name || file.basename;

                for (const deckCard of fm.cards) {
                    const cardName = deckCard.name || '';
                    const setCode = (deckCard.set_code || '').toLowerCase();
                    const collectorNum = String(deckCard.collector_number || '');
                    const count = Number(deckCard.count) || 1;

                    // Clave única basada en Set y Número de Colector (garantiza precisión de prints)
                    const uniqueKey = `${setCode}_${collectorNum}`.toLowerCase();

                    if (!demandMap.has(uniqueKey)) {
                        demandMap.set(uniqueKey, {
                            name: cardName,
                            setCode: setCode,
                            collectorNumber: collectorNum,
                            totalDemand: 0,
                            decksUsing: []
                        });
                    }

                    const entry = demandMap.get(uniqueKey)!;
                    entry.totalDemand += count;
                    entry.decksUsing.push({ deckName, count });
                }
            }
        }

        return demandMap;
    }

    /**
     * Compara la demanda de los mazos con el inventario físico en el Binder y calcula déficits.
     */
    async getInventoryDeficits(): Promise<any[]> {
        const demandMap = await this.calculateAggregateDemand();
        const cardsFolder = normalizePath(this.pluginSettings.cardsFolder || 'MTG Binder/Cards');
        const files = this.app.vault.getMarkdownFiles();

        // Mapear el inventario físico actual (poseídas)
        const physicalInventory = new Map<string, number>();

        for (const file of files) {
            if (!file.path.startsWith(cardsFolder)) continue;
            const cache = this.app.metadataCache.getFileCache(file);
            const fm = cache?.frontmatter;

            if (fm && fm['tcg-binder'] === 'mtg-card' && fm['status'] === 'owned') {
                const setCode = (fm.set_code || '').toLowerCase();
                const collectorNum = String(fm.collector_number || '');
                const uniqueKey = `${setCode}_${collectorNum}`.toLowerCase();
                const count = Number(fm.count) || 1;

                physicalInventory.set(uniqueKey, (physicalInventory.get(uniqueKey) || 0) + count);
            }
        }

        // Cruzar datos para encontrar déficits
        const deficits: any[] = [];

        demandMap.forEach((demand, key) => {
            const ownedCount = physicalInventory.get(key) || 0;
            if (demand.totalDemand > ownedCount) {
                deficits.push({
                    name: demand.name,
                    setCode: demand.setCode,
                    collectorNumber: demand.collectorNumber,
                    totalDemand: demand.totalDemand,
                    ownedCount: ownedCount,
                    deficit: demand.totalDemand - ownedCount,
                    decksUsing: demand.decksUsing
                });
            }
        });

        return deficits;
    }
}