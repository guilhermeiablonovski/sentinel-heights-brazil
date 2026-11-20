# data/

| File | In the repo | What |
|---|---|---|
| `folds.csv` | yes | `sample_id, city, fold, block`: the outer spatial fold of each of the 16,954 training rows (the CNN must use these folds too) |
| `selected_features.txt` | yes | the 187 bands of the map model (one name per line, in model order) |
| `unused_existing_ids.csv` | yes | 9,853 training rows of the three first cities that the rebalancing left out (`split = unused`) |
| `features_full_1872_split.parquet` | **no** (too large) | the features table: 36,217 rows, `sample_id, city, height_m, is_background, x_m, y_m, split` + 1,872 features, float32 |

`split` is `train` (stratified points used for CV), `test` (natural-distribution test points, touched only by the final
evaluation), `excluded` (training points within 50 m of a test point) or `unused` (see above). Only `train` is fitted or validated.

Get the table with `python scripts/download_data.py` (Zenodo; the record is not published yet, see the TODO in that script),
or put the file here by hand. `notebooks/config.py` also accepts `features_full_1872_split.csv.gz` and `.csv`.
