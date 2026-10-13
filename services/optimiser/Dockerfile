# syntax=docker/dockerfile:1.7
# Build context: services/optimiser
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt
COPY aeroos_optimiser ./aeroos_optimiser
COPY tests ./tests
# The image runs its own tests at build time (including the CP-SAT ones, which need OR-Tools).
RUN python -m unittest discover -s tests -t . -v
RUN useradd --uid 10001 --no-create-home optimiser
USER optimiser
CMD ["python", "-m", "aeroos_optimiser.worker"]
