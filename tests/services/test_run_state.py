import pytest

from repo_save_editor.services.run_state import (
    ResumeLocation,
    get_display_level,
    get_run_stat,
    set_display_level,
    set_run_stat,
)


def test_run_stats(sample_save):
    assert get_run_stat(sample_save, "level") == 4

    set_run_stat(sample_save, "level", 20)

    assert get_run_stat(sample_save, "level") == 20


def test_display_level_is_one_based(sample_save):
    assert get_display_level(sample_save) == 5

    set_display_level(sample_save, 50)

    assert get_run_stat(sample_save, "level") == 49


def test_display_level_rejects_zero(sample_save):
    with pytest.raises(ValueError, match="at least 1"):
        set_display_level(sample_save, 0)


def test_verified_shop_resume_value_is_named():
    assert int(ResumeLocation.NORMAL) == 0
    assert int(ResumeLocation.SHOP) == 1
