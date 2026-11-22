# The Deck Maker engine (deck-cloud): engine/deck/server.py as a small second container in the middleware task.
# Built from the repository root:  docker build -f engine/deck/Dockerfile .
# No LibreOffice and no poppler: NAPKIN_DECK_RENDER=web writes deck.pptx (python-pptx) and deck.html, and napkin-web prints
# the PDF from deck.html with Chromium. Model calls go to Claude in Amazon Bedrock with the task role (NAPKIN_MODEL_API=bedrock).
# The engine listens on 127.0.0.1 only (server.py): the middleware shares the task's network namespace, so it reaches it
# at http://127.0.0.1:8793 and nothing else can.
FROM python:3.12-slim AS runtime

# The engine's dependencies (the engine CI job's list, scripts/check.sh PY_ENGINE_DEPS) and the Bedrock client.
RUN pip install --no-cache-dir numpy requests httpx pypdf pdfplumber python-docx PyYAML python-dotenv \
      python-pptx lxml jsonschema fonttools "anthropic[bedrock]>=0.39"

WORKDIR /srv/napkin/engine
COPY engine/ ./
# One mapping of model ids to Bedrock inference profiles, the middleware's (brief_llm.bedrock_model_id reads it).
COPY server/napkin/model_routes.py /srv/napkin/server/napkin/model_routes.py
# The one price table every tool reads.
COPY engine/prices.json /srv/napkin/engine/prices.json

# The run cache (NAPKIN_DECK_DATA) is an EFS access point in the cloud, written as this uid (infra/modules/services).
RUN useradd --uid 10001 --user-group --create-home --home-dir /home/napkin napkin \
 && mkdir -p /data && chown napkin:napkin /data
USER napkin

ENV PYTHONPATH=/srv/napkin/engine \
    PYTHONUNBUFFERED=1 \
    NAPKIN_DECK_PORT=8793 \
    NAPKIN_DECK_DATA=/data \
    NAPKIN_DECK_RENDER=web
EXPOSE 8793
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8793/status',timeout=4).status==200 else 1)"
CMD ["python", "-m", "deck.server"]
