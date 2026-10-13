/**
 * Cryptographic fingerprints of the reviewed rulepack source artifacts shipped in this release.
 * `scripts/verify-rulepack-manifest.py` fails the release if a rulepack source changes without an
 * explicit manifest update and therefore a new governance/validation cycle.
 */
export const RULEPACK_ARTIFACTS = {
  'EASA@2026.1': { authority: 'EASA', version: '2026.1', status: 'approved', sha256: '082708408e41f6d49b97468b9f88826d75b4e65afff00a8fcd64da21dfc14d2a' },
  'FAA@2026.1-draft': { authority: 'FAA', version: '2026.1-draft', status: 'draft', sha256: 'b89e3cc2c7f98e966ba7ff9553de33f27d2ff9108bd513deaa82e5b603ca6544' }
} as const;

export type RulepackArtifactId = keyof typeof RULEPACK_ARTIFACTS;
export function rulepackArtifact(id: string) {
  return (RULEPACK_ARTIFACTS as Record<string,{authority:string;version:string;status:'approved'|'draft';sha256:string}>)[id];
}
