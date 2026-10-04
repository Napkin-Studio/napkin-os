# The middleware (napkin.middleware/1): FastAPI on uvicorn, Python 3.12.
# Built from the repository root:  docker build -f server/Dockerfile .
# It reads the apps' pipeline declarations (app/templates/*/app/pipeline.yaml)
# and nothing else outside server/.
FROM python:3.12-slim AS runtime

COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never

WORKDIR /srv/napkin/server
COPY server/pyproject.toml server/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY server/napkin ./napkin
COPY app/templates/campaign-research/app/pipeline.yaml ../app/templates/campaign-research/app/pipeline.yaml
COPY app/templates/brief-maker/app/pipeline.yaml ../app/templates/brief-maker/app/pipeline.yaml

RUN useradd --uid 10001 --user-group --no-create-home napkin
USER napkin

ENV PATH=/srv/napkin/server/.venv/bin:$PATH \
    NAPKIN_HOST=0.0.0.0 \
    NAPKIN_PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/healthz',timeout=4).status==200 else 1)"
CMD ["python", "-m", "napkin.app"]
