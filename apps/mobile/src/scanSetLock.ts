import { regularFirst, type Candidate, type CardIndex } from '@upkeep/scan-core';

/** Keep the recognised card identity, but allow only printings in the chosen set. */
export function candidatesInLockedSet(candidates: Candidate[], index: CardIndex, setCode: string): Candidate[] {
  const byId = new Map<string, Candidate>();
  for (const candidate of candidates) {
    for (const printing of index.printingsOf(candidate.printing.oracleId)) {
      if (printing.setCode.toLowerCase() !== setCode.toLowerCase()) continue;
      const next: Candidate = {
        printing,
        score: candidate.score,
        // A footer match for a different printing does not become an exact
        // match merely because the selected set has this card too.
        evidence: printing.id === candidate.printing.id ? candidate.evidence : 'name',
      };
      const previous = byId.get(printing.id);
      if (!previous || Number(next.evidence === 'printing') > Number(previous.evidence === 'printing') ||
          (next.evidence === previous.evidence && next.score > previous.score)) byId.set(printing.id, next);
    }
  }
  return [...byId.values()].sort((a, b) => Number(b.evidence === 'printing') - Number(a.evidence === 'printing') ||
    b.score - a.score || regularFirst(a.printing, b.printing)).slice(0, 50);
}
