# Changelog

## [0.1.4](https://github.com/s3ntin3l8/node-backend-template/compare/v0.1.3...v0.1.4) (2026-11-10)


### Bug Fixes

* **deps:** override minimatch to ^11.0.1 for the globparts DoS advisory ([#63](https://github.com/s3ntin3l8/node-backend-template/issues/63)) ([60549c8](https://github.com/s3ntin3l8/node-backend-template/commit/60549c86ccde150159ca331ff4c3945e9ca4b761))

## [0.1.3](https://github.com/s3ntin3l8/node-backend-template/compare/v0.1.2...v0.1.3) (2026-09-13)


### Bug Fixes

* correct invalid identify tags in .pre-commit-config.yaml ([#15](https://github.com/s3ntin3l8/node-backend-template/issues/15)) ([bf065a5](https://github.com/s3ntin3l8/node-backend-template/commit/bf065a58d8ac565d562e266248cc1ae8117fd502))
* **deps:** bump vitest and @vitest/coverage-v8 to ^5.0.0 ([#41](https://github.com/s3ntin3l8/node-backend-template/issues/41)) ([8a568ef](https://github.com/s3ntin3l8/node-backend-template/commit/8a568ef4ecfa54baeace25de1992f41f81d23f2d))
* **deps:** resolve 5 high-severity transitive npm audit findings ([#32](https://github.com/s3ntin3l8/node-backend-template/issues/32)) ([262c64b](https://github.com/s3ntin3l8/node-backend-template/commit/262c64b82dd8dba792e10e442712c8f8395366d0))
* **docker:** --ignore-scripts in deps and prod-deps ([#42](https://github.com/s3ntin3l8/node-backend-template/issues/42)) ([2753f43](https://github.com/s3ntin3l8/node-backend-template/commit/2753f4359d69dc641da4993169d7c8645aeb79be))
* pin typescript to ~6.0.3 -- fixes main's broken CI/CD since PR [#17](https://github.com/s3ntin3l8/node-backend-template/issues/17) ([#29](https://github.com/s3ntin3l8/node-backend-template/issues/29)) ([e18e606](https://github.com/s3ntin3l8/node-backend-template/commit/e18e6060e5c554517732476e64df97470ff75757))

## [0.1.2](https://github.com/s3ntin3l8/node-backend-template/compare/v0.1.1...v0.1.2) (2026-07-12)


### Features

* add app factory, plugins, services, routes, and tests ([711e62e](https://github.com/s3ntin3l8/node-backend-template/commit/711e62e1a59c5337f4c0f5466152d402c9852390))
* add Drizzle schema, client, seed, and migration config ([fc4563e](https://github.com/s3ntin3l8/node-backend-template/commit/fc4563ed0179973a59256e55b2274188ab3505e1))
* **db:** wire database and encryption with example users route ([6daf0c1](https://github.com/s3ntin3l8/node-backend-template/commit/6daf0c1c5d8c4a43be90bfa49d9e1951b971b541))
* **security:** add helmet, rate-limit, and env-driven CORS ([105d6d2](https://github.com/s3ntin3l8/node-backend-template/commit/105d6d2151d340deb6ac70c77979a8c8c9c5d3d6))


### Bug Fixes

* allowlist secrets: inherit false positives, enable strict detect-secrets ([#13](https://github.com/s3ntin3l8/node-backend-template/issues/13)) ([134a45f](https://github.com/s3ntin3l8/node-backend-template/commit/134a45f97ae2a5d2370399ef6406cfbde69b2472))
* **ci:** add permissions blocks so CodeQL/Release Please run ([5a5e285](https://github.com/s3ntin3l8/node-backend-template/commit/5a5e285355596ee23c843d8b4760d99a7045d725))
* **docker:** repair build stage and harden the image ([0495f08](https://github.com/s3ntin3l8/node-backend-template/commit/0495f08327dc56ec416f4105d825ef8e97173561))
* **docker:** retry npm installs on transient network errors ([516a8c8](https://github.com/s3ntin3l8/node-backend-template/commit/516a8c828922b8804f1d543acfe0e650ff111a14))
* override esbuild to 0.28.1 to close two moderate advisories ([#14](https://github.com/s3ntin3l8/node-backend-template/issues/14)) ([0612613](https://github.com/s3ntin3l8/node-backend-template/commit/06126133894ed40d0d53be8dfeee0a211465727e))
* **server:** shut down gracefully on SIGINT/SIGTERM ([fe3fce4](https://github.com/s3ntin3l8/node-backend-template/commit/fe3fce487a16cdd0eb7bd24a09d89a184e7d7795))
* switch env plugin to JSON Schema, fix tsconfig for build, remove unused zod deps ([fd885a1](https://github.com/s3ntin3l8/node-backend-template/commit/fd885a1f2d225a1ef0ecfec3f00bb1084162dda5))

## [0.1.1](https://github.com/s3ntin3l8/node-backend-template/compare/node-backend-template-v0.1.0...node-backend-template-v0.1.1) (2026-06-10)


### Features

* add app factory, plugins, services, routes, and tests ([711e62e](https://github.com/s3ntin3l8/node-backend-template/commit/711e62e1a59c5337f4c0f5466152d402c9852390))
* add Drizzle schema, client, seed, and migration config ([fc4563e](https://github.com/s3ntin3l8/node-backend-template/commit/fc4563ed0179973a59256e55b2274188ab3505e1))
* **db:** wire database and encryption with example users route ([6daf0c1](https://github.com/s3ntin3l8/node-backend-template/commit/6daf0c1c5d8c4a43be90bfa49d9e1951b971b541))
* **security:** add helmet, rate-limit, and env-driven CORS ([105d6d2](https://github.com/s3ntin3l8/node-backend-template/commit/105d6d2151d340deb6ac70c77979a8c8c9c5d3d6))


### Bug Fixes

* **ci:** add permissions blocks so CodeQL/Release Please run ([5a5e285](https://github.com/s3ntin3l8/node-backend-template/commit/5a5e285355596ee23c843d8b4760d99a7045d725))
* **docker:** repair build stage and harden the image ([0495f08](https://github.com/s3ntin3l8/node-backend-template/commit/0495f08327dc56ec416f4105d825ef8e97173561))
* **docker:** retry npm installs on transient network errors ([516a8c8](https://github.com/s3ntin3l8/node-backend-template/commit/516a8c828922b8804f1d543acfe0e650ff111a14))
* **server:** shut down gracefully on SIGINT/SIGTERM ([fe3fce4](https://github.com/s3ntin3l8/node-backend-template/commit/fe3fce487a16cdd0eb7bd24a09d89a184e7d7795))
* switch env plugin to JSON Schema, fix tsconfig for build, remove unused zod deps ([fd885a1](https://github.com/s3ntin3l8/node-backend-template/commit/fd885a1f2d225a1ef0ecfec3f00bb1084162dda5))
