# Example authoring rules

- Keep each example self-contained. Published example files may import packages and files inside their own example directory, but must not import app-level helpers or files from another example.
- Use `lil-gui` for interactive example controls. Do not build custom HTML or React control panels.
- Mount `lil-gui` inside the example container and destroy it during renderer cleanup.
- When simplifying an existing example, migrate it to these rules as part of the simplification.
