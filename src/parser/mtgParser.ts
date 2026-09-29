export interface ParsedCardInput {
	rawName: string;
	cleanName: string;
	setCode: string;
	collectorNumber: string;
	count: number;
	isFoil: boolean;
}

export class MTGParser {
	static parseLine(line: string): ParsedCardInput | null {
		const trimmed = line.trim();
		if (!trimmed) return null;

		// El grupo 5 (.*) atrapará todo lo que esté después del número, como "*F*" o "【Foil】"
		const regex = /^(?:(\d+)x?\s+)?(.+?)\s*\(([^)]+)\)\s*([a-zA-Z0-9]+)(.*)$/;
		const match = trimmed.match(regex);

		if (!match) return null;

		const extraTags = match[5] ? match[5].toUpperCase() : '';
		const isFoil = extraTags.includes('*F*') || extraTags.includes('FOIL');

		return {
			rawName: trimmed,
			count: match[1] ? parseInt(match[1], 10) : 1,
			cleanName: match[2].trim(),
			setCode: match[3].toLowerCase().trim(),
			collectorNumber: match[4].trim(),
			isFoil: isFoil
		};
	}
}