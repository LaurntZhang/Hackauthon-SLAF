# === COMMANDES DE SECOURS EXPRESS ===
# docker build -t finaxys-multiagent:latest .
# docker run --rm -p 8000:8000 --env-file .env finaxys-multiagent:latest

FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY src ./src
EXPOSE 8000
CMD ["uvicorn", "src.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
