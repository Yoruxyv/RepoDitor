import pytest

from repo_save_editor.core.schema import SAVE_INT32_MAX, SAVE_INT32_MIN
from repo_save_editor.services.run import (
    ResumeLocation,
    get_display_level,
    get_resume_location_label,
    get_run_stat,
    set_display_level,
    set_resume_location_from_label,
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


def test_run_stats_accept_signed_int32_boundaries(sample_save):
    set_run_stat(sample_save, "currency", SAVE_INT32_MIN)
    assert get_run_stat(sample_save, "currency") == SAVE_INT32_MIN

    set_run_stat(sample_save, "currency", SAVE_INT32_MAX)
    assert get_run_stat(sample_save, "currency") == SAVE_INT32_MAX


@pytest.mark.parametrize("value", [SAVE_INT32_MIN - 1, SAVE_INT32_MAX + 1, True, 1.5, "1"])
def test_run_stats_reject_values_outside_storage_representation(sample_save, value):
    with pytest.raises(ValueError, match="between -2,147,483,648 and 2,147,483,647"):
        set_run_stat(sample_save, "currency", value)


@pytest.mark.parametrize("value", [0, SAVE_INT32_MAX + 2, True, 1.5, "1"])
def test_display_level_rejects_values_outside_stored_int32_range(sample_save, value):
    with pytest.raises(ValueError, match="between 1 and 2,147,483,648"):
        set_display_level(sample_save, value)


def test_display_level_accepts_largest_value_that_maps_to_int32(sample_save):
    set_display_level(sample_save, SAVE_INT32_MAX + 1)

    assert get_run_stat(sample_save, "level") == SAVE_INT32_MAX


def test_verified_shop_resume_value_is_named():
    assert int(ResumeLocation.NORMAL) == 0
    assert int(ResumeLocation.SHOP) == 1


def test_resume_location_labels_confirmed_values(sample_save):
    assert get_resume_location_label(sample_save) == "Normal"

    set_resume_location_from_label(sample_save, "Shop / Service Station")

    assert get_run_stat(sample_save, "save level") == 1
    assert get_resume_location_label(sample_save) == "Shop / Service Station"


def test_unknown_resume_location_is_preserved(sample_save):
    set_run_stat(sample_save, "save level", 7)
    label = get_resume_location_label(sample_save)

    assert label == "Unknown (7)"

    set_resume_location_from_label(sample_save, label)
    assert get_run_stat(sample_save, "save level") == 7
