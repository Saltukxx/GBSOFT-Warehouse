FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY services/optimizer/pyproject.toml ./pyproject.toml
COPY services/optimizer/src ./src
RUN pip install --no-cache-dir .

RUN useradd --create-home optimizer
USER optimizer

EXPOSE 8001
CMD ["uvicorn", "gbsoft_optimizer.app:app", "--host", "0.0.0.0", "--port", "8001"]
