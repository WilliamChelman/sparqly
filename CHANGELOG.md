## [0.37.0](https://github.com/WilliamChelman/sparqly/compare/v0.36.0...v0.37.0) (2026-06-22)

### Features

* **cache:** byte-budget LRU eviction + maxBytes/maxEntryBytes (ADR-0054, [#414](https://github.com/WilliamChelman/sparqly/issues/414)) ([cc80ff6](https://github.com/WilliamChelman/sparqly/commit/cc80ff63c8aa3751e0cbe00338ace2be31e033c7))
* **cache:** CLI control surface — --no-cache/--refresh + cache clear/stats (ADR-0054, [#417](https://github.com/WilliamChelman/sparqly/issues/417)) ([d8da786](https://github.com/WilliamChelman/sparqly/commit/d8da7867837473f1c7e76c65171d2660b274c39f))
* **cache:** content-aware freshness token for local sources (ADR-0054, [#415](https://github.com/WilliamChelman/sparqly/issues/415)) ([77c13a9](https://github.com/WilliamChelman/sparqly/commit/77c13a92a3e0c9b55c01ae8d5f04d13457ec3123))
* **cache:** non-determinism guard + per-source ttl override (ADR-0054, [#416](https://github.com/WilliamChelman/sparqly/issues/416)) ([0a72604](https://github.com/WilliamChelman/sparqly/commit/0a726040cb3f5e383d62cd8e201cb800a99fb07b))
* **cache:** opt-in endpoint query-result cache (ADR-0054, [#413](https://github.com/WilliamChelman/sparqly/issues/413)) ([482c5b7](https://github.com/WilliamChelman/sparqly/commit/482c5b73a3f8d976a0217a5d143939c3e1753288))
* **cache:** serve per-request refresh + read-only gating + webapp cached badge (ADR-0054, [#418](https://github.com/WilliamChelman/sparqly/issues/418)) ([9280f23](https://github.com/WilliamChelman/sparqly/commit/9280f23e4e25706b648cc5a018e141ee6b6a6a0f))

### Bug Fixes

* **cache:** address PR [#419](https://github.com/WilliamChelman/sparqly/issues/419) self-review across query-result cache (ADR-0054) ([7d40d04](https://github.com/WilliamChelman/sparqly/commit/7d40d041bee7e85559585ad1d828fdf6389ec596)), closes [#416](https://github.com/WilliamChelman/sparqly/issues/416)

## [0.36.0](https://github.com/WilliamChelman/sparqly/compare/v0.35.0...v0.36.0) (2026-06-04)

### Features

* **web:** meaningful document titles per page (ADR-0053) ([1cdbef0](https://github.com/WilliamChelman/sparqly/commit/1cdbef057db4669ce7a00561138c2718c3f99e92))

## [0.35.0](https://github.com/WilliamChelman/sparqly/compare/v0.34.1...v0.35.0) (2026-06-04)

### Features

* **describe:** flatten response & single-source Result error contract (ADR-0052, [#408](https://github.com/WilliamChelman/sparqly/issues/408)) ([ac331e9](https://github.com/WilliamChelman/sparqly/commit/ac331e94f6e0948361e3f2812b67e27baaa8a016))
* **describe:** mandatory single-select source picker (ADR-0052, [#407](https://github.com/WilliamChelman/sparqly/issues/407)) ([38af182](https://github.com/WilliamChelman/sparqly/commit/38af182016413401d4bc05906ed206f61f4f8c85)), closes [#406](https://github.com/WilliamChelman/sparqly/issues/406)
* **describe:** resolve omitted source to the registry's default source (ADR-0052, [#406](https://github.com/WilliamChelman/sparqly/issues/406)) ([afd7b75](https://github.com/WilliamChelman/sparqly/commit/afd7b757af76e0ac7ea0b558e2abbd1cc4b897a3))
* **diff:** anchor "defined here" on the predicate that changed on the other side ([#405](https://github.com/WilliamChelman/sparqly/issues/405)) ([0e83495](https://github.com/WilliamChelman/sparqly/commit/0e834954fe0ae8a159f8c49145e073bc8aaa374a))

## [0.34.1](https://github.com/WilliamChelman/sparqly/compare/v0.34.0...v0.34.1) (2026-06-01)

### Bug Fixes

* **diff:** read snippet content from the pinned git blob, not the working tree ([f4c6233](https://github.com/WilliamChelman/sparqly/commit/f4c62337a5a03359d1051091d74606791218c81e))

## [0.34.0](https://github.com/WilliamChelman/sparqly/compare/v0.33.0...v0.34.0) (2026-05-30)

### Features

* **server:** bounded query worker pool with hash-sticky assignment (ADR-0050) ([1ceadb8](https://github.com/WilliamChelman/sparqly/commit/1ceadb80072da67d66088822ae458f0ee055dc49)), closes [#385](https://github.com/WilliamChelman/sparqly/issues/385) [#386](https://github.com/WilliamChelman/sparqly/issues/386)
* **server:** contain query-worker OOM via resourceLimits + respawn (ADR-0050) ([aa521d8](https://github.com/WilliamChelman/sparqly/commit/aa521d8e3c762953704b4bcf5c8f9e03905c7513)), closes [#389](https://github.com/WilliamChelman/sparqly/issues/389)
* **server:** hybrid query cancellation on client disconnect (ADR-0050) ([2cd1dc1](https://github.com/WilliamChelman/sparqly/commit/2cd1dc15cf3e61cea11c0982532279b457ee5458))
* **server:** per-worker LRU-bounded query residency (query.maxResidentQuads, ADR-0050) ([940a267](https://github.com/WilliamChelman/sparqly/commit/940a26794634637e7dabe59b74cfdc0e16c563d9)), closes [#387](https://github.com/WilliamChelman/sparqly/issues/387)
* **server:** refresh snippet allow-list on --watch for lazy/worker sources ([#391](https://github.com/WilliamChelman/sparqly/issues/391)) ([9eec05d](https://github.com/WilliamChelman/sparqly/commit/9eec05dd171ed5606e0ac98729483846a5b56f8f))
* **server:** route --watch/Reload/Unload invalidation to the owning worker (ADR-0050) ([2acecd9](https://github.com/WilliamChelman/sparqly/commit/2acecd90b88a2af549f6dc79ecf0744498d8a74d)), closes [#391](https://github.com/WilliamChelman/sparqly/issues/391)
* **server:** route pinned/ad-hoc source queries through the worker pool (ADR-0050) ([cbbb494](https://github.com/WilliamChelman/sparqly/commit/cbbb494c7a5ceb0461df5dcdd431d20ba00929d7)), closes [#390](https://github.com/WilliamChelman/sparqly/issues/390)
* **server:** run in-memory queries off the main thread (ADR-0050) ([687b83d](https://github.com/WilliamChelman/sparqly/commit/687b83d108f933836f826d5619eac9bebcbd52f7)), closes [#385](https://github.com/WilliamChelman/sparqly/issues/385) [#391](https://github.com/WilliamChelman/sparqly/issues/391) [#391](https://github.com/WilliamChelman/sparqly/issues/391) [#385](https://github.com/WilliamChelman/sparqly/issues/385)

### Bug Fixes

* **core:** resolve relative IRIs and guard degenerate empty IRIs in canonicalization ([f4a9ed6](https://github.com/WilliamChelman/sparqly/commit/f4a9ed60714e66bce9c4b9de5d4438c7757ee9ea))
* **server:** discard a worker reload that completes after an Unload (ADR-0050) ([828ff72](https://github.com/WilliamChelman/sparqly/commit/828ff723e503767fff2164fe53e73be8ea352399))
* **server:** reflect split-glob parent-union state on the Sources row ([3250bb7](https://github.com/WilliamChelman/sparqly/commit/3250bb702ff32f8c025cd0d836497007a9acc90f))

## [0.33.0](https://github.com/WilliamChelman/sparqly/compare/v0.32.1...v0.33.0) (2026-05-29)

### Features

* **query:** TriG and N-Quads output formats ([#382](https://github.com/WilliamChelman/sparqly/issues/382)) ([8859241](https://github.com/WilliamChelman/sparqly/commit/8859241ebcbb7a471b1093c6e0952951b27d1148))
* **query:** triple-shaped SELECT reification ([#383](https://github.com/WilliamChelman/sparqly/issues/383)) ([6f87f5c](https://github.com/WilliamChelman/sparqly/commit/6f87f5c12d6010817e6a254af0c3ac933c14818c))
* **server:** no-git-history eligibility check on /api/sources/:id/refs ([#378](https://github.com/WilliamChelman/sparqly/issues/378)) ([a3d3589](https://github.com/WilliamChelman/sparqly/commit/a3d35895d50857486dbd4c570196e662172383cd))
* **sources-picker:** commits scope selector and empty-scope hint ([#380](https://github.com/WilliamChelman/sparqly/issues/380)) ([10fb6e9](https://github.com/WilliamChelman/sparqly/commit/10fb6e98eafc826d1dc6be8029e60eb9a2141319))
* **sources-picker:** commits section with on-demand pinning ([#379](https://github.com/WilliamChelman/sparqly/issues/379)) ([96bb7e5](https://github.com/WilliamChelman/sparqly/commit/96bb7e58b64f91635ca44faa0f58876cc3a50acc))
* **sources-picker:** cursor pagination for the commits list ([#381](https://github.com/WilliamChelman/sparqly/issues/381)) ([f31380d](https://github.com/WilliamChelman/sparqly/commit/f31380dc1ade6ff4e83ed2627aaf6e84ccc19f9d))
* **sources-picker:** tab refs and commits in the picker overlay ([c52e9e4](https://github.com/WilliamChelman/sparqly/commit/c52e9e44023db2595a988e200c6439e575f92690))

### Bug Fixes

* **server:** make watcher teardown deterministic to stop flaky rebuild-after-close ([5339964](https://github.com/WilliamChelman/sparqly/commit/5339964b4ca516e31c719eacae2ac0dbe68d1f26))

## [0.32.1](https://github.com/WilliamChelman/sparqly/compare/v0.32.0...v0.32.1) (2026-05-27)

### Bug Fixes

* **web:** improve YASQE cursor visibility inside matched bracket blocks ([3c7694f](https://github.com/WilliamChelman/sparqly/commit/3c7694f5297efbc8a9cc8184d80e9fcdd69949af))

## [0.32.0](https://github.com/WilliamChelman/sparqly/compare/v0.31.0...v0.32.0) (2026-05-26)

### Features

* **core:** pass-through resolver for view-over-disk-backed-glob ([#373](https://github.com/WilliamChelman/sparqly/issues/373), ADR-0047) ([6cfa578](https://github.com/WilliamChelman/sparqly/commit/6cfa57820b9f94f37a958b24f911ac7dca4420ed))
* **diff:** pass-through resolution + unified raw-target rejection ([#374](https://github.com/WilliamChelman/sparqly/issues/374), ADR-0047) ([8f76abd](https://github.com/WilliamChelman/sparqly/commit/8f76abd9c5ae11b7dbd161966f1c62e10093222e))
* **diff:** warn once per pass-through-resolved diff side ([#376](https://github.com/WilliamChelman/sparqly/issues/376), ADR-0047) ([743bb56](https://github.com/WilliamChelman/sparqly/commit/743bb5653bee347411fa92338c01b4389bf3b22b))
* **web:** add Quick query menu to editor frame ([0a60f1b](https://github.com/WilliamChelman/sparqly/commit/0a60f1b7f581abe389f8b96f8e003138dd6da311))
* **web:** diff page pre-flight gate for raw pass-through sources ([#375](https://github.com/WilliamChelman/sparqly/issues/375), ADR-0047) ([6665d3d](https://github.com/WilliamChelman/sparqly/commit/6665d3d4c3947de6010d6af3469baeafcccf24e9)), closes [#374](https://github.com/WilliamChelman/sparqly/issues/374)
* **web:** inherit current source on describe-this links ([0246963](https://github.com/WilliamChelman/sparqly/commit/0246963c6558b43f807ce07b17e8b425755db67d))
* **web:** migrate query results to cdk-table with resizable columns ([a773bbe](https://github.com/WilliamChelman/sparqly/commit/a773bbe9e3509772436a7488ce48823241646f2b))

### Bug Fixes

* **cli:** align exit-code tests with unified raw-pass-through-target variant ([8f0304c](https://github.com/WilliamChelman/sparqly/commit/8f0304c5eddb14b04b48130d1715b3de3cf5c3e8))
* **web:** collapse PREFIX block by default and stop picker rows from drifting ([a44e66d](https://github.com/WilliamChelman/sparqly/commit/a44e66df583d33130c9f27ed28cb0e6afc80f59e))

## [0.31.0](https://github.com/WilliamChelman/sparqly/compare/v0.30.0...v0.31.0) (2026-05-24)

### Features

* **web-e2e:** scaffold Playwright lane with per-page smoke ([#365](https://github.com/WilliamChelman/sparqly/issues/365)) ([b2db6ce](https://github.com/WilliamChelman/sparqly/commit/b2db6ce5fede46e60e96437e5ec2ace050c85431))

### Bug Fixes

* **diff:** resolve anchorSource from loader sidecar, not RDF-star ([5307ade](https://github.com/WilliamChelman/sparqly/commit/5307adea045b3506cae9439b448339b29a152a0c))
* **server:** unblock graceful shutdown of Sources SSE stream ([d93a2bc](https://github.com/WilliamChelman/sparqly/commit/d93a2bc805f84d9618de866be0c4347adb9e2493))

## [0.30.0](https://github.com/WilliamChelman/sparqly/compare/v0.29.0...v0.30.0) (2026-05-24)

### Features

* **cli,server,web:** failure surfaces — inline error chip, details expander, Retry ([#360](https://github.com/WilliamChelman/sparqly/issues/360)) ([5e9f901](https://github.com/WilliamChelman/sparqly/commit/5e9f901b52ed9d47c6a4fdff04be51b306662291))
* **core,server,web:** disk-backed Glob index Layer 3 extras + stale surface ([#357](https://github.com/WilliamChelman/sparqly/issues/357)) ([1a94a8f](https://github.com/WilliamChelman/sparqly/commit/1a94a8fe1ee82d84d8073aa136c4a9cc91ef8b9d))
* **core,server,web:** user-triggered index rebuild + Cancel for Disk-backed glob ([#358](https://github.com/WilliamChelman/sparqly/issues/358)) ([8f032ae](https://github.com/WilliamChelman/sparqly/commit/8f032ae35ad621786735d265b9029a13bf41f382))
* **serve,e2e:** read-only Sources E2E + force user-triggered rebuild ([#362](https://github.com/WilliamChelman/sparqly/issues/362)) ([e7023aa](https://github.com/WilliamChelman/sparqly/commit/e7023aa7e7d3a0fc2549c9b5cbe7d031601c5790))
* **server,web:** endpoint Test connection probe ([#359](https://github.com/WilliamChelman/sparqly/issues/359)) ([7dcdbb8](https://github.com/WilliamChelman/sparqly/commit/7dcdbb876c6d06bf8c4228fcdf96b37a3b92f6cf))
* **server,web:** in-memory Sources admin actions with capability gate ([#356](https://github.com/WilliamChelman/sparqly/issues/356)) ([0124aa4](https://github.com/WilliamChelman/sparqly/commit/0124aa4a0f85c1c8263a1d7fb9af54c49ebdc0cc)), closes [#352](https://github.com/WilliamChelman/sparqly/issues/352)
* **server,web:** live Sources page state updates over SSE ([#354](https://github.com/WilliamChelman/sparqly/issues/354)) ([567c312](https://github.com/WilliamChelman/sparqly/commit/567c312d5a7cac31936c1b3cc5402dde8f06b136))
* **server,web:** materialization metrics on loaded Sources rows ([#355](https://github.com/WilliamChelman/sparqly/issues/355)) ([7151c3c](https://github.com/WilliamChelman/sparqly/commit/7151c3c233c3e407e0879c27b644e7336a0028bc)), closes [#352](https://github.com/WilliamChelman/sparqly/issues/352)
* **server,web:** Sources page snapshot foundation ([#353](https://github.com/WilliamChelman/sparqly/issues/353)) ([eaf457f](https://github.com/WilliamChelman/sparqly/commit/eaf457fdf5b695b08a0233fdd7f944999b1c9896))
* **server,web:** split-glob disclosure with client-side action cascade ([#361](https://github.com/WilliamChelman/sparqly/issues/361)) ([1b8aa4c](https://github.com/WilliamChelman/sparqly/commit/1b8aa4c34b13f75ede98f7be9375063e5997cec1))

## [0.29.0](https://github.com/WilliamChelman/sparqly/compare/v0.28.2...v0.29.0) (2026-05-23)

### Features

* **cli:** config-overridable index cache location ([#345](https://github.com/WilliamChelman/sparqly/issues/345)) ([6374fdc](https://github.com/WilliamChelman/sparqly/commit/6374fdc7ac1740b5e74166c60acb92f48f4dec06))
* **cli:** reject disk-backed globs in hash and diff ([#343](https://github.com/WilliamChelman/sparqly/issues/343)) ([f1a2089](https://github.com/WilliamChelman/sparqly/commit/f1a2089d17cf4d7899883a0253d315314a166e80))
* **cli:** sparqly index command for ahead-of-time disk index builds ([#346](https://github.com/WilliamChelman/sparqly/issues/346)) ([404e5ef](https://github.com/WilliamChelman/sparqly/commit/404e5ef2811dc44c8773c073c7a426cd04311ff5))
* **core:** add storage field on glob sources ([354c4d4](https://github.com/WilliamChelman/sparqly/commit/354c4d4c11cf83ccaf9754b0e0cfa07599eb9f3b)), closes [#337](https://github.com/WilliamChelman/sparqly/issues/337)
* **core:** add unionDefaultGraph toggle on glob sources ([143d99a](https://github.com/WilliamChelman/sparqly/commit/143d99a8682848c135ea361829a2034e83a95de6))
* **core:** apply glob transforms during disk-backed index build ([#341](https://github.com/WilliamChelman/sparqly/issues/341)) ([d2f8fd1](https://github.com/WilliamChelman/sparqly/commit/d2f8fd1853479ef0fd4b3617e09f9770c5c4ff0b))
* **core:** build progress logging for disk-backed glob index build ([#349](https://github.com/WilliamChelman/sparqly/issues/349)) ([969ed24](https://github.com/WilliamChelman/sparqly/commit/969ed24b2380a53bcb6ef49050056143e08d75f9))
* **core:** disk-backed glob query path via quadstore ([#338](https://github.com/WilliamChelman/sparqly/issues/338)) ([0ba7baf](https://github.com/WilliamChelman/sparqly/commit/0ba7bafc8dd9d0af80e207de6558c130216e743a))
* **core:** index reuse and staleness detection ([#339](https://github.com/WilliamChelman/sparqly/issues/339)) ([3b0e429](https://github.com/WilliamChelman/sparqly/commit/3b0e4299690bf5263d4b0a90293a0201a2518467))
* **core:** inline graphName rewrite during disk-backed index build ([#348](https://github.com/WilliamChelman/sparqly/issues/348)) ([f7a37f6](https://github.com/WilliamChelman/sparqly/commit/f7a37f65821b8135680719449bfb476959f76634))
* **core:** propagate storage tier to split-glob file children ([#344](https://github.com/WilliamChelman/sparqly/issues/344)) ([d4c5f77](https://github.com/WilliamChelman/sparqly/commit/d4c5f776c86444b41bbc3af41a6916eb28946998))
* **core:** streamed batched ingest for disk-backed glob index build ([#347](https://github.com/WilliamChelman/sparqly/issues/347)) ([d7301dc](https://github.com/WilliamChelman/sparqly/commit/d7301dc90da6b4f69440695c7c48aa991fa25451))
* **core:** warn on oversized un-flagged glob ([#342](https://github.com/WilliamChelman/sparqly/issues/342)) ([5af56e5](https://github.com/WilliamChelman/sparqly/commit/5af56e542c569e1ec88835e13beba57cfad177fd))
* **server:** background index build with 503 indexing state ([#340](https://github.com/WilliamChelman/sparqly/issues/340)) ([8014678](https://github.com/WilliamChelman/sparqly/commit/80146785a42106575f56b528ad22cfa158c5cfa0))
* **server:** isolated child-process disk-backed index build ([#350](https://github.com/WilliamChelman/sparqly/issues/350)) ([d963f00](https://github.com/WilliamChelman/sparqly/commit/d963f009cd4248dbea3a0eaf855f68c05bf77dc5))

### Bug Fixes

* **cli:** catch shutdown rejection and force-exit on hung close ([9838c58](https://github.com/WilliamChelman/sparqly/commit/9838c58c18ca687b322ac9626b6be3d22c5e8298))
* **core,server:** reject disk-backed sources at view / describe / diff boundaries instead of silently materializing or leaking the lock ([a4f4fd1](https://github.com/WilliamChelman/sparqly/commit/a4f4fd19ea8b5031abe63ef4b439482cd00e648a))
* **core,server:** restore pnpm run check by normalizing glob error payload and handling disk-backed-source clone ([24dc3a4](https://github.com/WilliamChelman/sparqly/commit/24dc3a422670f7a4de6e2a7710289447c442cddf))
* **core:** atomic first-touch build for openOrBuildGlobIndex ([039a353](https://github.com/WilliamChelman/sparqly/commit/039a3536dc5c575ebd3c053b65d53db9935cf9a9)), closes [#346](https://github.com/WilliamChelman/sparqly/issues/346)
* **core:** atomic rename-swap in glob index promote so a mid-swap failure leaves the prior index in place ([7681e88](https://github.com/WilliamChelman/sparqly/commit/7681e88dcbcbf7691e5b833ae6947b409e3b3990))
* **core:** preserve nested child indexes when rebuilding meta glob index ([f39e805](https://github.com/WilliamChelman/sparqly/commit/f39e805b8722ca87eb4d3776b5e7518db50a2cca))
* **core:** reject disk-backed glob with gitRef instead of silently indexing the working tree ([6c9cd59](https://github.com/WilliamChelman/sparqly/commit/6c9cd59aa3a9cbbd52e56a51910ec4be4eaa4320))
* **core:** skip live-pid temp dirs when sweeping stale glob index builds ([d1b1bf2](https://github.com/WilliamChelman/sparqly/commit/d1b1bf2706fa848e2d277ee2e543528e2dd9ad4e))
* **core:** snapshot file fingerprints before ingest and route manifest reads through the typed error channel ([5a6266e](https://github.com/WilliamChelman/sparqly/commit/5a6266e1ca1f269ab1a5e19035134d207a677367))
* **server:** cool down IndexBuildPool re-spawn after a failing build ([649efc1](https://github.com/WilliamChelman/sparqly/commit/649efc1a358448fa6c0fd7a65b1b963e3a00e5ae))
* **server:** free IndexBuildPool slot on child spawn failure ([6a724f1](https://github.com/WilliamChelman/sparqly/commit/6a724f1f619bd00527f7b17734a93dd41ae708b8))
* **server:** refuse /refs for disk-backed sources to mirror the resolve-time pin rejection ([385e49a](https://github.com/WilliamChelman/sparqly/commit/385e49ab3454966bef8ed1e52e59dfe00521a019))

## [0.28.2](https://github.com/WilliamChelman/sparqly/compare/v0.28.1...v0.28.2) (2026-05-21)

### Bug Fixes

* **core:** forward short endpoint queries as direct POST ([544843d](https://github.com/WilliamChelman/sparqly/commit/544843d481f5f000d75715b4da902f1a3c10a324))

## [0.28.1](https://github.com/WilliamChelman/sparqly/compare/v0.28.0...v0.28.1) (2026-05-21)

### Bug Fixes

* **web:** derive SELECT columns when endpoint omits head.vars ([f731bff](https://github.com/WilliamChelman/sparqly/commit/f731bff22a878458b48fcf667b91b9609548da58))

## [0.28.0](https://github.com/WilliamChelman/sparqly/compare/v0.27.0...v0.28.0) (2026-05-21)

### Features

* **web:** syntax-highlight diff entity-hunk lines ([653aaf9](https://github.com/WilliamChelman/sparqly/commit/653aaf96d6b8e6a881c20079d439d7ed2761f8e5)), closes [#333](https://github.com/WilliamChelman/sparqly/issues/333)
* **web:** syntax-highlight diff source-file snippets ([ed1b6ec](https://github.com/WilliamChelman/sparqly/commit/ed1b6eccc67c33fb251f99e10b61254a7d39ed6f)), closes [#332](https://github.com/WilliamChelman/sparqly/issues/332)
* **web:** syntax-highlight the result pane's raw tab ([db24c0e](https://github.com/WilliamChelman/sparqly/commit/db24c0e7ce749f6b93cd5ec6cf4ade3628efc296)), closes [#330](https://github.com/WilliamChelman/sparqly/issues/330)
* **web:** syntax-highlight the turtle/trig result tab ([10daf62](https://github.com/WilliamChelman/sparqly/commit/10daf62be9e5c83fc79fe031631c6925434d7a45)), closes [#330](https://github.com/WilliamChelman/sparqly/issues/330) [#331](https://github.com/WilliamChelman/sparqly/issues/331)

## [0.27.0](https://github.com/WilliamChelman/sparqly/compare/v0.26.0...v0.27.0) (2026-05-20)

### Features

* serve --read-only flag and webapp writability capability ([7a31799](https://github.com/WilliamChelman/sparqly/commit/7a31799da7702df7b83592000408916e72263d5a)), closes [#315](https://github.com/WilliamChelman/sparqly/issues/315)
* **server:** saved-query CRUD with ETag concurrency and atomic sidecar writes ([#313](https://github.com/WilliamChelman/sparqly/issues/313)) ([a24d979](https://github.com/WilliamChelman/sparqly/commit/a24d9793e7c28880af3dd56d933c00867b03a2bc))
* templated saved-query substitution, validation, and lint ([#317](https://github.com/WilliamChelman/sparqly/issues/317)) ([c528b06](https://github.com/WilliamChelman/sparqly/commit/c528b069c189bdf259399b03e27ff483f6a226d9))
* **web:** /diff swap button flips sources and queries between sides ([00b19e0](https://github.com/WilliamChelman/sparqly/commit/00b19e048c4b1e9a9b32f00982316387c9bb3cff))
* **web:** /queries browse-only scaffolding ([#322](https://github.com/WilliamChelman/sparqly/issues/322)) ([17f6a40](https://github.com/WilliamChelman/sparqly/commit/17f6a4049c3b945f046d5d7c97d1b874eb690436))
* **web:** /queries delete from detail pane ([#326](https://github.com/WilliamChelman/sparqly/issues/326)) ([d729b9d](https://github.com/WilliamChelman/sparqly/commit/d729b9d3337811aeddffd86fc7e15a5a879a8632))
* **web:** /queries detail pane runs with source picker + parameter form ([#323](https://github.com/WilliamChelman/sparqly/issues/323)) ([e7f6e45](https://github.com/WilliamChelman/sparqly/commit/e7f6e45c37f189f446dfec4b24daa7f019a66a76))
* **web:** /queries edit-and-save with parameter authoring ([#324](https://github.com/WilliamChelman/sparqly/issues/324)) ([623da18](https://github.com/WilliamChelman/sparqly/commit/623da18670bab5ced1af2fef514c415c632ae103))
* **web:** /queries respects savedQueries.writable: false ([#327](https://github.com/WilliamChelman/sparqly/issues/327)) ([e1aa450](https://github.com/WilliamChelman/sparqly/commit/e1aa450cd29d211c4f6013ae770d01a1c1f1e5d1))
* **web:** /queries/new create flow with inline slug + Save-as ([#325](https://github.com/WilliamChelman/sparqly/issues/325)) ([9cb2e28](https://github.com/WilliamChelman/sparqly/commit/9cb2e28fb5fbe80b797f567a0885f5d057777e88))
* **web:** give /queries controls real form structure and a coherent button bar ([d966b4d](https://github.com/WilliamChelman/sparqly/commit/d966b4d52d171b3826222301c0e20d72b0c9ea68))
* **web:** parameter authoring pane for templated saved queries ([#319](https://github.com/WilliamChelman/sparqly/issues/319)) ([7ab40e5](https://github.com/WilliamChelman/sparqly/commit/7ab40e5277d42d1687c8599f708fa42835858215)), closes [#314](https://github.com/WilliamChelman/sparqly/issues/314)
* **web:** parameter form runtime for templated saved queries ([#318](https://github.com/WilliamChelman/sparqly/issues/318)) ([c1b566c](https://github.com/WilliamChelman/sparqly/commit/c1b566cadad92bdfa9ee6fff3bc3131fc47bf247))
* **web:** redesign library combobox as floating CDK overlay ([b7996a1](https://github.com/WilliamChelman/sparqly/commit/b7996a1fb944a5494c21034d6d4b989b8a6cb9bf))
* **web:** reuse EditorFrame on diff page with per-side save/load ([#321](https://github.com/WilliamChelman/sparqly/issues/321)) ([ac60ec3](https://github.com/WilliamChelman/sparqly/commit/ac60ec3b9a9eed0dbb66eda1c53667cf78217b50))
* **web:** saved-query UI on query page ([#314](https://github.com/WilliamChelman/sparqly/issues/314)) ([61e8216](https://github.com/WilliamChelman/sparqly/commit/61e8216d3a3e8098b72fc07c35e7d53d9a77d909))
* **web:** split EditorFrame run vs authoring on / and /diff ([#328](https://github.com/WilliamChelman/sparqly/issues/328)) ([ff61805](https://github.com/WilliamChelman/sparqly/commit/ff61805a478d15f03b0c338f41ab8c362420bc87))
* **web:** URL bindings round-trip for templated saved queries ([#320](https://github.com/WilliamChelman/sparqly/issues/320)) ([f00956b](https://github.com/WilliamChelman/sparqly/commit/f00956b168a5307db0ccbfb849e3c60e936fab43))
* **web:** URL contract for literal saved queries ([#316](https://github.com/WilliamChelman/sparqly/issues/316)) ([e7d7fbd](https://github.com/WilliamChelman/sparqly/commit/e7d7fbd16670d5bbd30aa24fe68d0cf19effe6c2))

### Bug Fixes

* **diff:** honor `@id:ref` address-form pin on diff sides ([f427a57](https://github.com/WilliamChelman/sparqly/commit/f427a57a823219b6ca7ebd07403109b14d8c9be2))
* **diff:** pair isomorphic bnode subtrees; stop snippet gap lines from absorbing focus ([a6e6c77](https://github.com/WilliamChelman/sparqly/commit/a6e6c773aae8e0e91a0300ae2168b855ab54b928))
* resolve eslint errors across web and core ([5d5d2c2](https://github.com/WilliamChelman/sparqly/commit/5d5d2c2f4b3a51efa279e1f267598e4081e1dd61))
* **web:** react to slug changes on /queries and avoid editor blink ([66e85e3](https://github.com/WilliamChelman/sparqly/commit/66e85e38778f3cd6f5637ae94dbee76172ccb44e))

## [0.26.0](https://github.com/WilliamChelman/sparqly/compare/v0.25.0...v0.26.0) (2026-05-16)

### Features

* **cli:** `sparqly init` scaffolds a config file in CWD ([#305](https://github.com/WilliamChelman/sparqly/issues/305)) ([a3e5e69](https://github.com/WilliamChelman/sparqly/commit/a3e5e69d092da07628da56cc3913de354d6dc5f7))

## [0.25.0](https://github.com/WilliamChelman/sparqly/compare/v0.24.0...v0.25.0) (2026-05-16)

### Features

* **cli:** flip diff to loader sidecar; remove --skip-auto-source-annotation ([#293](https://github.com/WilliamChelman/sparqly/issues/293)) ([4ea407f](https://github.com/WilliamChelman/sparqly/commit/4ea407f0c3b333da8816e26d55b44851e5e06caf))
* **core:** loader-attached Source record sidecar ([#292](https://github.com/WilliamChelman/sparqly/issues/292)) ([21d82bc](https://github.com/WilliamChelman/sparqly/commit/21d82bc5b7cb5e7f84fdac1b41f073905575289a))
* **describe:** collapse expandedPaths to flat PathStep[][] coupled to endpoint source ([#297](https://github.com/WilliamChelman/sparqly/issues/297)) ([d7756e7](https://github.com/WilliamChelman/sparqly/commit/d7756e7fb779c34b2eaecabe66be03e7a81ba654))
* **describe:** single-or-all request shape with split-glob meta absorbing children ([#296](https://github.com/WilliamChelman/sparqly/issues/296)) ([881c31a](https://github.com/WilliamChelman/sparqly/commit/881c31adbb9aac5317b3c7da63adf9b9ad9d9852))
* **server,web:** flip diff to engine-map sidecar; drop skipAutoSourceAnnotation ([#294](https://github.com/WilliamChelman/sparqly/issues/294)) ([4def6b8](https://github.com/WilliamChelman/sparqly/commit/4def6b8996ee26828b10cef82388ff4a9681199f))
* **web,server:** file-source ref discovery + reset results on source change ([bc913f6](https://github.com/WilliamChelman/sparqly/commit/bc913f6f6506b3e81d39eb4f45b9f4ce34a15ccf))
* **web:** button + icons visual primitives, migrate call-sites ([#298](https://github.com/WilliamChelman/sparqly/issues/298)) ([c3d1508](https://github.com/WilliamChelman/sparqly/commit/c3d150898af270f14c3927795ceb188b9d88cfa3))
* **web:** code-chip primitive, migrate call-sites ([9049311](https://github.com/WilliamChelman/sparqly/commit/9049311ef426bbb9527b04358a36d4b24bf3702f))
* **web:** error-banner primitive, migrate call-sites ([#300](https://github.com/WilliamChelman/sparqly/issues/300)) ([843d324](https://github.com/WilliamChelman/sparqly/commit/843d324b9f5db9d009123f1606e2ede16d670cf8))
* **web:** eyebrow primitive, migrate call-sites ([577a92d](https://github.com/WilliamChelman/sparqly/commit/577a92d4253783ff83cfda41de6c4dea61381b57))
* **web:** migrate inline glyphs to icon components ([#299](https://github.com/WilliamChelman/sparqly/issues/299)) ([d283ab7](https://github.com/WilliamChelman/sparqly/commit/d283ab7645fafa801eeeb1ab21968cd10dd265d5))
* **web:** polish sources-picker refs panel UX ([2e309c2](https://github.com/WilliamChelman/sparqly/commit/2e309c24b80c1053a70ffaf648e01b1d0e2383cd))
* **web:** surface-card primitive, migrate call-sites ([b327241](https://github.com/WilliamChelman/sparqly/commit/b327241de0e8f9a8be006173fb187af7195c12e9))
* **web:** tree view + actual hiding in sources picker ([2301ff3](https://github.com/WilliamChelman/sparqly/commit/2301ff3509e8016deb6821e5258b6a09d460297f))

### Bug Fixes

* **core:** sanitize bnode-label prefix to PN_CHARS-safe charset ([1df20d2](https://github.com/WilliamChelman/sparqly/commit/1df20d208491b7c7fdef608f4fd2dc558da59cc7))
* **web:** floating-ref note points to Refresh Remotes, not restart ([7cca20a](https://github.com/WilliamChelman/sparqly/commit/7cca20a56a32f36a3556dade7776a5e1a45481ec))

## [0.24.0](https://github.com/WilliamChelman/sparqly/compare/v0.23.0...v0.24.0) (2026-05-16)

### Features

* **core,cli,server:** enumerate split-glob children from git tree at pinned ref ([#274](https://github.com/WilliamChelman/sparqly/issues/274)) ([4e99ded](https://github.com/WilliamChelman/sparqly/commit/4e99dedcd23ac1bddd1a3c1fcb54705ccdeb72d8))
* **core,cli:** accept [@id](https://github.com/id):ref source addresses for views and CLI positionals ([#275](https://github.com/WilliamChelman/sparqly/issues/275)) ([b4e4a14](https://github.com/WilliamChelman/sparqly/commit/b4e4a14aece133633aa96218aa84b203d838cbf4)), closes [#6](https://github.com/WilliamChelman/sparqly/issues/6)
* **core,cli:** classify pinned vs floating git refs + emit gitRef/gitSha source records ([#273](https://github.com/WilliamChelman/sparqly/issues/273)) ([b806ae8](https://github.com/WilliamChelman/sparqly/commit/b806ae8a7f47e2743191c2789163ad01374b0d6a))
* **core,cli:** expandSplitGlobs + CLI tracer bullet ([#265](https://github.com/WilliamChelman/sparqly/issues/265)) ([10b6b65](https://github.com/WilliamChelman/sparqly/commit/10b6b6533e1905eaf1769bd1f044fd773e3f4c02))
* **core,cli:** pin glob sources to a git revision ([#272](https://github.com/WilliamChelman/sparqly/issues/272)) ([0808e86](https://github.com/WilliamChelman/sparqly/commit/0808e86d55d5cc87af197416c68c099773de83d3))
* **core,cli:** pin per-side glob sources for `diff` via --left-ref/--right-ref + [@id](https://github.com/id):ref ([#276](https://github.com/WilliamChelman/sparqly/issues/276)) ([73fc1d2](https://github.com/WilliamChelman/sparqly/commit/73fc1d20637ea6e917e24274a4aae8b8f6fb1fdf))
* **core,cli:** propagate view pins down `from:` chain to leaf glob ([#277](https://github.com/WilliamChelman/sparqly/issues/277)) ([44b3108](https://github.com/WilliamChelman/sparqly/commit/44b3108bcc947118126a107a3f023c993c8940b6))
* **core,server:** serve `@id:ref` pinned variants + watcher gate ([#278](https://github.com/WilliamChelman/sparqly/issues/278)) ([cce8aa2](https://github.com/WilliamChelman/sparqly/commit/cce8aa2d44f7dd799cd5c8947f882f2d6fca125b))
* **core,server:** view-chain ref resolution for /api/sources/:id/refs ([#282](https://github.com/WilliamChelman/sparqly/issues/282)) ([a3eb13a](https://github.com/WilliamChelman/sparqly/commit/a3eb13a2c6b5005fc3e8928d0a9692464e16f918))
* **core:** introduce kind: 'file' source + splitByFile parser flag ([#264](https://github.com/WilliamChelman/sparqly/issues/264)) ([c901703](https://github.com/WilliamChelman/sparqly/commit/c901703d391268758700b5a70fc6926e1613d460))
* **core:** warn (not error) on empty glob match ([#263](https://github.com/WilliamChelman/sparqly/issues/263)) ([9550f6f](https://github.com/WilliamChelman/sparqly/commit/9550f6f68eacf076bd3c6d4a8c5bb40d62402f80))
* **lint:** enforce max-lines 500 with grandfathered offenders ([#255](https://github.com/WilliamChelman/sparqly/issues/255)) ([7764e00](https://github.com/WilliamChelman/sparqly/commit/7764e0089e487a3d2635bf3b6dff5cef1f990847))
* **server:** GET /api/sources/:id/refs for glob sources ([#281](https://github.com/WilliamChelman/sparqly/issues/281)) ([428a9fd](https://github.com/WilliamChelman/sparqly/commit/428a9fdf7df9fd13858fb68890e329d8ab74a427))
* **server:** invalidate split-glob children cache on watcher events ([#268](https://github.com/WilliamChelman/sparqly/issues/268)) ([0fcd399](https://github.com/WilliamChelman/sparqly/commit/0fcd399353aec651bb672b105d9fc4886f8e70be))
* **server:** lazy-materialize served sources on first request ([#289](https://github.com/WilliamChelman/sparqly/issues/289)) ([a7c6f9e](https://github.com/WilliamChelman/sparqly/commit/a7c6f9e83169707458c504556a4f45bd0224f7a8))
* **server:** POST /api/sources/:id/refs/fetch with typed errors ([#283](https://github.com/WilliamChelman/sparqly/issues/283)) ([2044883](https://github.com/WilliamChelman/sparqly/commit/20448837f6c3afbc75e94f27120a9c7c625f0969))
* **server:** wire expandSplitGlobs + wildcard sparql route ([#266](https://github.com/WilliamChelman/sparqly/issues/266)) ([14dd69c](https://github.com/WilliamChelman/sparqly/commit/14dd69c0b2e7ec8f239e607503a7ff22f8e7517e))
* **web:** group source pickers by parentId ([#269](https://github.com/WilliamChelman/sparqly/issues/269)) ([1e042c3](https://github.com/WilliamChelman/sparqly/commit/1e042c3f3cf8061a93ddb84f5727845441ec358d))
* **web:** pinned-address `@id:ref` in sources picker + URL ([#279](https://github.com/WilliamChelman/sparqly/issues/279)) ([3741aa8](https://github.com/WilliamChelman/sparqly/commit/3741aa85ed1545084ccbc579d9db2a0c72705bd1))
* **web:** refresh remotes button in sources-picker ref panel ([#287](https://github.com/WilliamChelman/sparqly/issues/287)) ([fd7261c](https://github.com/WilliamChelman/sparqly/commit/fd7261ce0a84ca82989c9bad9478fcd9e86fd7f0))
* **web:** sources-picker overlay shell with source search ([#284](https://github.com/WilliamChelman/sparqly/issues/284)) ([b69a3b0](https://github.com/WilliamChelman/sparqly/commit/b69a3b051a5e429180b67a0e345927c2a833b7a8))
* **web:** sources-picker ref discovery panel ([#285](https://github.com/WilliamChelman/sparqly/issues/285)) ([2f2eb12](https://github.com/WilliamChelman/sparqly/commit/2f2eb122f9a5cd679db6a7442b9a9b35de9e5113))
* **web:** sources-picker ref-search filter and free-form Enter ([#286](https://github.com/WilliamChelman/sparqly/issues/286)) ([b4ac9d1](https://github.com/WilliamChelman/sparqly/commit/b4ac9d18ffb0bc26fe5287a6bc83ced4ab8b971a))

### Bug Fixes

* **core,server:** surface pinned `@id:ref` query errors as 4xx instead of 500 ([7f2d91f](https://github.com/WilliamChelman/sparqly/commit/7f2d91f3d668df86aa6185bacb8e35308ffeeebf))
* **core:** load ad-hoc pinned split-glob parents from the git tree ([9655f81](https://github.com/WilliamChelman/sparqly/commit/9655f8198b252bd2b47a502908bb77e32a93558e))
* **server:** retry-on-rejection + Result-typed errors on lazy load ([#290](https://github.com/WilliamChelman/sparqly/issues/290)) ([5dbf51b](https://github.com/WilliamChelman/sparqly/commit/5dbf51b4d10dd1bcc36c0ae365a42f8c284e8e66))

### Performance Improvements

* **core:** batch pinned split-glob reads through `git cat-file --batch` ([2fc8a06](https://github.com/WilliamChelman/sparqly/commit/2fc8a060992451d9e349aacd6bcb72ad079505fe))

## [0.23.0](https://github.com/WilliamChelman/sparqly/compare/v0.22.0...v0.23.0) (2026-05-14)

### Features

* **cli:** query/hash/format consume SourceError | TargetError per ADR-0024 ([#250](https://github.com/WilliamChelman/sparqly/issues/250)) ([667572d](https://github.com/WilliamChelman/sparqly/commit/667572db117a0c46fa6feda9f6114759c0a9c9f6))
* **describe:** per-source-as-data aggregation + HTTP mapper ([#251](https://github.com/WilliamChelman/sparqly/issues/251)) ([5369204](https://github.com/WilliamChelman/sparqly/commit/5369204f2ec5924c75dd3172586a92fd7baa24f5))
* **diff:** CLI consumes formatDiffError + per-variant exit codes ([#242](https://github.com/WilliamChelman/sparqly/issues/242)) ([6467b49](https://github.com/WilliamChelman/sparqly/commit/6467b49485d3d1c3617a0f03dd0344fa8b57e90f))
* **diff:** collapse UnknownSourceIdError into TargetWrappedError ([#248](https://github.com/WilliamChelman/sparqly/issues/248)) ([1c628b1](https://github.com/WilliamChelman/sparqly/commit/1c628b1d1660b66772a8477ed79c4a9105017a56))
* **diff:** diff-http-errors mapper + controller result.match per route + Zod adapter ([#241](https://github.com/WilliamChelman/sparqly/issues/241)) ([eadc110](https://github.com/WilliamChelman/sparqly/commit/eadc1102c3318af12d8b0e43c6b0e8e40e993046))
* **diff:** remaining DiffError variants + safeTry rewrite of diff.service ([#240](https://github.com/WilliamChelman/sparqly/issues/240)) ([f6e4067](https://github.com/WilliamChelman/sparqly/commit/f6e4067186ecae3d2ed5f07479fa5efaeb2ebe1f))
* **diff:** typed errors via neverthrow Result — TabularBlankNodeError canary ([#238](https://github.com/WilliamChelman/sparqly/issues/238)) ([7624082](https://github.com/WilliamChelman/sparqly/commit/76240828151ce39462b1595f340b358a176216ed))
* **snippet:** typed error surface + HTTP mapper + webapp renderer ([#252](https://github.com/WilliamChelman/sparqly/issues/252)) ([dae6e69](https://github.com/WilliamChelman/sparqly/commit/dae6e69a6f318e8102bcb5b452533ca5d470101a))
* **sources:** engine-leaf SourceError variants + Result primary impls ([fedf03b](https://github.com/WilliamChelman/sparqly/commit/fedf03b25b61c411f8f49bbb3522890fb96ff7da))
* **sources:** resolveSourceResult primary impl + SourceError union ([#239](https://github.com/WilliamChelman/sparqly/issues/239)) ([2b470d4](https://github.com/WilliamChelman/sparqly/commit/2b470d46ef6b3921e60cf5d850d8402ed05c9492))
* **sources:** transform-parse SourceError variant + drop legacy-message ([#246](https://github.com/WilliamChelman/sparqly/issues/246)) ([8901246](https://github.com/WilliamChelman/sparqly/commit/89012463b8bb9ff33c44ddecc2add6f0b1288f8b))
* **sources:** view-leaf SourceError variants + Result primary impls ([#245](https://github.com/WilliamChelman/sparqly/issues/245)) ([440bb1a](https://github.com/WilliamChelman/sparqly/commit/440bb1a7c6747d93b6ee0b3f144db491f328ab3a))
* **sparql:** controller consumes SourceError | TargetError directly ([#249](https://github.com/WilliamChelman/sparqly/issues/249)) ([bc707dc](https://github.com/WilliamChelman/sparqly/commit/bc707dc11342864636bcd4ee224a568fcec61ad8))
* **target:** TargetError union + selectTargetResult/resolveServeScopeResult primary impls ([#247](https://github.com/WilliamChelman/sparqly/issues/247)) ([d4391d0](https://github.com/WilliamChelman/sparqly/commit/d4391d0e7d279876c247287442e6037688d29ca9))

## [0.22.0](https://github.com/WilliamChelman/sparqly/compare/v0.21.0...v0.22.0) (2026-05-13)

### Features

* 'defined here' fallback snippets in webapp & CLI html diff ([#220](https://github.com/WilliamChelman/sparqly/issues/220)) ([ce4ec3d](https://github.com/WilliamChelman/sparqly/commit/ce4ec3d6b9365430946373b9814a653a90bc4e31))
* **core:** anchor definition-site lookup + Hunk.anchorSource ([#219](https://github.com/WilliamChelman/sparqly/issues/219)) ([2b06ed9](https://github.com/WilliamChelman/sparqly/commit/2b06ed93d4ec546b17161708bd298e56b6712737))
* **core:** quad-aware endpoint describe via graph-aware SELECT (ADR-0023) ([21c5e68](https://github.com/WilliamChelman/sparqly/commit/21c5e6826b08aee4aeef3152d646bd96163832ac))
* flatten entity hunks into one anchor-sorted list ([#218](https://github.com/WilliamChelman/sparqly/issues/218)) ([61807d4](https://github.com/WilliamChelman/sparqly/commit/61807d4b78eafdd0fbe5eef25ef66467ac9b76f5))
* **web:** inline bnode nesting + rdf:list collapse in describe view ([#223](https://github.com/WilliamChelman/sparqly/issues/223)) ([b8432c3](https://github.com/WilliamChelman/sparqly/commit/b8432c365da05e07c46a2a2e4a49be75b2df768b))
* **web:** RDF-star annotations rendered as {| … |} sub-blocks ([#225](https://github.com/WilliamChelman/sparqly/issues/225)) ([6ec9a58](https://github.com/WilliamChelman/sparqly/commit/6ec9a5843d6130e5e566c55a67bcdfb2a7b4b402))
* **web:** restore ⤵ expand affordance in sectioned describe view ([#224](https://github.com/WilliamChelman/sparqly/issues/224)) ([5b96d46](https://github.com/WilliamChelman/sparqly/commit/5b96d4631e859ffbc7706a65a66ea05139d6e9af))
* **web:** sectioned outbound/inbound describe view ([#222](https://github.com/WilliamChelman/sparqly/issues/222)) ([144729d](https://github.com/WilliamChelman/sparqly/commit/144729d49f376f2e1ddf7e6e9cb70f85ea9fd2bf))

### Bug Fixes

* **common:** count literal datatypes when picking used prefixes ([0600201](https://github.com/WilliamChelman/sparqly/commit/060020139b429c06a6e4772115c7171f704f21bd))

## [0.21.0](https://github.com/WilliamChelman/sparqly/compare/v0.20.0...v0.21.0) (2026-05-12)

### Features

* bulk source-snippet fetch — many ranges, one request (ADR-0021) ([f4dbe10](https://github.com/WilliamChelman/sparqly/commit/f4dbe100816ed4bf2f46b8e83b94992ad36dc5a0))
* **common:** SparqlyLogger interface + text/JSON log formatters (ADR-0020) ([52856a6](https://github.com/WilliamChelman/sparqly/commit/52856a683dacb3a62d29f48b0d1ab83209838f0b)), closes [#212](https://github.com/WilliamChelman/sparqly/issues/212)
* **core:** QueryEngine emits the SPARQL-execution log event via injected meta (ADR-0020, [#213](https://github.com/WilliamChelman/sparqly/issues/213)) ([3a586be](https://github.com/WilliamChelman/sparqly/commit/3a586bef9ee2e9f061e39e437006ed7e01d17664))
* **server:** HTTP request logging interceptor for `serve` (ADR-0020, [#215](https://github.com/WilliamChelman/sparqly/issues/215)) ([c376814](https://github.com/WilliamChelman/sparqly/commit/c3768149bda5250259996ed502ade316dbaa32d9))
* **server:** route serve startup, source-load, watch & freshness timings through SparqlyLogger (ADR-0020, [#216](https://github.com/WilliamChelman/sparqly/issues/216)) ([faefd1c](https://github.com/WilliamChelman/sparqly/commit/faefd1c2b445527aa49fed7d9280f0b7012cb56b))
* SPARQL-execution logging across hash, diff, and view chains (ADR-0020, [#214](https://github.com/WilliamChelman/sparqly/issues/214)) ([0d32b2d](https://github.com/WilliamChelman/sparqly/commit/0d32b2dc72350264b7cbb1559676d6236dc987aa))

## [0.20.0](https://github.com/WilliamChelman/sparqly/compare/v0.19.0...v0.20.0) (2026-05-12)

### Features

* **cli:** sub-cluster runner/ into config/ and fields/ (Phase L, ADR-0017) ([8e1387e](https://github.com/WilliamChelman/sparqly/commit/8e1387e0bef23919731626a88be9e352e5c12b77))
* **core:** path-expansion query builder + describeEndpoint honours paths (ADR-0019) ([0a1299b](https://github.com/WilliamChelman/sparqly/commit/0a1299b8ad7a29c7667b603469502c31f57b8ad9)), closes [#208](https://github.com/WilliamChelman/sparqly/issues/208)
* new icon ([2b3dc27](https://github.com/WilliamChelman/sparqly/commit/2b3dc275b1c553292e9cc406c353fb6ff477c7ed))
* **server:** POST /api/describe accepts expandedPaths (ADR-0019) ([89c4d2a](https://github.com/WilliamChelman/sparqly/commit/89c4d2a630c5ce30c7df26ecc1229d1e5479cc39))
* **web:** expand affordance on dangling endpoint bnodes (ADR-0019) ([33f4f62](https://github.com/WilliamChelman/sparqly/commit/33f4f62cdd5ed3fa29a319b81189a94e95652f94)), closes [#210](https://github.com/WilliamChelman/sparqly/issues/210)

### Bug Fixes

* **core:** make endpoint describe depth-0 (ADR-0019) ([a6f10bf](https://github.com/WilliamChelman/sparqly/commit/a6f10bfd1c12fdedb4dd9230177b81845711bcf3))
* **core:** make remote describe work against Virtuoso endpoints ([93d4612](https://github.com/WilliamChelman/sparqly/commit/93d4612bb35df01f258e00157dfc4e8ac8afad27))
* **core:** submit remote SPARQL queries via direct POST ([1fa9a84](https://github.com/WilliamChelman/sparqly/commit/1fa9a84d42d934d0fc5c14580dd11d8d53e8e737))

## [0.19.0](https://github.com/WilliamChelman/sparqly/compare/v0.18.0...v0.19.0) (2026-05-12)

### Features

* **core:** collapse libs/core/src/index.ts to eight feature barrels (Phase J, ADR-0017) ([4efcd88](https://github.com/WilliamChelman/sparqly/commit/4efcd886c7f18f81ebf8a4e3a9be8f26d1902a1d)), closes [#201](https://github.com/WilliamChelman/sparqly/issues/201)
* **core:** move canonicalize + strip-annotations + immutability into canonical/ (Phase C, ADR-0017) ([d98d029](https://github.com/WilliamChelman/sparqly/commit/d98d029774531ec401c26213642a676620d91da2)), closes [#201](https://github.com/WilliamChelman/sparqly/issues/201)
* **core:** move describe-store + describe-endpoint + relabel-bnodes into describe/ (Phase G, ADR-0017) ([c0bad86](https://github.com/WilliamChelman/sparqly/commit/c0bad86ed4ec12f3f0b56394d3e45ddcadcae854)), closes [#201](https://github.com/WilliamChelman/sparqly/issues/201)
* **core:** move diff + related formatters/utilities into diff/ (Phase I, ADR-0017) ([a2276e0](https://github.com/WilliamChelman/sparqly/commit/a2276e0d3c2be6c64a21b4ac8937f63f5580d6e1)), closes [#201](https://github.com/WilliamChelman/sparqly/issues/201)
* **core:** move parse-sparql-prefixes + env-substitute into shared/ (Phase B, ADR-0017) ([3730e9d](https://github.com/WilliamChelman/sparqly/commit/3730e9d12be9066913d4aff987747cab5153dba5)), closes [#201](https://github.com/WilliamChelman/sparqly/issues/201)
* **core:** move query-engine + rdf-loader + rdf-file-parser + endpoint-http + endpoint-load into engine/ (Phase D, ADR-0017) ([687cfa2](https://github.com/WilliamChelman/sparqly/commit/687cfa295d63b0d839d90a9496196c5ac294f6f7)), closes [#201](https://github.com/WilliamChelman/sparqly/issues/201)
* **core:** move select-target + resolve-serve-scope into target/ (Phase H, ADR-0017) ([fb58084](https://github.com/WilliamChelman/sparqly/commit/fb5808417ce821ad66fc45fa660b6104e15a26a8)), closes [#201](https://github.com/WilliamChelman/sparqly/issues/201)
* **core:** move source-spec + transforms + resolve/load into sources/ (Phase E, ADR-0017) ([4beb0dc](https://github.com/WilliamChelman/sparqly/commit/4beb0dc6cab3f9c73574a49dcf60c965e89de138)), closes [#201](https://github.com/WilliamChelman/sparqly/issues/201)
* **core:** move view-* + anonymous-view-builder + resolve-anonymous-select-bindings into views/ (Phase F, ADR-0017) ([5bf84cb](https://github.com/WilliamChelman/sparqly/commit/5bf84cb2a2a44972c21627a9e145a6c9a35de2ee)), closes [#201](https://github.com/WilliamChelman/sparqly/issues/201)
* **core:** resolveServeScope — pure serve-scope resolver ([#196](https://github.com/WilliamChelman/sparqly/issues/196)) ([dc2308d](https://github.com/WilliamChelman/sparqly/commit/dc2308de2146d396578aa975370712812deaab04)), closes [#195](https://github.com/WilliamChelman/sparqly/issues/195)
* **core:** subpath exports + tsconfig wildcard alias (Phase A, ADR-0017) ([b64f71f](https://github.com/WilliamChelman/sparqly/commit/b64f71f9028f9c56f5f3f28f666acfe1100fbb5b)), closes [#200](https://github.com/WilliamChelman/sparqly/issues/200)
* **describe:** "describe this" affordance + header nav link ([#193](https://github.com/WilliamChelman/sparqly/issues/193)) ([69faf39](https://github.com/WilliamChelman/sparqly/commit/69faf398b1e142db1519eb1aeee8ddd9851abed5))
* **describe:** bnode-chain fixpoint, RDF-star post-pass, cap enforcement ([#186](https://github.com/WilliamChelman/sparqly/issues/186)) ([f07a753](https://github.com/WilliamChelman/sparqly/commit/f07a7539998600d5675bcf4c52964137b545f5eb))
* **describe:** compact IRIs in quad table + copy-IRI affordance ([e112e8a](https://github.com/WilliamChelman/sparqly/commit/e112e8a8baedb269d91e095f56debb23eab6f25e))
* **describe:** describeEndpoint (iterative remote CONSTRUCTs) + service dispatch for endpoint/empty/reference ([#189](https://github.com/WilliamChelman/sparqly/issues/189)) ([a44b02e](https://github.com/WilliamChelman/sparqly/commit/a44b02ee8dbaf9fdb4b8eb360cabdd85f0b60545))
* **describe:** IRI input expansion + URL state round-trip on describe page ([#191](https://github.com/WilliamChelman/sparqly/issues/191)) ([15aea63](https://github.com/WilliamChelman/sparqly/commit/15aea632afd7f32102ef0569b6c5bcad8c8a22d1))
* **describe:** multi-source aggregation, provenance, multi-select picker ([fb5abd8](https://github.com/WilliamChelman/sparqly/commit/fb5abd83e565edbed97dc18f8466ead2a82ee924)), closes [#187](https://github.com/WilliamChelman/sparqly/issues/187)
* **describe:** partial-failure handling, per-source error rows, describe: config + caps ([#188](https://github.com/WilliamChelman/sparqly/issues/188)) ([84384cd](https://github.com/WilliamChelman/sparqly/commit/84384cdf9c413f85ab71a8e77c4462d279f74f64))
* **describe:** tracer-bullet for /describe page ([#185](https://github.com/WilliamChelman/sparqly/issues/185)) ([85e3910](https://github.com/WilliamChelman/sparqly/commit/85e39109a87ddc12b9d002066d0eb15fa88b6735))
* **describe:** Turtle/TriG tab on describe page ([#192](https://github.com/WilliamChelman/sparqly/issues/192)) ([a3fb24a](https://github.com/WilliamChelman/sparqly/commit/a3fb24a0ae920d8702dadd7d22fb57cc6af64fd6))
* **describe:** view-target dispatch in DescribeService ([#190](https://github.com/WilliamChelman/sparqly/issues/190)) ([6cad32b](https://github.com/WilliamChelman/sparqly/commit/6cad32b52b99240c923150a95d47fc1d93433801))
* **serve:** collapse serve into one surface; --source is a scope filter ([#197](https://github.com/WilliamChelman/sparqly/issues/197)) ([02751df](https://github.com/WilliamChelman/sparqly/commit/02751df10e10a59b0ef052a3fd5e5b44a192598d))
* **server:** restructure libs/server/src/lib into six feature folders (Phase K, ADR-0017) ([8e4b2e8](https://github.com/WilliamChelman/sparqly/commit/8e4b2e83319ec0d025a31d7a1505c4fabc1d816d)), closes [#202](https://github.com/WilliamChelman/sparqly/issues/202)

## [0.18.0](https://github.com/WilliamChelman/sparqly/compare/v0.17.2...v0.18.0) (2026-05-10)

### Features

* **core,web:** multi-line object support for diff hunks ([a913cd9](https://github.com/WilliamChelman/sparqly/commit/a913cd92d298af610a076be51b2824b98631b65d))
* **webapp:** add result-to-formatted converter for query page ([#180](https://github.com/WilliamChelman/sparqly/issues/180)) ([36188d3](https://github.com/WilliamChelman/sparqly/commit/36188d3fb49b6d7d3f6fe83dc37f73af1974169d))
* **webapp:** add turtle/trig tab and unify formatted download ([#181](https://github.com/WilliamChelman/sparqly/issues/181)) ([88039d2](https://github.com/WilliamChelman/sparqly/commit/88039d25ad87a762d7aa69adc494e8c1cfaf1db0))
* **webapp:** reify SELECT-spo into the turtle/trig tab and download ([#182](https://github.com/WilliamChelman/sparqly/issues/182)) ([1aa29cf](https://github.com/WilliamChelman/sparqly/commit/1aa29cfc0dbef4085aec848a0540c44f3c06c7a4))
* **webapp:** resizable sparql editor ([7d17202](https://github.com/WilliamChelman/sparqly/commit/7d172024d72d4beac5600ea7c3215ecde600779b))
* **web:** constellation logomark and ambient header drift ([e5e9ecd](https://github.com/WilliamChelman/sparqly/commit/e5e9ecd81a03a711ea0bb5a35ba7dc19be681539)), closes [#168](https://github.com/WilliamChelman/sparqly/issues/168)
* **web:** editor frame and cm-s-sparqly CodeMirror theme ([#170](https://github.com/WilliamChelman/sparqly/issues/170)) ([573159e](https://github.com/WilliamChelman/sparqly/commit/573159e48392a493eb8d8269eeefed37494137c2))
* **web:** lay diff-hunk left/right snippets side by side ([112bf2a](https://github.com/WilliamChelman/sparqly/commit/112bf2af86e20f0213844a1a089021ef8db06498))
* **web:** merge adjacent diff source snippets and fix focal-highlight scroll width ([d732087](https://github.com/WilliamChelman/sparqly/commit/d732087b43c0b8dfb0444e281e75200c4f1825b5))
* **web:** rebuild source picker on @angular/cdk/listbox ([#169](https://github.com/WilliamChelman/sparqly/issues/169)) ([cfee4f5](https://github.com/WilliamChelman/sparqly/commit/cfee4f5bb6ee89043ce6f226f9de16335d0589c1))
* **web:** section diff result by classified hunks ([#173](https://github.com/WilliamChelman/sparqly/issues/173)) ([12300b4](https://github.com/WilliamChelman/sparqly/commit/12300b47e004a196c7768c421bd287c15bfb55fd))
* **web:** typed result pipeline replacing YASR ([#171](https://github.com/WilliamChelman/sparqly/issues/171)) ([29a387d](https://github.com/WilliamChelman/sparqly/commit/29a387dcd7d50af561040fcbdf968452e3367276))
* **web:** visual foundations — tokens, fonts, theme toggle ([1f90180](https://github.com/WilliamChelman/sparqly/commit/1f90180edb7894b595415a7086b9ca236160e7d6))

### Bug Fixes

* **web,cli-e2e:** restore editor-frame test markers and align snippet spec ([3883980](https://github.com/WilliamChelman/sparqly/commit/3883980013066329ab9dea5bfabeacaeea435522))
* **web:** theme FOUC, accent contrast, red/green diff palette ([000f503](https://github.com/WilliamChelman/sparqly/commit/000f503b8593757d73c577ee7ed852d55728dc7a))

## [0.17.2](https://github.com/WilliamChelman/sparqly/compare/v0.17.1...v0.17.2) (2026-05-08)

### Bug Fixes

* **web:** negotiate Accept by query type so CONSTRUCT/DESCRIBE work ([a5ec4a5](https://github.com/WilliamChelman/sparqly/commit/a5ec4a5965be42acd9a92616c666ed036947c0f7))

## [0.17.1](https://github.com/WilliamChelman/sparqly/compare/v0.17.0...v0.17.1) (2026-05-08)

### Bug Fixes

* **core:** stream N3 parsing to handle files past V8 string limit ([36e3ea8](https://github.com/WilliamChelman/sparqly/commit/36e3ea8a96bb2ce4d94b0c8659aaefa0731d0a5b))

## [0.17.0](https://github.com/WilliamChelman/sparqly/compare/v0.16.0...v0.17.0) (2026-05-07)

### ⚠ BREAKING CHANGES

* **serve:** extend WatcherChain to multi-source registry (#143)
* **serve:** Registry mode default with EngineMap, /api/sources, /api/sparql/<id> (#141)

### Features

* **config:** shared context block for IRI display (ADR-0012, [#158](https://github.com/WilliamChelman/sparqly/issues/158)) ([34e4b99](https://github.com/WilliamChelman/sparqly/commit/34e4b99fa3d63ef1c94888e619624e2924929876))
* **diff:** bnode absorption into named parent + sh:path-keyed identity ([#152](https://github.com/WilliamChelman/sparqly/issues/152)) ([4cab202](https://github.com/WilliamChelman/sparqly/commit/4cab202d1f4455543c452924cc5df1a23f058050))
* **diff:** bucket grouped hunks into changed/removed/added sections ([#153](https://github.com/WilliamChelman/sparqly/issues/153)) ([7b878f2](https://github.com/WilliamChelman/sparqly/commit/7b878f24a5b2a8817bbec6b30aa6e68a8f6693ee))
* **diff:** groupRdfDiffByEntity MVP + --format=grouped CLI tracer ([#151](https://github.com/WilliamChelman/sparqly/issues/151)) ([1758c57](https://github.com/WilliamChelman/sparqly/commit/1758c57d86ce334de55f915b359fbcff92a98c57))
* **diff:** multi-parent bnode duplication + orphan synthetic anchor ([#154](https://github.com/WilliamChelman/sparqly/issues/154)) ([50af35f](https://github.com/WilliamChelman/sparqly/commit/50af35f96854bc09c7ac7085c265990211853f69))
* **diff:** rewrite html composer to render HunkedRdfDiff ([#155](https://github.com/WilliamChelman/sparqly/issues/155)) ([7f7e37a](https://github.com/WilliamChelman/sparqly/commit/7f7e37ab2fa8e39be31afb9b6b88d04206a857ae))
* **diff:** server kind='grouped' payload + web sections renderer ([576cef0](https://github.com/WilliamChelman/sparqly/commit/576cef0f4e5db6a58db5d925b6e96d7c790bb17a))
* **serve:** DiffService + POST /api/diff ([#144](https://github.com/WilliamChelman/sparqly/issues/144)) ([4ec410c](https://github.com/WilliamChelman/sparqly/commit/4ec410c1a69e9f7ca2ffdbaf8ea126a7071ff4ed))
* **serve:** extend WatcherChain to multi-source registry ([#143](https://github.com/WilliamChelman/sparqly/issues/143)) ([b9cff01](https://github.com/WilliamChelman/sparqly/commit/b9cff0199624919b1eb882577682ff75a2207b58))
* **serve:** mount /api/sources in Single-source mode ([#142](https://github.com/WilliamChelman/sparqly/issues/142)) ([b013a55](https://github.com/WilliamChelman/sparqly/commit/b013a55743bb85c843f99c6471ec90e5cd69d7c8))
* **serve:** Registry mode default with EngineMap, /api/sources, /api/sparql/<id> ([#141](https://github.com/WilliamChelman/sparqly/issues/141)) ([f507c61](https://github.com/WilliamChelman/sparqly/commit/f507c61e90f465ff4bf3e7f00b7a370d0bef45b1))
* **serve:** SnippetAllowList + GET /api/source-snippet ([#145](https://github.com/WilliamChelman/sparqly/issues/145)) ([41c6445](https://github.com/WilliamChelman/sparqly/commit/41c6445bf77afca3d68ea2e1eb94c02e4cbf25ee))
* **web:** bind diff page sources and queries to URL query params ([0b81317](https://github.com/WilliamChelman/sparqly/commit/0b81317bea6f3cc1cf6b6ee55d6fcd60938bbf05))
* **web:** DiffResultRenderer for graph, tabular, and error modes ([#147](https://github.com/WilliamChelman/sparqly/issues/147)) ([6f37bb9](https://github.com/WilliamChelman/sparqly/commit/6f37bb94abc5124382fdd601aa4fb5f32adb18a6)), closes [#148](https://github.com/WilliamChelman/sparqly/issues/148)
* **web:** playground SPA fallback + split snippets and overflow-safe diff layout ([e9b7a14](https://github.com/WilliamChelman/sparqly/commit/e9b7a141baa72829277e98e71e006c00a3bb46f4))
* **web:** prettier header with logo, yasqe editor on diff page, serve splash ([35b7ee4](https://github.com/WilliamChelman/sparqly/commit/35b7ee424d8a6207ac3b76f402cc5f26b1b90f9c))
* **web:** routing, header nav, and /diff page skeleton ([#146](https://github.com/WilliamChelman/sparqly/issues/146)) ([6bae13a](https://github.com/WilliamChelman/sparqly/commit/6bae13a63eb47759695e74e9081762e71a83af19))
* **web:** SourceSnippet component with lazy fetch and graceful degrade ([#148](https://github.com/WilliamChelman/sparqly/issues/148)) ([1ff7d76](https://github.com/WilliamChelman/sparqly/commit/1ff7d764dfb60b091528827ceea9947f049b05c7))

### Bug Fixes

* **server:** unblock lint by removing dynamic core import and declaring zod dep ([911c637](https://github.com/WilliamChelman/sparqly/commit/911c63745c0d3c72f63bbd282e23dc665f0ed0be))

## [0.16.0](https://github.com/WilliamChelman/sparqly/compare/v0.15.0...v0.16.0) (2026-05-06)

### ⚠ BREAKING CHANGES

* **cli:** drop ~29 dead env-var mirrors per ADR-0010 (#137)
* **cli:** remove --graph-mode flag and SPARQLY_GRAPH_MODE env (#135)
* **config:** whole-project schema with command-scoped blocks (ADR-0010, #134)

### Features

* **cli:** drop ~29 dead env-var mirrors per ADR-0010 ([#137](https://github.com/WilliamChelman/sparqly/issues/137)) ([d6c62d5](https://github.com/WilliamChelman/sparqly/commit/d6c62d534c67ae862b2d48b127916c28fd3c6d7b))
* **cli:** remove --graph-mode flag and SPARQLY_GRAPH_MODE env ([#135](https://github.com/WilliamChelman/sparqly/issues/135)) ([30a9d53](https://github.com/WilliamChelman/sparqly/commit/30a9d53ab04ff2489dd188bb63630f1e4a3ce6c0))
* **config:** auto-discover sparqly.config via walk-up from CWD ([#136](https://github.com/WilliamChelman/sparqly/issues/136)) ([d0c60a8](https://github.com/WilliamChelman/sparqly/commit/d0c60a898cf542e8a4386f44ae3c88581ee48050))
* **config:** eager path normalization for config-file paths ([#138](https://github.com/WilliamChelman/sparqly/issues/138)) ([de6d486](https://github.com/WilliamChelman/sparqly/commit/de6d486fc7a692957204aaffccced02e01498bf4))
* **config:** whole-project schema with command-scoped blocks (ADR-0010, [#134](https://github.com/WilliamChelman/sparqly/issues/134)) ([80ae884](https://github.com/WilliamChelman/sparqly/commit/80ae8846ae19e0f814ae72b733914728f5fd95ef))

## [0.15.0](https://github.com/WilliamChelman/sparqly/compare/v0.14.0...v0.15.0) (2026-05-06)

### Features

* **diff:** surface per-side totals and infer --format from --out ([5e8e3d1](https://github.com/WilliamChelman/sparqly/commit/5e8e3d1e0f123bbdff9876df031d6f4e56eb666a))
* **diff:** tabular diff endpoint pass-through ([#131](https://github.com/WilliamChelman/sparqly/issues/131)) ([ba914ed](https://github.com/WilliamChelman/sparqly/commit/ba914ed523bb9eb239fa66718585dc395e953be3))
* **diff:** tabular diff for arbitrary SELECT queries (ADR-0009, [#129](https://github.com/WilliamChelman/sparqly/issues/129)) ([023e5f9](https://github.com/WilliamChelman/sparqly/commit/023e5f9765748957e8f2d78efc87f56d7b9541b6))
* **diff:** tabular diff html format ([#130](https://github.com/WilliamChelman/sparqly/issues/130)) ([925dd4e](https://github.com/WilliamChelman/sparqly/commit/925dd4eb3d84476041d01066ace8aea3a69f14c9))
* **diff:** tabular diff rejection paths ([#132](https://github.com/WilliamChelman/sparqly/issues/132)) ([2cbad66](https://github.com/WilliamChelman/sparqly/commit/2cbad66477fc7ccb38f4034344de651111a5f10f))

## [0.14.0](https://github.com/WilliamChelman/sparqly/compare/v0.13.0...v0.14.0) (2026-05-05)

### ⚠ BREAKING CHANGES

* **core:** source-spec transform key `annotate` is now
`annotateSource`. Migrate config: `transforms: [{ annotate: {} }]` →
`transforms: [{ annotateSource: {} }]`.

### Features

* **core:** rename `annotate` transform key to `annotateSource` ([6e07db3](https://github.com/WilliamChelman/sparqly/commit/6e07db3954ac34aab9c4f55d186567fddb49bef1))
* **diff:** auto-inject `annotateSource` on glob targets (ADR-0008) ([9469bbc](https://github.com/WilliamChelman/sparqly/commit/9469bbc08b23ef293b646d49462432c771f956b7))

### Bug Fixes

* **diff:** scope html snippet fetching to changed hunks ([326771c](https://github.com/WilliamChelman/sparqly/commit/326771c9bb40f0c828d88e5060d58aa0e21b8a3f))

## [0.13.0](https://github.com/WilliamChelman/sparqly/compare/v0.12.0...v0.13.0) (2026-05-04)

### Features

* **diff:** html cap inline snippets at 10 per hunk with <details> overflow ([518b321](https://github.com/WilliamChelman/sparqly/commit/518b321f73a59138c5040bb553554db2a4486077)), closes [#125](https://github.com/WilliamChelman/sparqly/issues/125)
* **diff:** html degraded paths for missing line and source file ([#124](https://github.com/WilliamChelman/sparqly/issues/124)) ([203ff27](https://github.com/WilliamChelman/sparqly/commit/203ff2775a7cb6aca11732b07eb5af1f8aea462b))
* **diff:** html format MVP with --context plumbing ([#122](https://github.com/WilliamChelman/sparqly/issues/122)) ([319b84f](https://github.com/WilliamChelman/sparqly/commit/319b84fa65e920d40551aa2958d1e54dc081af3b)), closes [#6](https://github.com/WilliamChelman/sparqly/issues/6)
* **diff:** html snippet rendering with streaming snippet reader ([#123](https://github.com/WilliamChelman/sparqly/issues/123)) ([fccb98c](https://github.com/WilliamChelman/sparqly/commit/fccb98cb79948961bfbb5edc16374a31553a9dc6))
* **diff:** human format surfaces source records via diffStores ([#118](https://github.com/WilliamChelman/sparqly/issues/118)) ([fc38a54](https://github.com/WilliamChelman/sparqly/commit/fc38a54666b49b47a811ad0c279bf11a8027c6af)), closes [#117](https://github.com/WilliamChelman/sparqly/issues/117)
* **diff:** json format surfaces sourceRecords per added/removed entry ([ae03c78](https://github.com/WilliamChelman/sparqly/commit/ae03c782dd76677ef2839fa5111f5a33d89819f8))
* **diff:** rdf-patch format surfaces sourceRecords as trailing # comment ([60d8664](https://github.com/WilliamChelman/sparqly/commit/60d86645c50390c83b3286d254e99f72486e13ad)), closes [#120](https://github.com/WilliamChelman/sparqly/issues/120)
* **diff:** turtle format flat one-statement-per-line with above-comment ([91a6eea](https://github.com/WilliamChelman/sparqly/commit/91a6eea9bdedd454924b5a66df52241bc5f74e9e))

## [0.12.0](https://github.com/WilliamChelman/sparqly/compare/v0.11.0...v0.12.0) (2026-05-04)

### Features

* **cli:** single-target hash + diff with resolveSource ([#107](https://github.com/WilliamChelman/sparqly/issues/107)) ([95418d1](https://github.com/WilliamChelman/sparqly/commit/95418d1418fd74a357af89b8886b8b07c20761d1))
* **core:** add selectTarget precedence resolver ([#104](https://github.com/WilliamChelman/sparqly/issues/104)) ([551159f](https://github.com/WilliamChelman/sparqly/commit/551159f2ff0b4ec93b12d69ac9b8884bcaf1396a))
* **core:** annotate transform emits RDF-star source records ([#114](https://github.com/WilliamChelman/sparqly/issues/114)) ([dec9a78](https://github.com/WilliamChelman/sparqly/commit/dec9a78251ce889ab26bd7c6ae8c8cf61b0a23ff))
* **core:** annotation-stripping canonicalization ([#115](https://github.com/WilliamChelman/sparqly/issues/115)) ([942d24b](https://github.com/WilliamChelman/sparqly/commit/942d24bdd1313c0a7fe126f309f7836f3754422f))
* **core:** diff exposes per-side source-record map ([#116](https://github.com/WilliamChelman/sparqly/issues/116)) ([51ed993](https://github.com/WilliamChelman/sparqly/commit/51ed993d49b4e28cc1f48baad4e73c28c14912ce))
* **core:** graphName transform replaces graphMode/graph ([#113](https://github.com/WilliamChelman/sparqly/issues/113)) ([dde4b4b](https://github.com/WilliamChelman/sparqly/commit/dde4b4be5feb0b4df4117fb3ee0215d60ec254e9))
* **core:** line-tracking RDF parser front-end ([#112](https://github.com/WilliamChelman/sparqly/issues/112)) ([a14cd93](https://github.com/WilliamChelman/sparqly/commit/a14cd93809ee634052fb7644e477bee156b47ff7))
* **core:** source-spec parser supports `default: true` ([#103](https://github.com/WilliamChelman/sparqly/issues/103)) ([32366ff](https://github.com/WilliamChelman/sparqly/commit/32366ff13fb0c29dfde83f842634bbe252b0dd4d)), closes [#101](https://github.com/WilliamChelman/sparqly/issues/101)
* **core:** transform-spec parser and pipeline executor ([#111](https://github.com/WilliamChelman/sparqly/issues/111)) ([6d205f3](https://github.com/WilliamChelman/sparqly/commit/6d205f3be666b3c6f99b8f8d1d357d67045036b8))
* **query:** single-target model with resolveSource ([#105](https://github.com/WilliamChelman/sparqly/issues/105)) ([c127e6d](https://github.com/WilliamChelman/sparqly/commit/c127e6d21f7289a28b2102dae984617789b6c4bb)), closes [#106](https://github.com/WilliamChelman/sparqly/issues/106)
* **server:** single-target serve + watcher chain helper ([#106](https://github.com/WilliamChelman/sparqly/issues/106)) ([02cb72e](https://github.com/WilliamChelman/sparqly/commit/02cb72e0250f97605e881f2a977280acbae37b9d))

## [0.11.0](https://github.com/WilliamChelman/sparqly/compare/v0.10.0...v0.11.0) (2026-05-03)

### ⚠ BREAKING CHANGES

* **core:** narrow view `from:` to a single ref (#99)

### Features

* **core:** add empty source kind for SERVICE composition ([#100](https://github.com/WilliamChelman/sparqly/issues/100)) ([4d2ef60](https://github.com/WilliamChelman/sparqly/commit/4d2ef605365cd8e91449c251566e94dc3c961284))
* **core:** narrow view `from:` to a single ref ([#99](https://github.com/WilliamChelman/sparqly/issues/99)) ([d1053f2](https://github.com/WilliamChelman/sparqly/commit/d1053f20dbbbdcffba5d8b0deb772ed8e5866162))

## [0.10.0](https://github.com/WilliamChelman/sparqly/compare/v0.9.0...v0.10.0) (2026-05-03)

### ⚠ BREAKING CHANGES

* **core:** views with from: [@endpoint] no longer materialize the
endpoint with `SELECT ?s ?p ?o WHERE { ?s ?p ?o }`; the view query is
forwarded directly. Endpoints must execute the user's query (typically
CONSTRUCT) and return the appropriate wire format.
* **core:** remove graph and graphMode from endpoint sources
* **core:** remove prefilter and prefilterFile from glob/endpoint sources

### Features

* **cli:** diff --left-query/--right-query and symmetric --query scope each side ([328f4c4](https://github.com/WilliamChelman/sparqly/commit/328f4c4bf076afe74efba2ebe42747477709e8db))
* **cli:** hash --compare-with-query / --compare-with-query-file scope each side ([5d3d151](https://github.com/WilliamChelman/sparqly/commit/5d3d151fb074eef5a106955313c569b86e569b42))
* **cli:** hash --query / --query-file scope a single source via anonymous view ([baa772b](https://github.com/WilliamChelman/sparqly/commit/baa772bea4d5d97d91189c690bdfdb6451eaae8e))
* **cli:** sparqly cache list and clear commands ([#89](https://github.com/WilliamChelman/sparqly/issues/89)) ([a540599](https://github.com/WilliamChelman/sparqly/commit/a54059940c21169c399752b0222c9876817f899c))
* **core:** DAG-walk cache invalidation across view chains ([#88](https://github.com/WilliamChelman/sparqly/issues/88)) ([c55c8ad](https://github.com/WilliamChelman/sparqly/commit/c55c8ada1463c51a5ac3248f57bb35349542b306))
* **core:** introduce `view` source kind over glob upstream ([8cd0960](https://github.com/WilliamChelman/sparqly/commit/8cd0960691f41f180c9a9ff69344ae3062e22d5f))
* **core:** reject mixed/multi-endpoint view.from at parse time ([#94](https://github.com/WilliamChelman/sparqly/issues/94)) ([df408c4](https://github.com/WilliamChelman/sparqly/commit/df408c4c90a68581da2536ba8991343f08eee3a4)), closes [#97](https://github.com/WilliamChelman/sparqly/issues/97)
* **core:** remove graph and graphMode from endpoint sources ([a038f9c](https://github.com/WilliamChelman/sparqly/commit/a038f9c593b37ba7965a18d0d899f49354514214)), closes [#78](https://github.com/WilliamChelman/sparqly/issues/78)
* **core:** remove prefilter and prefilterFile from glob/endpoint sources ([964f89e](https://github.com/WilliamChelman/sparqly/commit/964f89ea257ecde765b500c601a1e404749f144f)), closes [#81](https://github.com/WilliamChelman/sparqly/issues/81)
* **core:** view pass-through for single-endpoint upstreams ([97f7c83](https://github.com/WilliamChelman/sparqly/commit/97f7c83e382ae2807833887806b275c8556ebccc)), closes [#95](https://github.com/WilliamChelman/sparqly/issues/95)
* **core:** view resolver supports endpoint and view-on-view upstream ([ad35442](https://github.com/WilliamChelman/sparqly/commit/ad35442f246a6ddfa3a85c0bef96f051f3ef7325)), closes [#80](https://github.com/WilliamChelman/sparqly/issues/80)
* **core:** view-cache foundation with TTL strategy ([#86](https://github.com/WilliamChelman/sparqly/issues/86)) ([a11280f](https://github.com/WilliamChelman/sparqly/commit/a11280ff2c4da5d404763a85b746906b3a106573)), closes [#83](https://github.com/WilliamChelman/sparqly/issues/83)
* **core:** view-cache freshness ASK and everlasting strategies ([#87](https://github.com/WilliamChelman/sparqly/issues/87)) ([78f43ab](https://github.com/WilliamChelman/sparqly/commit/78f43ab19a43d74230dcf072dbc24f8930b85a60))
* **server:** serve --watch refreshes views on file/ttl/freshness triggers ([c9c2275](https://github.com/WilliamChelman/sparqly/commit/c9c22754865033ee3b510333017cde03a9159dc4))

### Bug Fixes

* **server:** declare @comunica/query-sparql as a dependency ([eaa3cd0](https://github.com/WilliamChelman/sparqly/commit/eaa3cd0e1a46682fd2e01b4586f68062442bc6e3))

## [0.9.0](https://github.com/WilliamChelman/sparqly/compare/v0.8.0...v0.9.0) (2026-05-02)

### ⚠ BREAKING CHANGES

* **cli:** SPARQLY_SOURCES and SPARQLY_<COMMAND>_SOURCES env vars
are no longer read. Move source values to the CLI (-s/--sources or a
positional glob) or to the sources: key in a config file.
* **cli:** --print-config is no longer accepted on any command.
* **core,cli:** graphStrategy is renamed to graphMode. Value mapping:
none -> flatten, default -> preserve, partial -> fillDefault,
full -> forceAll. SPARQLY_GRAPH_STRATEGY / SPARQLY_<COMMAND>_GRAPH_STRATEGY
env vars are removed in favor of SPARQLY_GRAPH_MODE /
SPARQLY_<COMMAND>_GRAPH_MODE. The --graph-strategy CLI flag is removed in
favor of --graph-mode. Old key and old enum values now hard-fail.

### Features

* **cli:** drop --print-config flag and runner branch ([a2b3337](https://github.com/WilliamChelman/sparqly/commit/a2b333715ad1ceb3515ef8da67b20e83e6ecc8c9)), closes [#62](https://github.com/WilliamChelman/sparqly/issues/62)
* **cli:** drop SPARQLY_SOURCES and per-command SOURCES env vars ([becebc7](https://github.com/WilliamChelman/sparqly/commit/becebc760736777c48ecd72c82d94db0dd76aa64)), closes [#60](https://github.com/WilliamChelman/sparqly/issues/60) [#63](https://github.com/WilliamChelman/sparqly/issues/63)
* **cli:** reject SPARQL diff sources without prefilter on either side ([a72a7cc](https://github.com/WilliamChelman/sparqly/commit/a72a7cce695fa4cf4dd1f1633f0deb9827b6e1ed)), closes [#71](https://github.com/WilliamChelman/sparqly/issues/71)
* **cli:** reject SPARQL hash sources without prefilter ([d9e85d2](https://github.com/WilliamChelman/sparqly/commit/d9e85d23118414e5ab66537be7a4570afe8fa457))
* **cli:** reject SPARQL sources and prefilters on format glob sources ([d7cf33e](https://github.com/WilliamChelman/sparqly/commit/d7cf33ee4d7ebf540b608aee01b33be2cbb733bf))
* **core,cli:** [@id](https://github.com/id) reference resolution end-to-end ([683f139](https://github.com/WilliamChelman/sparqly/commit/683f139bf1bc4312578291b35682420c58b7ac64)), closes [#67](https://github.com/WilliamChelman/sparqly/issues/67)
* **core,cli:** ${VAR} env substitution on source-spec strings ([90da793](https://github.com/WilliamChelman/sparqly/commit/90da793209f2b4e020306d846dcfb78f2964215b))
* **core,cli:** rename graphStrategy to graphMode ([d48a8cf](https://github.com/WilliamChelman/sparqly/commit/d48a8cf189ef363ed7b49a1d60e7c972aa400fd9)), closes [#61](https://github.com/WilliamChelman/sparqly/issues/61) [#60](https://github.com/WilliamChelman/sparqly/issues/60)
* **core,cli:** SPARQL endpoint auth, headers, and per-source timeoutMs ([774ca36](https://github.com/WilliamChelman/sparqly/commit/774ca366015162103045996d91213c5a1cdc4c90)), closes [#69](https://github.com/WilliamChelman/sparqly/issues/69)
* **core,cli:** SPARQL endpoint source — materialized load ([fa3e37f](https://github.com/WilliamChelman/sparqly/commit/fa3e37f38a6f3e767bb82eb26500d930a9f279f3))
* **core:** prefilter contract and per-source pipeline on glob sources ([33ed513](https://github.com/WilliamChelman/sparqly/commit/33ed513eb84b5ead3addf299d06eaa2317f264c7)), closes [#66](https://github.com/WilliamChelman/sparqly/issues/66)
* **core:** source-spec parser/normalizer with glob-only loader ([a9cce39](https://github.com/WilliamChelman/sparqly/commit/a9cce39867ec5fdb036e8305e6a9e4d7c1cb5ddc)), closes [#67](https://github.com/WilliamChelman/sparqly/issues/67) [#68](https://github.com/WilliamChelman/sparqly/issues/68) [#66](https://github.com/WilliamChelman/sparqly/issues/66) [#64](https://github.com/WilliamChelman/sparqly/issues/64)
* **query:** pass-through federation for single endpoint, no prefilter ([663c675](https://github.com/WilliamChelman/sparqly/commit/663c675549c06996f82e9674896ddbebcc711ca0)), closes [#74](https://github.com/WilliamChelman/sparqly/issues/74)
* **serve:** --watch warns and ignores when no glob source ([0316cae](https://github.com/WilliamChelman/sparqly/commit/0316cae76277218a7bbeab2faa7fdc538685ad60)), closes [#73](https://github.com/WilliamChelman/sparqly/issues/73)
* **serve:** pass-through federation for single endpoint, no prefilter ([8c99e49](https://github.com/WilliamChelman/sparqly/commit/8c99e49f3d284840f2760938fdcfb3ebfad27bb8)), closes [#76](https://github.com/WilliamChelman/sparqly/issues/76)

## [0.8.0](https://github.com/WilliamChelman/sparqly/compare/v0.7.0...v0.8.0) (2026-05-01)

### Features

* **cli:** introduce command-spec runner and migrate hash ([#56](https://github.com/WilliamChelman/sparqly/issues/56)) ([b72f30c](https://github.com/WilliamChelman/sparqly/commit/b72f30c18020776e4fb8776de461c158e7c8bc42))
* **cli:** migrate diff/query/format/serve to command-spec runner ([#57](https://github.com/WilliamChelman/sparqly/issues/57)) ([1a0385f](https://github.com/WilliamChelman/sparqly/commit/1a0385f28625c13fe8bf35243208bc9a5a00e94d))
* **format:** blank-line group separators, multiline literals, list-element BN inlining ([e49eb91](https://github.com/WilliamChelman/sparqly/commit/e49eb919fe55c19dbd7cf84f057b1bebbb6b2e25))

## [0.7.0](https://github.com/WilliamChelman/sparqly/compare/v0.6.0...v0.7.0) (2026-05-01)

### Features

* **core:** add parseRdfString primitive ([#53](https://github.com/WilliamChelman/sparqly/issues/53)) ([2131b45](https://github.com/WilliamChelman/sparqly/commit/2131b45de35be2788732b11e3a349496c2f27c53))
* **diff:** add --format=turtle and CURIE-shorten human output ([#39](https://github.com/WilliamChelman/sparqly/issues/39)) ([a4c225f](https://github.com/WilliamChelman/sparqly/commit/a4c225f38e9d8dc284a42428d0532cf81339e0fb))
* **format:** wire --out through to file emitter ([#46](https://github.com/WilliamChelman/sparqly/issues/46)) ([0073878](https://github.com/WilliamChelman/sparqly/commit/007387834cd96934fad93b80d37e5a09ba31af45))
* **query:** pipe --format=turtle through formatter ([#40](https://github.com/WilliamChelman/sparqly/issues/40)) ([f4afe21](https://github.com/WilliamChelman/sparqly/commit/f4afe21353bb016d33d8afb9f90d96b4ab88179f))

## [0.6.0](https://github.com/WilliamChelman/sparqly/compare/v0.5.0...v0.6.0) (2026-04-30)

### Features

* **format:** object-anchored predicates ([#37](https://github.com/WilliamChelman/sparqly/issues/37)) ([7c376fd](https://github.com/WilliamChelman/sparqly/commit/7c376fd9aa08129a21c1da39e6e99d9ca7613036))

## [0.5.0](https://github.com/WilliamChelman/sparqly/compare/v0.4.0...v0.5.0) (2026-04-30)

### Features

* **cli:** `diff --out <path>` ([43a46bd](https://github.com/WilliamChelman/sparqly/commit/43a46bde5842170e40c5348d909cf19832ce79fe))
* **cli:** `hash --out <path>` (rejects with `--compare-with`) ([2d3eed4](https://github.com/WilliamChelman/sparqly/commit/2d3eed4942ec70c0db076e419ca7e4eb9d2e84f0))
* **cli:** `query --out <path>` + shared file-writer foundation ([a57ba7b](https://github.com/WilliamChelman/sparqly/commit/a57ba7bbaf27c12055fd8ac8b23f2a4d1fb382e2))
* **format:** `--write` rewrites in place, `--check` reports unformatted ([#34](https://github.com/WilliamChelman/sparqly/issues/34)) ([67a5c2a](https://github.com/WilliamChelman/sparqly/commit/67a5c2ae97a5f8fb2b9a192f670b2854a2c03371))
* **format:** anonymous blank-node inlining + sort-order tests ([#36](https://github.com/WilliamChelman/sparqly/issues/36)) ([003a3f5](https://github.com/WilliamChelman/sparqly/commit/003a3f5a2d471db8fbf0d052821db53dad3a6f9a))
* **format:** config `prefixes:`/`base:`, `--prefix` flag, `@base` handling ([#33](https://github.com/WilliamChelman/sparqly/issues/33)) ([1ecf995](https://github.com/WilliamChelman/sparqly/commit/1ecf9952388a969125ae0bdf7d07ab1920237adb))
* **format:** RDF list compaction ([#35](https://github.com/WilliamChelman/sparqly/issues/35)) ([0abb971](https://github.com/WilliamChelman/sparqly/commit/0abb971661f3bd73b7617e35adefe6c5d8babbb7))

## [0.4.0](https://github.com/WilliamChelman/sparqly/compare/v0.3.0...v0.4.0) (2026-04-30)

### Features

* **format:** bootstrap formatter module + `sparqly format` command ([3bcea13](https://github.com/WilliamChelman/sparqly/commit/3bcea1357e43734d8ad0037607593bd3f616e65b)), closes [#32](https://github.com/WilliamChelman/sparqly/issues/32)

## [0.3.0](https://github.com/WilliamChelman/sparqly/compare/v0.2.0...v0.3.0) (2026-04-30)

### Features

* **cli:** add sparqly hash command (tracer bullet) ([edf5c0d](https://github.com/WilliamChelman/sparqly/commit/edf5c0df95775b3c4f72cbd968281d627601574a)), closes [#23](https://github.com/WilliamChelman/sparqly/issues/23)
* **cli:** hash --compare-with mode ([c7a3333](https://github.com/WilliamChelman/sparqly/commit/c7a33339fe9aea5a4098123bf395ce04fad73302)), closes [#26](https://github.com/WilliamChelman/sparqly/issues/26)
* **cli:** hash --json output format ([50b8754](https://github.com/WilliamChelman/sparqly/commit/50b8754bd78d7894b18ea5f6493e19717c9545c1)), closes [#25](https://github.com/WilliamChelman/sparqly/issues/25)
* **cli:** hash supports multiple --sources ([11f14f4](https://github.com/WilliamChelman/sparqly/commit/11f14f41d2be5b6295dbbac6888cf89c48151288)), closes [#24](https://github.com/WilliamChelman/sparqly/issues/24)
* **diff:** add sparqly diff command for semantic RDF set diffs ([1d7811e](https://github.com/WilliamChelman/sparqly/commit/1d7811ecdc4f89071ee1da65254d17f169093b5c)), closes [#30](https://github.com/WilliamChelman/sparqly/issues/30)
* **loader:** add 'none' graph-strategy that flattens to default graph ([3811fa2](https://github.com/WilliamChelman/sparqly/commit/3811fa22918b5d4eea0f97e4627629f342f767ec)), closes [#22](https://github.com/WilliamChelman/sparqly/issues/22)

### Bug Fixes

* update lock file ([fd22505](https://github.com/WilliamChelman/sparqly/commit/fd22505a9d321c63720384d0a6b864fd8e1e4713))

## [0.2.0](https://github.com/WilliamChelman/sparqly/compare/v0.1.0...v0.2.0) (2026-04-29)

### Features

* **cli:** --print-config with source annotations + docs ([6a023c7](https://github.com/WilliamChelman/sparqly/commit/6a023c70977518b64cfeeaffb9610d3df21ff705)), closes [#18](https://github.com/WilliamChelman/sparqly/issues/18)
* **cli:** command blocks + full precedence chain ([1c1f6ae](https://github.com/WilliamChelman/sparqly/commit/1c1f6ae4cf2b2b2b09f248a0936e1f49064c2c4a)), closes [#17](https://github.com/WilliamChelman/sparqly/issues/17)
* **cli:** config-file foundation with shared schema + validation ([47bf342](https://github.com/WilliamChelman/sparqly/commit/47bf3420db5dcf802bf863ce1f65563d1adc2999)), closes [#16](https://github.com/WilliamChelman/sparqly/issues/16)
