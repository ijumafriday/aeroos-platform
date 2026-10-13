import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router';
import { Passkeys } from '../features/account/Passkeys';
import { Shell } from './Shell';
import { MelBoard } from '../features/mel/MelBoard';
import { TaskCards } from '../features/taskcards/TaskCards';
import { AuditPage } from '../features/audit/AuditPage';
import { Personnel } from '../features/org/Personnel';
import { Occ } from '../features/ops/Occ';
import { Crew } from '../features/ops/Crew';
import { Programme } from '../features/programme/Programme';
import { WorkPackages } from '../features/programme/WorkPackages';
import { Stores } from '../features/stores/Stores';
import { Directives } from '../features/engineering/Directives';
import { Components } from '../features/engineering/Components';
import { Documents } from '../features/org/Documents';
import { Safety } from '../features/safety/Safety';
import { SafetyActions } from '../features/safety/Actions';
import { SafetyControl } from '../features/safety/SafetyControl';
import { Actions, Audits } from '../features/quality/Audits';
import { QualityControl } from '../features/quality/QualityControl';
import { Ncr } from '../features/stores/Ncr';
import { Supply } from '../features/stores/Supply';
import { Dispatch } from '../features/ops/Dispatch';
import { Roster } from '../features/ops/Roster';
import { Fatigue } from '../features/ops/Fatigue';
import { CrewHub } from '../features/crew/CrewHub';
import { CrewControl } from '../features/crew/CrewControl';
import { Health } from '../features/engineering/Health';
import { Configuration } from '../features/engineering/Configuration';
import { EngineeringControl } from '../features/engineering/EngineeringControl';
import { Compliance } from '../features/quality/Compliance';
import { ComplianceControl } from '../features/quality/ComplianceControl';
import { Billing } from '../features/business/Billing';
import { Ledger } from '../features/business/Ledger';
import { Enterprise } from '../features/business/Enterprise';
import { Executive } from '../features/business/Executive';
import { TechnicalRecords } from '../features/records/TechnicalRecords';
import { PlatformConsole } from '../features/platform/PlatformConsole';
import { Home } from '../features/business/Home';
import { MaintenanceControl } from '../features/maintenance/MaintenanceControl';
import { OperationsControl } from '../features/ops/OperationsControl';
import { CommercialControl } from '../features/business/CommercialControl';
import { ReliabilityControl } from '../features/programme/ReliabilityControl';
import { AnalyticsControl } from '../features/analytics/AnalyticsControl';

const rootRoute = createRootRoute({ component: Shell });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/home' });
  }
});

const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/home', component: Home });

export const melRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/camo/mel',
  validateSearch: (s: Record<string, unknown>): { item?: string } => ({ item: typeof s.item === 'string' ? s.item : undefined }),
  component: MelBoard
});

export const taskCardsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/amo/task-cards',
  validateSearch: (s: Record<string, unknown>): { card?: string } => ({ card: typeof s.card === 'string' ? s.card : undefined }),
  component: TaskCards
});

export const personnelRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/org/personnel',
  validateSearch: (s: Record<string, unknown>): { person?: string; q?: string; status?: string } => ({ person: typeof s.person === 'string' ? s.person : undefined, q: str(s.q), status: str(s.status) }),
  component: Personnel
});

export const occRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/ops/occ',
  validateSearch: (s: Record<string, unknown>): { flight?: string; run?: string } => ({
    flight: typeof s.flight === 'string' ? s.flight : undefined,
    run: typeof s.run === 'string' ? s.run : undefined
  }),
  component: Occ
});

export const crewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/ops/crew',
  validateSearch: (s: Record<string, unknown>): { crew?: string; run?: string } => ({
    crew: typeof s.crew === 'string' ? s.crew : undefined, run: typeof s.run === 'string' ? s.run : undefined
  }),
  component: Crew
});

