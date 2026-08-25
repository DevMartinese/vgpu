# Example authoring rules

- Keep each example self-contained. Published example files may import packages and files inside their own example directory, but must not import app-level helpers or files from another example.
- Use `lil-gui` for interactive example controls. Do not build custom HTML or React control panels.
- Mount `lil-gui` inside the example container and destroy it during renderer cleanup.
- Keep the React entry as a thin mount/cleanup wrapper. Infer renderer types locally and let the preview host observe asynchronous failures instead of importing example-specific reporting or renderer helpers.
- Before simplifying, capture deterministic baselines for every control state, important interaction, and responsive layout. Make reductions in small tranches and require byte-exact parity after each tranche.
- Remove unreachable themes, modes, passes, uniforms, configuration, CPU mirrors, and files before compressing active GPU arithmetic. Preserve resource teardown and stale-async cancellation.
- Recheck thumbnails, focused tests, type safety, import boundaries, and bundle size after the implementation stabilizes.
- When simplifying an existing example, migrate it to these rules as part of the simplification.
