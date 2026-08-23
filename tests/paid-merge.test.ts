import { describe, expect, it } from 'vitest'
import { mergePaid } from '../src/domain/paid'

describe('mergePaid', () => {
	it('averages by quantity, rounded to cents', () => {
		expect(mergePaid(2, 1.5, 1, 3)).toBe(2)
		expect(mergePaid(1, 1, 2, 2)).toBe(1.67)
	})

	it('keeps the known price when the other batch has none', () => {
		expect(mergePaid(2, null, 1, 3)).toBe(3)
		expect(mergePaid(2, 1.5, 4, null)).toBe(1.5)
		expect(mergePaid(1, null, 1, null)).toBeNull()
	})

	it('handles zero quantities without dividing by zero', () => {
		expect(mergePaid(0, 1, 0, 2)).toBeNull()
	})
})