export const programmeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/camo/programme',
  validateSearch: (s: Record<string, unknown>): { tail?: string; ref?: string } => ({
    tail: typeof s.tail === 'string' ? s.tail : undefined,
    ref: typeof s.ref === 'string' ? s.ref : undefined
  }),
  component: Programme
});

export const workPackagesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/camo/work-packages',
  validateSearch: (s: Record<string, unknown>): { wp?: string } => ({ wp: typeof s.wp === 'string' ? s.wp : undefined }),
  component: WorkPackages
});

const storesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/amo/stores',
  validateSearch: (s: Record<string, unknown>): { part?: string } => ({ part: typeof s.part === 'string' ? s.part : undefined }),
  component: Stores
});

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

export const directivesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/camo/directives',
  validateSearch: (s: Record<string, unknown>): { directive?: string } => ({ directive: str(s.directive) }),
  component: Directives
});

export const componentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/camo/components',
  validateSearch: (s: Record<string, unknown>): { tail?: string; part?: string; serial?: string } => ({ tail: str(s.tail), part: str(s.part), serial: str(s.serial) }),
  component: Components
});

export const documentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/org/documents',
  validateSearch: (s: Record<string, unknown>): { doc?: string } => ({ doc: str(s.doc) }),
  component: Documents
});

export const safetyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/safety/reports',
  validateSearch: (s: Record<string, unknown>): { report?: string } => ({ report: str(s.report) }),
  component: Safety
});

export const auditsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/quality/audits',
  validateSearch: (s: Record<string, unknown>): { audit?: string; view?: string } => ({ audit: str(s.audit), view: str(s.view) }),
  component: Audits
});

const qualityActionsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/quality/actions', component: Actions });
const qualityControlRoute = createRoute({ getParentRoute: () => rootRoute, path: '/quality/control', validateSearch: (s: Record<string, unknown>): { tab?: string } => ({ tab: str(s.tab) }), component: QualityControl });
const complianceControlRoute = createRoute({ getParentRoute: () => rootRoute, path: '/quality/compliance-control', validateSearch: (s: Record<string, unknown>): { tab?: string } => ({ tab: str(s.tab) }), component: ComplianceControl });
const safetyActionsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/safety/actions', component: SafetyActions });
const safetyControlRoute = createRoute({ getParentRoute: () => rootRoute, path: '/safety/control', validateSearch: (s: Record<string, unknown>): { tab?: string } => ({ tab: str(s.tab) }), component: SafetyControl });

export const ncrRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/amo/ncr',
  validateSearch: (s: Record<string, unknown>): { ncr?: string } => ({ ncr: str(s.ncr) }),
  component: Ncr
});

export const supplyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/amo/supply',
  validateSearch: (s: Record<string, unknown>): { tab?: string; po?: string } => ({ tab: str(s.tab), po: str(s.po) }),
  component: Supply
});

export const dispatchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/ops/dispatch',
  validateSearch: (s: Record<string, unknown>): { flight?: string; day?: string } => ({ flight: str(s.flight), day: str(s.day) }),
  component: Dispatch
});

export const operationsControlRoute = createRoute({ getParentRoute: () => rootRoute, path: '/ops/control', validateSearch: (s: Record<string, unknown>): { tab?: string } => ({ tab: str(s.tab) }), component: OperationsControl });

export const rosterRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/ops/roster',
  validateSearch: (s: Record<string, unknown>): { from?: string; to?: string } => ({ from: str(s.from), to: str(s.to) }),
  component: Roster
});

export const recordsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/records', validateSearch: (s: Record<string, unknown>): { record?: string; tab?: string; batch?: string; lease?: string } => ({ record: str(s.record), tab: str(s.tab), batch: str(s.batch), lease: str(s.lease) }), component: TechnicalRecords });

export const configurationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/engineering/configuration',
  validateSearch: (s: Record<string, unknown>) => ({ tail: typeof s.tail === 'string' ? s.tail : undefined }),
  component: Configuration
});

