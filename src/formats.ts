export type { RuleTrigger } from './formats/formatDefinition';
export type { RegisteredFormat as RuleFormat } from './formats/formatRegistry';

import { FORMAT_DEFINITIONS } from './formats/formatRegistry';
import type { RegisteredFormat } from './formats/formatRegistry';

/** Human-readable labels for each format (derived from format definitions) */
export const FORMAT_LABELS = Object.fromEntries(
  FORMAT_DEFINITIONS.map((d) => [d.id, d.label]),
) as Record<RegisteredFormat, string>;
