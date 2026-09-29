export interface ScryfallCard {
	id: string;
	name: string;
	set: string;
	set_name: string;
	collector_number: string;
	mana_cost?: string;
	cmc?: number;
	type_line?: string;
	oracle_text?: string;
	power?: string;
	toughness?: string;
	loyalty?: string;
	colors?: string[];
	color_identity?: string[];
	rarity?: string;
	prices?: {
		usd?: string;
		eur?: string;
	};
	image_uris?: {
		normal?: string;
		large?: string;
		art_crop?: string;
	};
}

export class ScryfallClient {
	async getCardBySetAndNumber(set: string, number: string): Promise<ScryfallCard | null> {
		try {
			const cleanSet = encodeURIComponent(set.toLowerCase().trim());
			const cleanNumber = encodeURIComponent(number.trim());
			const targetUrl = `https://api.scryfall.com/cards/${cleanSet}/${cleanNumber}`;

			console.log(`[MTG Binder Scryfall] Fetching: ${targetUrl}`);

			const response = await fetch(targetUrl);
			if (!response.ok) {
				console.warn(`[MTG Binder Scryfall] HTTP Error ${response.status} para ${cleanSet}/${cleanNumber}`);
				return null;
			}

			const data = await response.json();
			return data as ScryfallCard;
		} catch (error) {
			console.error(`[MTG Binder Scryfall] Error en fetch:`, error);
			return null;
		}
	}
}