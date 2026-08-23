import { showChoiceMenu } from '../utils/choice-menu'
import type { ChoiceOption } from '../utils/choice-menu'

interface ChoiceControlProps<T extends string> {
	value: T
	options: ChoiceOption<T>[]
	onChange: (value: T) => void
	/** Touch mode: render a button that opens a native menu (bottom sheet on mobile). */
	coarse: boolean
	ariaLabel: string
	className?: string
}

/**
 * A <select> on desktop; on touch, a button opening a native Obsidian menu —
 * same choice, no focused input inside view-content (the mobile hazard).
 */
export function ChoiceControl<T extends string>({
	value,
	options,
	onChange,
	coarse,
	ariaLabel,
	className,
}: ChoiceControlProps<T>) {
	if (!coarse) {
		return (
			<select
				className={className}
				value={value}
				aria-label={ariaLabel}
				title={ariaLabel}
				onChange={(e) => onChange(e.target.value as T)}
			>
				{options.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
		)
	}
	const current = options.find((option) => option.value === value)
	return (
		<button
			className={`tcgb-choice ${className ?? ''}`}
			aria-label={ariaLabel}
			aria-haspopup="menu"
			onClick={(e) => showChoiceMenu({ x: e.clientX, y: e.clientY }, options, value, onChange)}
		>
			{current?.label ?? value}
			<span className="tcgb-choice-chevron" aria-hidden="true">
				▾
			</span>
		</button>
	)
}
