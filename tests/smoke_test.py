"""Smoke test: run notebooks 04 and 05 end to end on a SYNTHETIC table, with sizes cut down, in a temporary copy of the repo.
It checks that the code runs and writes its outputs; it says nothing about the real results.

    python tests/smoke_test.py                 # generates the synthetic table, runs both notebooks
    python tests/smoke_test.py --only 04
Needs: jupyter/nbclient, nbformat, and the packages of environment.yml.
"""
import argparse, pathlib, shutil, subprocess, sys, tempfile, time

import nbformat
from nbclient import NotebookClient

REPO = pathlib.Path(__file__).resolve().parent.parent


def sub(nb, old, new, count=1):
    hits = [c for c in nb.cells if c.cell_type == "code" and old in c.source]
    assert sum(c.source.count(old) for c in hits) == count, f"{old!r}: expected {count} hit(s), found {sum(c.source.count(old) for c in hits)}"
    for c in hits:
        c.source = c.source.replace(old, new)


def run(nb_path, patches, inserts, workdir, timeout):
    nb = nbformat.read(nb_path, as_version=4)
    for old, new in patches:
        sub(nb, old, new)
    for marker, src in inserts:                       # insert a code cell after the first cell containing `marker`
        i = next(i for i, c in enumerate(nb.cells) if c.cell_type == "code" and marker in c.source)
        nb.cells.insert(i + 1, nbformat.v4.new_code_cell(src))
    t = time.time()
    NotebookClient(nb, timeout=timeout, kernel_name="python3", resources={"metadata": {"path": str(workdir / "notebooks")}}).execute()
    print(f"  {nb_path.name}: OK in {time.time() - t:.0f} s")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=["04", "05"], default=None)
    ap.add_argument("--keep", action="store_true")
    ap.add_argument("--timeout", type=int, default=1800)
    a = ap.parse_args()
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="frantz_smoke_"))
    (tmp / "data").mkdir()
    shutil.copytree(REPO / "notebooks", tmp / "notebooks", ignore=shutil.ignore_patterns("__pycache__", ".ipynb_checkpoints"))
    for f in ("folds.csv", "selected_features.txt", "unused_existing_ids.csv"):
        if (REPO / "data" / f).exists():
            shutil.copy(REPO / "data" / f, tmp / "data" / f)
    subprocess.run([sys.executable, str(REPO / "tests" / "make_synthetic_table.py"), "--out",
                    str(tmp / "data" / "features_full_1872_split.parquet")], check=True)
    nbs = tmp / "notebooks"
    if a.only in (None, "04"):
        print("notebook 04 (FAST = True)")
        run(nbs / "04_spot_checking.ipynb", [("FAST = False           #", "FAST = True            #")], [], tmp, a.timeout)
        assert (tmp / "outputs" / "spot_check_8cities" / "oof_predictions_long.csv").exists() or \
               (tmp / "outputs" / "spot_check_8cities_FAST" / "oof_predictions_long.csv").exists() or \
               list((tmp / "outputs").glob("spot_check*/oof_predictions_long.csv")), "no OOF file written"
    if a.only in (None, "05"):
        print("notebook 05 (section 1 FAST, then reduced sizes)")
        patches = [("FAST = False                     #", "FAST = True                      #"),
                   ("N_BOOT = 1000", "N_BOOT = 50"),
                   ("N_REPEATS = 5", "N_REPEATS = 1"),
                   ("N_TRAIN_SUB = 6000", "N_TRAIN_SUB = 300"),
                   ("N_SHAP = 2000", "N_SHAP = 100"),
                   ("N_PDP, N_ICE, N_GRID, TOP_PDP = 800, 60, 20, 6", "N_PDP, N_ICE, N_GRID, TOP_PDP = 150, 20, 10, 2"),
                   ("N_ITER, INNER_FOLDS, SEED, N_JOBS = 12, 3, 42, -1", "N_ITER, INNER_FOLDS, SEED, N_JOBS = 2, 3, 42, -1")]
        inserts = [("folds written above", 'FAST = False\nN_ITER = {"HistGB": 2, "SVR": 2}\n')]
        run(nbs / "05_tuning_and_final_model.ipynb", patches, inserts, tmp, a.timeout)
        for f in ("final_model/test_metrics.csv", "final_model/selected_features.txt", "interpretation", "loco"):
            assert (tmp / "outputs" / f).exists(), f"missing outputs/{f}"
        print("  outputs:", sorted(p.name for p in (tmp / "outputs").iterdir()))
    print("SMOKE TEST PASSED (synthetic data; checks that the code runs, not the results)")
    if a.keep:
        print("kept:", tmp)
    else:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
