"""PyInstaller entry point for the frozen backend.

`python -m backend` relies on package/relative imports, which PyInstaller can't
target directly. This thin wrapper imports the package's main() so PyInstaller
follows the whole `backend` package from a single entry script.
"""

from backend.__main__ import main

if __name__ == "__main__":
    main()
