# cnn/results

Small result tables from Thiago Leão's CNN experiments, all computed on the OLD crc32 block folds (not `data/folds.csv`).
They document the model choice and are read by `notebooks/cnn_00_experiment_summary.ipynb`; they are not final numbers.

| File | Source |
|---|---|
| `arch_search_results.csv` | MLflow run `ac6d3912` of `runs_cnn_iterative` (three-round U-Net search, validation on inner fold 1), `model_path` column removed |
| `context_results.csv` | same run, context-size experiment (11, 21, 33 px input, evaluated on the central 11 px) |
| `smote_hybrid_comparison.csv` | synthetic-data variants on the same validation fold (Portuguese column names) |
