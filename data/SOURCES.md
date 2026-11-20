# Raw data sources (not in the repository)

The footprints and nDSM rasters are municipal open data and are too large, or not licensed, to redistribute here.
Notebooks 01, 03 and 06 (and the label construction behind the shipped features table) need them. Notebooks 04 and 05 do not.

> **Status:** the portals below are the starting points given by the authors; the exact layer or dataset names per city and the licences are still TODO. Do not publish derived labels or sample points before checking the licence of each provider.

## Folder layout expected by `notebooks/config.py`

```
data_raw/
  _footprints/<city>.gpkg     building footprint polygons, one per building part, attribute height_m (metres)
  _ndsm/<city>.tif            nDSM = DSM - DTM from the LiDAR survey, metres, any CRS (read with rasterio)
  _boundaries/<city>.gpkg     municipal boundary polygon (used to keep sample points inside the municipality)
```
City keys: `porto_alegre, sao_paulo, rio_de_janeiro, belo_horizonte, salvador, recife, curitiba, niteroi`.
Move the folder with `FRANTZ_RAW=/path/to/data_raw`.

## Per city

| City | LiDAR year (as set in `gee/export_frantz_features.js`) | UTM zone (EPSG) | Footprints source | nDSM / LiDAR source | Licence |
|---|---|---|---|---|---|
| Porto Alegre | 2010 | 32722 | [portal](https://prefeitura.poa.br/geopoa/) | same portal (LiDAR/DSM/DTM; confirm the exact layers) | TODO |
| Sao Paulo | 2017 | 32723 | [portal](https://www.kaggle.com/datasets/andasampa/dtm-dsm-sao-paulo) | same portal (LiDAR/DSM/DTM; confirm the exact layers) | TODO |
| Rio de Janeiro | 2019 | 32723 | [portal](https://www.data.rio/datasets/124f1607b57d4292af5c0dfc2ff8572c_0/about) | same portal (LiDAR/DSM/DTM; confirm the exact layers) | TODO |
| Belo Horizonte | 2013 | 32723 | [portal](https://prefeitura.pbh.gov.br/bhgeo) | same portal (LiDAR/DSM/DTM; confirm the exact layers) | TODO |
| Salvador | 2017 | 32724 | [portal](https://cartografia.salvador.ba.gov.br/dados-geoespaciais/baixar-dados-geoespaciais/) | same portal (LiDAR/DSM/DTM; confirm the exact layers) | TODO |
| Recife | 2020 | 32725 | [portal](https://pe3d.pe.gov.br/) | same portal (LiDAR/DSM/DTM; confirm the exact layers) | TODO |
| Curitiba | 2019 | 32722 | [portal](https://geocuritiba.ippuc.org.br/portal/apps/sites/#/geocuritiba) | same portal (LiDAR/DSM/DTM; confirm the exact layers) | TODO |
| Niteroi | 2019 | 32723 | [portal](https://www.sigeo.niteroi.rj.gov.br/) | same portal (LiDAR/DSM/DTM; confirm the exact layers) | TODO |

Boundaries: TODO (the Earth Engine scripts use `FAO/GAUL/2015/level2` for the map windows; the sampler uses the `_boundaries` files).

## What has to be prepared from the downloads (fill in per city)

1. **Footprints:** one polygon per building part with the height in a field named `height_m`. If the provider gives no
   height attribute, compute it by zonal statistics of the nDSM over the footprints in QGIS. TODO: which statistic was used per city.
   The training labels of Porto Alegre, Sao Paulo and Recife come from the provider's per-part height (the median in these three
   cities); notebook 01 (section 8) checks which statistic each city's `height_m` matches.
2. **nDSM:** DSM minus DTM as a single-band GeoTIFF in metres. Do this in QGIS (raster calculator), not in a notebook: the rasters are large.
3. **CRS:** the notebooks reproject as needed, but the sample points are snapped to a 10 m grid in the UTM zone listed above.
