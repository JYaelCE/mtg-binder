import { useEffect, useState } from 'react'

/** Reactive `matchMedia` — re-renders when the query starts/stops matching. */
export function useMediaQuery(query: string): boolean {
	const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
	useEffect(() => {
		const media = window.matchMedia(query)
		setMatches(media.matches)
		const onChange = (event: MediaQueryListEvent) => {
			setMatches(event.matches)
		}
		media.addEventListener('change', onChange)
		return () => {
			media.removeEventListener('change', onChange)
		}
	}, [query])
	return matches
}
