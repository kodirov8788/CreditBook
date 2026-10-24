# Reviewed local Next ESLint plugin

This local tooling fork removes the unpatched fast-glob → micromatch → braces
dependency chain without changing ESLint rule implementations or configuration.
It is not an upstream release or a claim of comprehensive security certification.

- Upstream: https://github.com/vercel/next.js/tree/v16.3.1/packages/eslint-plugin-next
- Baseline package: @next/eslint-plugin-next 16.3.1, MIT.
- Local package: @next/eslint-plugin-next 16.3.1-creditbook.1.
- Only dist/utils/get-root-dirs.js and package version/dependencies differ.
- LICENSE preserves Vercel's MIT notice from the same upstream Next repository.
- Tarball SHA-512 is pinned in package-lock.json and verified by dependency guards.
- Node >=22.17 is required by the changed directory-glob helper; development
  verification uses existing Node22.21.1 and Node26.0.0. Hosted build Node24
  is compatible but no hosted release is implied by local testing.

The helper uses node:fs globSync, normalizes trailing directory slashes and
globstars to match the original directory sets, skips broken links on
ENOENT/ENOTDIR and rethrows unexpected filesystem errors. Rule files remain
byte-identical to the installed official package. No postinstall mutation or
global glob shim is used. Root development dependency plus its npm override
reference ensure eslint-config-next resolves this same relative local tarball.

Regression tests: node --test tests/scripts/eslint-protection.test.mjs.
Directory matching is checked against18 original fixtures, configuration hashes
against247 original files, and negative fixtures against active rule IDs.
These checks do not promise every possible glob pattern or real Windows parity.
An upstream App Router internal-anchor behavior observed during the prototype
is unchanged; the directory-dependent rule is exercised with Pages Router fixtures.

Keep this narrow fork under review. Replace it with an official compatible
release when the vulnerable dependency chain is removed upstream; rerun the
same guards, audits, test suite, types, lint and build before removing it.
Do not silence warnings, downgrade Next, or remove rules to obtain audit zero.
