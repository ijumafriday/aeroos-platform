import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Logger, type Provider } from '@nestjs/common';
import { LocalKeyService, TransitKeyService, type KeyService } from '@aeroos/signing';
import { CONFIG, type Config } from '../../config';

export const KEY_SERVICE = Symbol('KEY_SERVICE');

/**
 * Chooses the KeyService for this deployment profile (ADR-0006). Application code depends only on
 * the KeyService interface.
 *  - transit: OpenBao / Vault Transit — the production path; HSM-backed when the engine is.
 *  - local:   a key file, for development only (refused in production unless explicitly allowed).
 */
export const keyServiceProvider: Provider = {
  provide: KEY_SERVICE,
  inject: [CONFIG],
  useFactory: async (config: Config): Promise<KeyService> => {
    const log = new Logger('KeyService');
    if (config.SIGNING_PROVIDER === 'transit') {
      const token = config.TRANSIT_TOKEN ?? (config.TRANSIT_TOKEN_FILE ? readFileSync(config.TRANSIT_TOKEN_FILE, 'utf8').trim() : undefined);
      if (!token) throw new Error('SIGNING_PROVIDER=transit needs TRANSIT_TOKEN or TRANSIT_TOKEN_FILE');
      for (let attempt = 1; ; attempt++) {
        try {
          const ks = await TransitKeyService.connect({ address: config.TRANSIT_ADDR, token, mount: config.TRANSIT_MOUNT, key: config.TRANSIT_KEY });
          log.log(`signing with ${ks.keyId} at ${config.TRANSIT_ADDR}`);
          return ks;
        } catch (e) {
          if (attempt >= 30) throw e;
          log.warn(`transit not ready (${(e as Error).message}); retrying`);
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }
    if (config.SIGNING_KEY_PEM) return LocalKeyService.fromPrivatePem(config.SIGNING_KEY_ID, config.SIGNING_KEY_PEM);
    if (config.SIGNING_KEY_FILE) {
      if (existsSync(config.SIGNING_KEY_FILE)) {
        return LocalKeyService.fromPrivatePem(config.SIGNING_KEY_ID, readFileSync(config.SIGNING_KEY_FILE, 'utf8'));
      }
      const k = LocalKeyService.generate(config.SIGNING_KEY_ID);
      mkdirSync(dirname(config.SIGNING_KEY_FILE), { recursive: true });
      writeFileSync(config.SIGNING_KEY_FILE, k.exportPrivatePem(), { mode: 0o600 });
      log.warn(`generated a development signing key at ${config.SIGNING_KEY_FILE}`);
      return k;
    }
    log.warn('using an ephemeral development signing key; signatures will not verify after a restart');
    return LocalKeyService.generate(config.SIGNING_KEY_ID);
  }
};