export const healthRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/camo/health',
  validateSearch: (s: Record<string, unknown>): { tab?: string; engine?: string; tail?: string } => ({ tab: str(s.tab), engine: str(s.engine), tail: str(s.tail) }),
  component: Health
});

export const billingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/amo/billing',
  validateSearch: (s: Record<string, unknown>): { order?: string } => ({ order: str(s.order) }),
  component: Billing
});
export const ledgerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/finance/ledger',
  validateSearch: (s: Record<string, unknown>): { entity?: string; period?: string } => ({ entity: str(s.entity), period: str(s.period) }),
  component: Ledger
});
const executiveRoute = createRoute({ getParentRoute: () => rootRoute, path: '/finance/executive', component: Executive });
const enterpriseRoute = createRoute({ getParentRoute: () => rootRoute, path: '/org/enterprise', component: Enterprise });

const fatigueRoute = createRoute({ getParentRoute: () => rootRoute, path: '/ops/fatigue', component: Fatigue });
const crewHubRoute = createRoute({ getParentRoute: () => rootRoute, path: '/crew/me', component: CrewHub });
const crewControlRoute = createRoute({ getParentRoute: () => rootRoute, path: '/crew/control', validateSearch: (s: Record<string, unknown>): { tab?: string } => ({ tab: str(s.tab) }), component: CrewControl });
const reliabilityControlRoute = createRoute({ getParentRoute: () => rootRoute, path: '/camo/reliability-control', validateSearch: (s: Record<string, unknown>): { tab?: string } => ({ tab: str(s.tab) }), component: ReliabilityControl });
const engineeringControlRoute = createRoute({ getParentRoute: () => rootRoute, path: '/engineering/control', validateSearch: (s: Record<string, unknown>): { tab?: string } => ({ tab: str(s.tab) }), component: EngineeringControl });
const commercialControlRoute = createRoute({ getParentRoute: () => rootRoute, path: '/finance/commercial-control', validateSearch: (s: Record<string, unknown>): { tab?: string } => ({ tab: str(s.tab) }), component: CommercialControl });
const analyticsControlRoute = createRoute({ getParentRoute: () => rootRoute, path: '/analytics/control', validateSearch: (s: Record<string, unknown>): { tab?: string } => ({ tab: str(s.tab) }), component: AnalyticsControl });

export const complianceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/quality/compliance',
  validateSearch: (s: Record<string, unknown>): { scope?: string; status?: string } => ({ scope: str(s.scope), status: str(s.status) }),
  component: Compliance
});

const auditRoute = createRoute({ getParentRoute: () => rootRoute, path: '/quality/audit', component: AuditPage });
const passkeysRoute = createRoute({ getParentRoute: () => rootRoute, path: '/account/passkeys', component: Passkeys });
const platformRoute = createRoute({ getParentRoute: () => rootRoute, path: '/account/platform', component: PlatformConsole });
const maintenanceControlRoute = createRoute({ getParentRoute: () => rootRoute, path: '/amo/maintenance', component: MaintenanceControl });


export const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute, homeRoute, melRoute, taskCardsRoute, personnelRoute, occRoute, crewRoute, programmeRoute, reliabilityControlRoute, workPackagesRoute, maintenanceControlRoute, storesRoute, directivesRoute, componentsRoute, configurationRoute, recordsRoute, documentsRoute, safetyRoute, safetyActionsRoute, safetyControlRoute, auditsRoute, qualityActionsRoute, qualityControlRoute, complianceControlRoute, ncrRoute, supplyRoute, dispatchRoute, operationsControlRoute, rosterRoute, fatigueRoute, crewHubRoute, crewControlRoute, engineeringControlRoute, healthRoute, complianceRoute, billingRoute, commercialControlRoute, ledgerRoute, executiveRoute, enterpriseRoute, analyticsControlRoute, auditRoute, passkeysRoute, platformRoute]),
  defaultPreload: 'intent'
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
