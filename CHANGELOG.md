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
