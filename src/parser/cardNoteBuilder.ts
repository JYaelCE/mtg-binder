import { App, TFile, Notice, normalizePath } from 'obsidian';
import MTGBinderPlugin from '../main';

export class CardNoteBuilder {
    app: App;
    plugin: MTGBinderPlugin;

    constructor(app: App, plugin: MTGBinderPlugin) {
        this.app = app;
        this.plugin = plugin;
    }

    async processImportList(importText: string) {
        const lines = importText.split('\n');
        let importedCount = 0;

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            const match = trimmed.match(/^(\d+)x?\s+(.*?)\s*\(([^)]+)\)\s*([0-9a-zA-Z★☆-]+)(.*)$/);

            if (!match) {
                console.warn(`[MTG Binder] No se pudo parsear la línea: ${trimmed}`);
                continue;
            }

            const count = parseInt(match[1], 10) || 1;
            const cardName = match[2].trim();
            const setCode = match[3].trim().toLowerCase();
            const collectorNumber = match[4].trim();
            const rawExtras = match[5].trim();

            const isFoil = rawExtras.includes('*F*') || rawExtras.toLowerCase().includes('foil');

            try {
                const response = await fetch(`https://api.scryfall.com/cards/${setCode}/${collectorNumber}`);
                if (!response.ok) {
                    console.error(`[MTG Binder] No se encontró la carta ${cardName} (${setCode} #${collectorNumber}) en Scryfall.`);
                    continue;
                }

                const cardData = await response.json();
                await this.saveCardNote(cardData, count, isFoil);
                importedCount++;

                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (err) {
                console.error(`[MTG Binder] Error procesando carta ${cardName}:`, err);
            }
        }

        new Notice(`¡Se importaron ${importedCount} cartas correctamente al Binder!`);
        this.plugin.activateView();
    }

    private async saveCardNote(card: any, count: number, isFoil: boolean) {
        const folderPath = normalizePath(this.plugin.settings.cardsFolder);
        
        const folderExists = this.app.vault.getAbstractFileByPath(folderPath);
        if (!folderExists) {
            await this.app.vault.createFolder(folderPath);
        }

        const safeName = card.name.replace(/[/\\?%*:|"<>]/g, '');
        const foilSuffix = isFoil ? ' [Foil]' : '';
        const fileName = `${safeName} (${card.set.toLowerCase()} ${card.collector_number})${foilSuffix}.md`;
        const filePath = normalizePath(`${folderPath}/${fileName}`);

        const existingFile = this.app.vault.getAbstractFileByPath(filePath);
        if (existingFile instanceof TFile) {
            const cache = this.app.metadataCache.getFileCache(existingFile);
            const currentCount = cache?.frontmatter?.count || 1;
            const newTotalCount = currentCount + count;

            await this.app.vault.process(existingFile, (content) => {
                return content.replace(/^count:\s*\d+/m, `count: ${newTotalCount}`);
            });
        } else {
            await this.createNewCard(filePath, card, count, isFoil);
        }
    }

    private async createNewCard(filePath: string, card: any, count: number, isFoil: boolean): Promise<TFile> {
        const faces = card.card_faces || [];
        const hasFaces = faces.length > 0;

        const manaCost = hasFaces ? faces.map((f: any) => f.mana_cost).filter(Boolean).join(' // ') : (card.mana_cost || '');
        const rawTypeLine = hasFaces ? faces.map((f: any) => f.type_line).filter(Boolean).join(' // ') : (card.type_line || '');
        const oracleText = hasFaces ? faces.map((f: any) => f.oracle_text).filter(Boolean).join('\n---\n') : (card.oracle_text || '');
        const power = hasFaces ? faces.map((f: any) => f.power).filter(Boolean).join(' / ') : (card.power || '');
        const toughness = hasFaces ? faces.map((f: any) => f.toughness).filter(Boolean).join(' / ') : (card.toughness || '');
        const loyalty = hasFaces ? faces.map((f: any) => f.loyalty).filter(Boolean).join(' / ') : (card.loyalty || '');

        // Separar Tipos y Subtipos de la type_line (ej. "Legendary Creature — Cat Warlock" -> Tipos: ["Legendary", "Creature"], Subtipos: ["Cat", "Warlock"])
        const typeParts = rawTypeLine.split('—').map((p: string) => p.trim());
        const primaryTypeString = typeParts[0] || '';
        const subtypeString = typeParts[1] || '';

        const typesArray = primaryTypeString ? primaryTypeString.split(' ').map((t: string) => t.trim()).filter(Boolean) : [];
        const subtypesArray = subtypeString ? subtypeString.split(' ').map((s: string) => s.trim()).filter(Boolean) : [];

        let rawColors = card.colors || (hasFaces ? faces[0].colors : []) || [];
        if (!Array.isArray(rawColors) && typeof rawColors === 'object') {
            rawColors = Object.values(rawColors);
        }

        const frontmatter = {
            'tcg-binder': 'mtg-card',
            'game': 'mtg',
            finish: isFoil ? 'Foil' : 'Regular',
            count: count,
            id: card.id,
            name: card.name,
            set_code: card.set.toLowerCase(),
            set_name: card.set_name,
            collector_number: card.collector_number,
            mana_cost: manaCost,
            cmc: card.cmc ?? 0,
            type_line: rawTypeLine,
            types: typesArray,
            subtypes: subtypesArray,
            oracle_text: oracleText,
            power: power,
            toughness: toughness,
            loyalty: loyalty,
            colors: rawColors,
            rarity: card.rarity || '',
            artist: card.artist || (hasFaces ? faces[0].artist : '') || '',
            prices: {
                usd: isFoil ? (card.prices?.usd_foil || card.prices?.usd) : card.prices?.usd,
                eur: isFoil ? (card.prices?.eur_foil || card.prices?.eur) : card.prices?.eur,
            },
            image_url: card.image_uris?.normal || card.image_uris?.large || (hasFaces && card.image_uris ? card.image_uris.normal : null) || (hasFaces && faces[0].image_uris ? faces[0].image_uris.normal : '')
        };

        const content = this.buildMarkdownContent(frontmatter, card);
        return await this.app.vault.create(filePath, content);
    }

    private buildMarkdownContent(frontmatter: any, card: any): string {
        let fmString = '---\n';
        for (const [key, value] of Object.entries(frontmatter)) {
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                fmString += `${key}:\n`;
                for (const [subKey, subVal] of Object.entries(value)) {
                    fmString += `  ${subKey}: "${String(subVal ?? '').replace(/"/g, '\\"')}"\n`;
                }
            } else if (Array.isArray(value)) {
                fmString += `${key}: [${value.map(v => `"${String(v).replace(/"/g, '\\"')}"`).join(', ')}]\n`;
            } else if (typeof value === 'number' || typeof value === 'boolean') {
                fmString += `${key}: ${value}\n`;
            } else {
                const stringVal = String(value ?? '');
                if (stringVal.includes("'") || stringVal.includes('"') || stringVal.includes('\n')) {
                    const indentedText = stringVal.split('\n').map(line => `  ${line}`).join('\n');
                    fmString += `${key}: |\n${indentedText}\n`;
                } else {
                    fmString += `${key}: "${stringVal}"\n`;
                }
            }
        }
        fmString += '---\n\n';
        fmString += `# ${card.name}\n\n`;
        if (frontmatter.image_url) {
            fmString += `![${card.name}](${frontmatter.image_url})\n`;
        }
        return fmString;
    }
}