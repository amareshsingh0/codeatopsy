from fastapi import FastAPI

from app.api.routes import submissions

app = FastAPI(title="CodeAutopsy API", version="0.1.0-week1")

app.include_router(submissions.router)


@app.get("/health")
def health():
    return {"status": "ok"}
