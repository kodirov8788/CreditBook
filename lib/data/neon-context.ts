import {
  createNeonCustomerFinanceRepository, createNeonCustomerRepository,
  type CustomerFinanceRepository, type CustomerMetadataRepository,
} from "./customers.ts";
import {
  NeonOwnerAuthorizationError, runNeonOwnerBatch,
  type ExistingAuthVerifier, type NeonAtomicExecutor,
} from "./neon-owner.ts";
import { createNeonShopPermissions, type ShopPermissionRepository } from "./shop-permissions.ts";
import { createNeonShopRepository, type OwnerBoundShopQuery, type ShopRepository } from "./shops.ts";

export type NeonRequestRepositories = Readonly<{
  shops: ShopRepository;
  permissions: ShopPermissionRepository;
  forShop(shopId: string): Readonly<{
    customers: CustomerMetadataRepository;
    customerFinance: CustomerFinanceRepository;
  }>;
}>;

/** Trusted server composition, not an application provider switch.
 *
 * The caller captures the request's token and intended owner. The owner is not
 * authority: every repository operation verifies that SAME token with Supabase,
 * then runs the SQL owner/status guard and operation in ONE transaction.
 * No session cache, ambient cookies/env, raw query API or silent fallback.
 * No route imports this factory until the full cutover is verified/approved.
 */
export function createNeonRequestRepositories(options: {
  auth: ExistingAuthVerifier;
  token: string;
  expectedOwnerId: string;
  execute: NeonAtomicExecutor;
  signal?: AbortSignal;
}): NeonRequestRepositories {
  // Capture primitives and method references before ANY asynchronous work.
  const { token, expectedOwnerId, execute, signal } = options;
  if (typeof token !== "string" || !token || /\s/.test(token)
    || typeof expectedOwnerId !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(expectedOwnerId)) {
    throw new NeonOwnerAuthorizationError();
  }
  const auth: ExistingAuthVerifier = { getUser: options.auth.getUser.bind(options.auth) };
  const run: OwnerBoundShopQuery = statements => runNeonOwnerBatch({
    auth, token, expectedOwnerId, execute, signal, statements,
  });
  return Object.freeze({
    shops: Object.freeze(createNeonShopRepository(run)),
    permissions: Object.freeze(createNeonShopPermissions(run)),
    forShop(shopId: string) {
      return Object.freeze({
        customers: Object.freeze(createNeonCustomerRepository(run, shopId)),
        customerFinance: Object.freeze(createNeonCustomerFinanceRepository(run, shopId)),
      });
    },
  });
}
