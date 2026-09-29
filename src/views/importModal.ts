import { App, Modal, Notice } from 'obsidian';
import MTGBinderPlugin from '../main';
import { CardNoteBuilder } from '../parser/cardNoteBuilder';

export class ImportModal extends Modal {
    plugin: MTGBinderPlugin;
    cardBuilder: CardNoteBuilder;

    constructor(app: App, plugin: MTGBinderPlugin) {
        super(app);
        this.plugin = plugin;
        this.cardBuilder = new CardNoteBuilder(app, plugin);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('mtg-import-modal');

        contentEl.createEl('h2', { text: 'Importar lista de cartas' });
        contentEl.createEl('p', { text: 'Pega tu lista de cartas (formato Moxfield / Scryfall):' });

        const textArea = contentEl.createEl('textarea', { 
            cls: 'mtg-import-textarea',
            attr: { placeholder: '1x Arcane Signet (fic) 332 *F*\n1x Sol Ring (msc) 212' }
        });

        const buttonContainer = contentEl.createDiv({ cls: 'mtg-import-buttons' });
        const importButton = buttonContainer.createEl('button', { text: 'Importar al Binder', cls: 'mod-cta' });

        importButton.addEventListener('click', async () => {
            const text = textArea.value.trim();
            if (!text) {
                new Notice('Por favor, ingresa una lista válida.');
                return;
            }

            importButton.setAttr('disabled', 'true');
            importButton.setText('Importando...');

            try {
                await this.cardBuilder.processImportList(text);
                this.close();
            } catch (err) {
                console.error('[MTG Binder] Error durante la importación:', err);
                new Notice('Ocurrió un error al importar. Revisa la consola.');
            } finally {
                importButton.removeAttribute('disabled');
                importButton.setText('Importar al Binder');
            }
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}