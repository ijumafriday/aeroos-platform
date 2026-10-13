import { Body, Controller, Delete, Get, Inject, Injectable, Logger, Param, Post, Query } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { SearchResultDto } from '@aeroos/contracts';
import { newId } from '@aeroos/kernel';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { DB_TOKEN, type ModuleDb } from '../database/module-db';
import { savedSearches, userViews } from '../database/platform.tables';
import { ZodPipe } from '../http/http';

export interface SearchProvider {
  name: string;
  search(p: Principal, q: string, limit: number): Promise<SearchResultDto[]>;
}

export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, c => `\\${c}`)}%`;

type Parsed = { text: string; type: string | null; domain: string | null };
export function parseQuery(raw: string): Parsed {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  let type: string | null = null; let domain: string | null = null;
  const text: string[] = [];
  for (const token of tokens) {
    const m = /^([a-z]+):(.*)$/i.exec(token);
    if (m && m[1].toLowerCase() === 'type') type = m[2].replace(/[-_]/g, ' ').toLowerCase();
    else if (m && m[1].toLowerCase() === 'domain') domain = m[2].replace(/[-_]/g, ' ').toLowerCase();
    else text.push(token);
  }
  return { text: text.join(' ').slice(0, 100), type, domain };
}

function score(r: SearchResultDto, q: string): number {
  const needle = q.toLowerCase(); const title = r.title.toLowerCase(); const id = r.id.toLowerCase(); const sub = r.subtitle.toLowerCase();
  if (!needle) return 0;
  if (id === needle || title === needle) return 100;
  if (id.startsWith(needle) || title.startsWith(needle)) return 75;
  if (title.includes(needle)) return 50;
  if (id.includes(needle)) return 40;
  if (sub.includes(needle)) return 20;
  return 0;
}

@Injectable()
export class SearchRegistry {
  private readonly log = new Logger('Search');
  private readonly providers: SearchProvider[] = [];
  register(p: SearchProvider) { if (!this.providers.some(x => x.name === p.name)) this.providers.push(p); }

  async search(p: Principal, raw: string): Promise<SearchResultDto[]> {
    const parsed = parseQuery(raw);
    if (parsed.text.length < 2 && !parsed.type && !parsed.domain) return [];
    const providerSet = this.providers;
    const results = await Promise.allSettled(providerSet.map(x => x.search(p, parsed.text, 12)));
    const out: SearchResultDto[] = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') out.push(...r.value.map(x => ({ ...x, domain: x.domain ?? providerSet[i].name })));
      else this.log.warn(`provider ${providerSet[i].name} failed: ${(r.reason as Error).message}`);
    });
    const filtered = out.filter(x => (!parsed.type || x.type.toLowerCase().includes(parsed.type!)) && (!parsed.domain || (x.domain ?? '').toLowerCase() === parsed.domain));
    const unique = new Map<string, SearchResultDto>();
    for (const r of filtered.sort((a,b) => score(b, parsed.text) - score(a, parsed.text))) unique.set(`${r.type}:${r.id}`, r);
    return [...unique.values()].slice(0, 60);
  }
}

const saveSchema = z.object({ name: z.string().trim().min(2).max(80), query: z.string().trim().min(2).max(160) });

@Controller('search')
export class SearchController {
  constructor(private readonly registry: SearchRegistry, @Inject(DB_TOKEN.platform) private readonly db: ModuleDb) {}

  @Get()
  search(@CurrentPrincipal() p: Principal, @Query('q') q = '') { return this.registry.search(p, q); }

  @Get('saved')
  saved(@CurrentPrincipal() p: Principal) {
    return this.db.db.select().from(savedSearches).where(and(eq(savedSearches.operatorId, p.operatorId), eq(savedSearches.subject, p.subject))).orderBy(desc(savedSearches.updatedAt));
  }

  @Post('saved')
  async save(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(saveSchema)) body: z.infer<typeof saveSchema>) {
    const existing = await this.db.db.select().from(savedSearches).where(and(eq(savedSearches.operatorId, p.operatorId), eq(savedSearches.subject, p.subject), eq(savedSearches.name, body.name))).limit(1);
    if (existing[0]) {
      await this.db.db.update(savedSearches).set({ query: body.query, updatedAt: new Date() }).where(eq(savedSearches.id, existing[0].id));
      return { ...existing[0], query: body.query, updatedAt: new Date() };
    }
    const row = { id: newId(), operatorId: p.operatorId, subject: p.subject, name: body.name, query: body.query };
    await this.db.db.insert(savedSearches).values(row); return row;
  }

  @Delete('saved/:id')
  async remove(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    await this.db.db.delete(savedSearches).where(and(eq(savedSearches.id, id), eq(savedSearches.operatorId, p.operatorId), eq(savedSearches.subject, p.subject)));
    return { id, deleted: true };
  }
}


const viewSchema = z.object({
  route: z.string().trim().min(1).max(160).regex(/^\//),
  name: z.string().trim().min(2).max(80),
  search: z.record(z.string(), z.string().max(300)).default({}),
  isDefault: z.boolean().default(false)
});

/** Per-user enterprise workspace views. They store navigation/filter state only; domain data stays in its owning module. */
@Controller('preferences/views')
export class UserViewsController {
  constructor(@Inject(DB_TOKEN.platform) private readonly db: ModuleDb) {}

  @Get()
  list(@CurrentPrincipal() p: Principal, @Query('route') route?: string) {
    const base = and(eq(userViews.operatorId, p.operatorId), eq(userViews.subject, p.subject));
    return this.db.db.select().from(userViews).where(route ? and(base, eq(userViews.route, route)) : base).orderBy(desc(userViews.updatedAt));
  }

  @Post()
  async save(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(viewSchema)) b: z.infer<typeof viewSchema>) {
    const existing = await this.db.db.select().from(userViews).where(and(eq(userViews.operatorId, p.operatorId), eq(userViews.subject, p.subject), eq(userViews.route, b.route), eq(userViews.name, b.name))).limit(1);
    return this.db.transaction(async () => {
      if (b.isDefault) await this.db.db.update(userViews).set({ isDefault: false }).where(and(eq(userViews.operatorId, p.operatorId), eq(userViews.subject, p.subject), eq(userViews.route, b.route)));
      if (existing[0]) {
        await this.db.db.update(userViews).set({ search: b.search, isDefault: b.isDefault, updatedAt: new Date() }).where(eq(userViews.id, existing[0].id));
        return { ...existing[0], search: b.search, isDefault: b.isDefault, updatedAt: new Date() };
      }
      const row = { id: newId(), operatorId: p.operatorId, subject: p.subject, route: b.route, name: b.name, search: b.search, isDefault: b.isDefault };
      await this.db.db.insert(userViews).values(row); return row;
    });
  }

  @Post(':id/default')
  async makeDefault(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    const [v] = await this.db.db.select().from(userViews).where(and(eq(userViews.id, id), eq(userViews.operatorId, p.operatorId), eq(userViews.subject, p.subject)));
    if (!v) return { id, default: false };
    await this.db.transaction(async () => {
      await this.db.db.update(userViews).set({ isDefault: false }).where(and(eq(userViews.operatorId, p.operatorId), eq(userViews.subject, p.subject), eq(userViews.route, v.route)));
      await this.db.db.update(userViews).set({ isDefault: true, updatedAt: new Date() }).where(eq(userViews.id, id));
    });
    return { id, default: true };
  }

  @Delete(':id')
  async remove(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    await this.db.db.delete(userViews).where(and(eq(userViews.id, id), eq(userViews.operatorId, p.operatorId), eq(userViews.subject, p.subject)));
    return { id, deleted: true };
  }
}
