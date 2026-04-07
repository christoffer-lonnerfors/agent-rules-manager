export type { RuleTrigger } from './scanner/formatDefinition';
export type { RegisteredFormat as RuleFormat } from './scanner/formatRegistry';

import { FORMAT_DEFINITIONS } from './scanner/formatRegistry';
import type { RegisteredFormat } from './scanner/formatRegistry';

/** Human-readable labels for each format (derived from format definitions) */
export const FORMAT_LABELS = Object.fromEntries(
  FORMAT_DEFINITIONS.map((d) => [d.id, d.label]),
) as Record<RegisteredFormat, string>;
