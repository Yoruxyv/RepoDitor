from __future__ import annotations

from pathlib import Path

from repo_save_editor.services.game.local_data import (
    RepoLocalDataRoots,
    get_repo_local_data_roots,
)


def test_repo_local_data_roots_use_only_fixed_product_owned_suffixes() -> None:
    local_low = Path("E:/Whatever/LocalLow")

    assert get_repo_local_data_roots(lambda: local_low) == RepoLocalDataRoots(
        root=local_low / "semiwork/Repo",
        saves=local_low / "semiwork/Repo/saves",
        cache=local_low / "semiwork/Repo/Cache",
        icon_cache=local_low / "semiwork/Repo/Cache/Icons",
        meta_save=local_low / "semiwork/Repo/MetaSave.es3",
    )


def test_repo_local_data_roots_fail_soft_when_known_folder_is_unavailable() -> None:
    assert get_repo_local_data_roots(lambda: None) is None
