FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml .
COPY app app
RUN pip install --no-cache-dir torch --extra-index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir -e ".[models]"
RUN useradd -m app && chown -R app /app
USER app
ENV HF_HOME=/home/app/.cache/huggingface
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8100"]
