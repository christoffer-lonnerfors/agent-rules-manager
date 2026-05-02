import { RuleTrigger } from '../formats/formatDefinition';

export interface RuleMetaSection {
  meta: {
    slug: string;
    globs?: string[];
    trigger?: RuleTrigger;
    description?: string;
  };
  body: string;
}

export function parseSections(content: string): RuleMetaSection[] {
  const MARKER = '<!-- rule-meta:';
  const lines = content.split('\n');
  const sections: { meta: RuleMetaSection['meta']; bodyLines: string[] }[] = [];
  let current: { meta: RuleMetaSection['meta']; bodyLines: string[] } | null = null;

  for (const line of lines) {
    if (line.trimStart().startsWith(MARKER)) {
      try {
        const json = line.slice(line.indexOf('{'), line.lastIndexOf('}') + 1);
        const parsed = JSON.parse(json) as Partial<RuleMetaSection['meta']>;
        if (typeof parsed.slug !== 'string') continue;
        if (current) sections.push(current);
        current = {
          meta: {
            slug: parsed.slug,
            ...(parsed.trigger ? { trigger: parsed.trigger as RuleTrigger } : {}),
            ...(Array.isArray(parsed.globs) && parsed.globs.length ? { globs: parsed.globs } : {}),
            ...(parsed.description ? { description: parsed.description } : {}),
          },
          bodyLines: [],
        };
      } catch {
        // skip malformed comment
      }
    } else if (current) {
      current.bodyLines.push(line);
    }
  }

  if (current) sections.push(current);

  return sections.map((s) => ({
    meta: s.meta,
    body: s.bodyLines.join('\n').trim(),
  }));
}
