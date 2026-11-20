FROM tensorflow/tensorflow:2.15.0-gpu-jupyter

# TUDO em um único comando 'pip install' para as dependências não brigarem
RUN pip install --upgrade pip && \
    pip install \
      "numpy==1.26.4" \
      "ml-dtypes==0.2.0" \
      "protobuf==3.20.3" \
      "pandas<2.2.0" \
      scikit-learn \
      matplotlib \
      seaborn \
      jupyterlab \
      mlflow \
      earthengine-api \
      tqdm \
      --ignore-installed blinker

WORKDIR /tf