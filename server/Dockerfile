# The middleware (napkin.middleware/1): FastAPI on uvicorn, Python 3.12.
# Built from the repository root:  docker build -f server/Dockerfile .
# It reads the apps' pipeline declarations (app/templates/*/app/pipeline.yaml)
# and the measure list the knowledge layers enforce
# (layers-service/data/measures.json, NAPKIN_MEASURES), nothing else outside server/.
FROM python:3.12-slim AS runtime

COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never

WORKDIR /srv/napkin/server
COPY server/pyproject.toml server/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY server/napkin ./napkin
COPY app/templates/campaign-research/app/pipeline.yaml ../app/templates/campaign-research/app/pipeline.yaml
COPY app/templates/brief-maker/app/pipeline.yaml ../app/templates/brief-maker/app/pipeline.yaml
COPY layers-service/data/measures.json ../layers-service/data/measures.json
# Which model each call uses (NAPKIN_MODEL_ROUTES; the deployment points at it).
COPY server/model-routes.example.json ./model-routes.json
# Aurora is reached with sslmode=verify-full: the RDS certificate authorities.
RUN python -c "import urllib.request; urllib.request.urlretrieve('https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem', '/srv/napkin/rds-ca.pem')" \
 && chmod 644 /srv/napkin/rds-ca.pem

# The run ledger (napkin/metrics.py) writes under /srv/napkin/runs; the task's disk is scratch.
RUN useradd --uid 10001 --user-group --no-create-home napkin \
 && mkdir -p /srv/napkin/runs/metrics && chown -R napkin:napkin /srv/napkin/runs
USER napkin

ENV PATH=/srv/napkin/server/.venv/bin:$PATH \
    NAPKIN_MEASURES=/srv/napkin/layers-service/data/measures.json \
    PGSSLROOTCERT=/srv/napkin/rds-ca.pem \
    NAPKIN_HOST=0.0.0.0 \
    NAPKIN_PORT=8798
EXPOSE 8798
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8798/healthz',timeout=4).status==200 else 1)"
CMD ["python", "-m", "napkin.app"]
