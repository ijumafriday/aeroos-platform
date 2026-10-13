# AeroOS 0.29.0 — P2 Closure

This release closes the two remaining original P2 deficiencies without changing AeroOS into a workflow-centric product.

## Enterprise UX

- Added `/home`, a role-aware starting workspace that prioritises the durable domains relevant to the signed-in user's roles.
- Added tenant/user-scoped saved views for any existing route and query/filter state.
- Saved views are available globally from the header and can be marked as the default view for a screen.
- Added filterable Personnel register state that can be saved as a view.
- Added conservative bulk selection/export for Personnel; regulated records are not generically mass-mutated.
- The domain rail remains the primary navigation and no Workflow/Workspace business domain was added.

## Commercial / Finance

- Added tenant/entity-scoped ERP integration profiles with explicit account and cost-centre mappings.
- Added deterministic CSV Journal v1 and JSON Journal v1 export formats.
- ERP exports require a closed period and balanced trial balance.
- The exact exported content is retained with SHA-256 integrity evidence.
- Export batches have a controlled `GENERATED -> ACKNOWLEDGED | REJECTED` reconciliation lifecycle with external reference and audit history.
- ERP profiles can be activated/deactivated without deleting history.
- AeroOS remains the aviation operational sub-ledger rather than expanding into generic statutory accounting.

## Security / isolation

- Added RLS-protected `platform.user_views`, `org.erp_profiles`, and `org.erp_export_batches`.
- Extended tenant-isolation integration coverage to workspace views and ERP profiles.
